/**
 * Worker API de goteo-cloud — el backend de la app.
 *
 * Los datos de salud llegan SIEMPRE cifrados E2EE desde la app:
 * el server guarda blobs ininteligibles. El server solo gestiona cuentas,
 * pairing y sincronización.
 *
 * v2: fixes de la revisión de seguridad (rate limiting, invites seguros,
 * redeem atómico, CAS real, revocación de pairing, validación, CORS).
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()

const ALLOWED_ORIGINS = ['https://goteo.app', 'https://*.goteo.app', 'app://goteo']
const MAX_BLOB_SIZE = 512 * 1024 // 512 KB de blob cifrado por usuario
const MAX_EMAIL_LEN = 254
const MAX_PASSWORD_LEN = 128
const MAX_DEVICE_ID_LEN = 128
const SESSION_DAYS = 30 // sesiones más cortas que los 90 originales
const INVITE_TTL_HOURS = 24
const RATE_WINDOW_SEC = 300 // ventana de rate limiting: 5 min
const RATE_LIMITS = {
  'auth:register': 10, // 10 registros / 5 min
  'auth:login': 20, // 20 intentos / 5 min
  'pair:invite': 5, // 5 invites / 5 min
  'pair:redeem': 10, // 10 intentos / 5 min
}

app.use('*', cors({ origin: ALLOWED_ORIGINS, allowMethods: ['GET', 'POST', 'PUT', 'DELETE'], allowHeaders: ['Content-Type', 'Authorization'] }))

// ---------- helpers ----------

const uuid = () => crypto.randomUUID().replace(/-/g, '')

// hash determinista (tokens de sesión, códigos de invite)
async function sha256Hex(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// comparación constante en tiempo (evita timing attacks)
function timingSafeEqualStr(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// hash de contraseña: PBKDF2-SHA256 100k con salt aleatorio
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256)
  const hash = btoa(String.fromCharCode(...new Uint8Array(bits)))
  return `${btoa(String.fromCharCode(...salt))}:${hash}`
}

async function verifyPassword(password, stored) {
  const [saltB64, hashB64] = stored.split(':')
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256)
  const hash = btoa(String.fromCharCode(...new Uint8Array(bits)))
  return timingSafeEqualStr(hash, hashB64)
}

// rate limiting: ventana deslizante por bucket en D1
async function checkRateLimit(env, bucket, limit) {
  const now = Math.floor(Date.now() / 1000)
  const windowStart = now - (now % RATE_WINDOW_SEC)
  const row = await env.DB.prepare(
    'SELECT attempts FROM rate_limits WHERE bucket = ? AND window_start = ?',
  )
    .bind(bucket, windowStart)
    .first()
  const attempts = (row?.attempts || 0) + 1
  await env.DB.prepare(
    `INSERT INTO rate_limits (bucket, window_start, attempts) VALUES (?, ?, ?)
     ON CONFLICT(bucket, window_start) DO UPDATE SET attempts = excluded.attempts`,
  )
    .bind(bucket, windowStart, attempts)
    .run()
  return attempts <= limit
}

async function createSession(env, userId, deviceId) {
  const token = crypto.randomUUID() + crypto.randomUUID()
  const tokenHash = await sha256Hex(token)
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000).toISOString()
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, device_id, expires_at) VALUES (?, ?, ?, ?)')
    .bind(tokenHash, userId, deviceId || null, expires)
    .run()
  return token
}

async function authUser(env, c) {
  const auth = c.req.header('Authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return null
  const tokenHash = await sha256Hex(token)
  const row = await env.DB.prepare(
    `SELECT s.user_id, s.expires_at, u.email, u.display_name
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
  )
    .bind(tokenHash)
    .first()
  if (!row) return null
  if (new Date(row.expires_at) < new Date()) return null
  return { id: row.user_id, email: row.email, display_name: row.display_name }
}

function clientIp(c) {
  return c.req.header('CF-Connecting-IP') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

function validateEmail(email) {
  return typeof email === 'string' && email.length > 0 && email.length <= MAX_EMAIL_LEN && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function logEvent(env, userId, action, peerId) {
  return env.DB.prepare('INSERT INTO sync_log (user_id, action, peer_id) VALUES (?, ?, ?)')
    .bind(userId, action, peerId || null)
    .run()
    .catch(() => {}) // el log nunca debe romper la operación principal
}

// ---------- auth ----------

// POST /auth/register {email, password, deviceId}
app.post('/auth/register', async (c) => {
  const env = c.env
  let body
  try {
    body = await c.req.json()
  } catch (e) {
    return c.json({ error: 'JSON inválido' }, 400)
  }
  const { email, password, deviceId } = body

  if (!validateEmail(email)) return c.json({ error: 'email inválido' }, 400)
  if (typeof password !== 'string' || password.length < 8 || password.length > MAX_PASSWORD_LEN) {
    return c.json({ error: `password debe tener entre 8 y ${MAX_PASSWORD_LEN} caracteres` }, 400)
  }
  if (deviceId && typeof deviceId !== 'string' || (deviceId && deviceId.length > MAX_DEVICE_ID_LEN)) {
    return c.json({ error: 'deviceId inválido' }, 400)
  }
  if (!(await checkRateLimit(env, `auth:register:${clientIp(c)}`, RATE_LIMITS['auth:register']))) {
    return c.json({ error: 'demasiados intentos, intentá más tarde' }, 429)
  }

  const id = uuid()
  const passwordHash = await hashPassword(password)
  try {
    await env.DB.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)')
      .bind(id, email.toLowerCase(), passwordHash)
      .run()
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return c.json({ error: 'email ya registrado' }, 409)
    }
    throw e
  }
  await logEvent(env, id, 'register')
  const token = await createSession(env, id, deviceId)
  return c.json({ token, user: { id, email: email.toLowerCase() } }, 201)
})

// POST /auth/login {email, password, deviceId}
app.post('/auth/login', async (c) => {
  const env = c.env
  let body
  try {
    body = await c.req.json()
  } catch (e) {
    return c.json({ error: 'JSON inválido' }, 400)
  }
  const { email, password, deviceId } = body
  if (!validateEmail(email) || typeof password !== 'string' || !password) {
    return c.json({ error: 'email o password incorrectos' }, 401)
  }
  if (!(await checkRateLimit(env, `auth:login:${clientIp(c)}:${email.toLowerCase()}`, RATE_LIMITS['auth:login']))) {
    return c.json({ error: 'demasiados intentos, intentá más tarde' }, 429)
  }

  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email.toLowerCase()).first()
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    await logEvent(env, user?.id || 'unknown', 'login_fail')
    return c.json({ error: 'email o password incorrectos' }, 401)
  }
  const token = await createSession(env, user.id, deviceId)
  return c.json({ token, user: { id: user.id, email: user.email, display_name: user.display_name } })
})

// POST /auth/logout — revoca la sesión actual; ?all=true revoca todas
app.post('/auth/logout', async (c) => {
  const env = c.env
  const auth = c.req.header('Authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  const url = new URL(c.req.url)
  const all = url.searchParams.get('all') === 'true'

  if (token) {
    const tokenHash = await sha256Hex(token)
    if (all) {
      const sess = await env.DB.prepare('SELECT user_id FROM sessions WHERE token_hash = ?').bind(tokenHash).first()
      if (sess) {
        await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(sess.user_id).run()
      }
    } else {
      await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run()
    }
  }
  return c.json({ ok: true })
})

// GET /auth/me
app.get('/auth/me', async (c) => {
  const user = await authUser(c.env, c)
  if (!user) return c.json({ error: 'no autorizado' }, 401)
  return c.json({ user })
})

// ---------- calendario (blob E2EE) ----------

// GET /calendar
app.get('/calendar', async (c) => {
  const user = await authUser(c.env, c)
  if (!user) return c.json({ error: 'no autorizado' }, 401)
  const row = await c.env.DB.prepare('SELECT encrypted_blob, blob_version, updated_at FROM calendar_blobs WHERE user_id = ?')
    .bind(user.id)
    .first()
  if (!row) return c.json({ blob: null })
  return c.json({ blob: row.encrypted_blob, version: row.blob_version, updatedAt: row.updated_at })
})

// PUT /calendar {blob, version} — CAS atómico sobre blob_version
app.put('/calendar', async (c) => {
  const user = await authUser(c.env, c)
  if (!user) return c.json({ error: 'no autorizado' }, 401)

  let body
  try {
    body = await c.req.json()
  } catch (e) {
    return c.json({ error: 'JSON inválido' }, 400)
  }
  const { blob, version } = body
  if (typeof blob !== 'string' || blob.length === 0) return c.json({ error: 'blob requerido' }, 400)
  if (blob.length > MAX_BLOB_SIZE) return c.json({ error: `blob demasiado grande (max ${MAX_BLOB_SIZE / 1024} KB)` }, 413)
  if (version !== undefined && version !== null && (!Number.isInteger(version) || version < 1)) {
    return c.json({ error: 'version debe ser un entero >= 1' }, 400)
  }

  const current = await c.env.DB.prepare('SELECT blob_version FROM calendar_blobs WHERE user_id = ?').bind(user.id).first()

  if (current) {
    // CAS real: update solo si la versión coincide
    const expected = version !== undefined && version !== null ? version : current.blob_version
    const newVersion = current.blob_version + 1
    const res = await c.env.DB.prepare(
      'UPDATE calendar_blobs SET encrypted_blob = ?, blob_version = ?, updated_at = datetime(\'now\') WHERE user_id = ? AND blob_version = ?',
    )
      .bind(blob, newVersion, user.id, expected)
      .run()
    if (res.meta.changes === 0) {
      return c.json({ error: 'conflicto de versión: recargá y volvé a intentar', currentVersion: current.blob_version }, 409)
    }
    await logEvent(c.env, user.id, 'push')
    return c.json({ ok: true, version: newVersion })
  }

  // creación inicial (no existe blob previo)
  await c.env.DB.prepare(
    `INSERT INTO calendar_blobs (user_id, encrypted_blob, blob_version, updated_at)
     VALUES (?, ?, 1, datetime('now'))
     ON CONFLICT(user_id) DO NOTHING`,
  )
    .bind(user.id, blob)
    .run()
  await logEvent(c.env, user.id, 'push')
  return c.json({ ok: true, version: 1 })
})

// ---------- pairing ----------

// POST /pair/invite — genera un código de invitación (128 bits, hash en DB)
app.post('/pair/invite', async (c) => {
  const user = await authUser(c.env, c)
  if (!user) return c.json({ error: 'no autorizado' }, 401)
  if (!(await checkRateLimit(c.env, `pair:invite:${user.id}`, RATE_LIMITS['pair:invite']))) {
    return c.json({ error: 'demasiados invites, intentá más tarde' }, 429)
  }

  // invalidar invites previos sin usar
  await c.env.DB.prepare('DELETE FROM pairing_invites WHERE owner_id = ? AND used_at IS NULL').bind(user.id).run()

  // 128 bits de entropía real
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const code = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  const codeHash = await sha256Hex(code)
  const expires = new Date(Date.now() + INVITE_TTL_HOURS * 3600 * 1000).toISOString()
  await c.env.DB.prepare('INSERT INTO pairing_invites (code_hash, owner_id, expires_at) VALUES (?, ?, ?)')
    .bind(codeHash, user.id, expires)
    .run()
  return c.json({ code, expiresAt: expires })
})

// POST /pair/redeem {code} — consume el invite atómicamente y vincula cuentas
app.post('/pair/redeem', async (c) => {
  const user = await authUser(c.env, c)
  if (!user) return c.json({ error: 'no autorizado' }, 401)

  let body
  try {
    body = await c.req.json()
  } catch (e) {
    return c.json({ error: 'JSON inválido' }, 400)
  }
  const { code } = body
  if (typeof code !== 'string' || code.length === 0 || code.length > 64) {
    return c.json({ error: 'código inválido' }, 400)
  }
  if (!(await checkRateLimit(c.env, `pair:redeem:${clientIp(c)}`, RATE_LIMITS['pair:redeem']))) {
    return c.json({ error: 'demasiados intentos, intentá más tarde' }, 429)
  }

  const normalized = code.toUpperCase()
  const codeHash = await sha256Hex(normalized)

  // consumo atómico: UPDATE condicional; si no afecta filas, el invite no existe o ya fue usado
  const now = new Date().toISOString()
  const consume = await c.env.DB.prepare(
    `UPDATE pairing_invites SET used_at = ?, used_by = ?
     WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?`,
  )
    .bind(now, user.id, codeHash, now)
    .run()

  if (consume.meta.changes === 0) {
    // distinguir: no existe / expirado / ya usado
    const invite = await c.env.DB.prepare('SELECT owner_id, used_at, expires_at FROM pairing_invites WHERE code_hash = ?')
      .bind(codeHash)
      .first()
    if (!invite) return c.json({ error: 'código inválido' }, 404)
    if (invite.used_at) return c.json({ error: 'código ya usado' }, 410)
    return c.json({ error: 'código expirado' }, 410)
  }

  const invite = await c.env.DB.prepare('SELECT owner_id FROM pairing_invites WHERE code_hash = ?').bind(codeHash).first()
  if (invite.owner_id === user.id) {
    // deshacer el consumo y rechazar
    await c.env.DB.prepare('UPDATE pairing_invites SET used_at = NULL, used_by = NULL WHERE code_hash = ?').bind(codeHash).run()
    return c.json({ error: 'no podés vincularte con vos mismo' }, 400)
  }

  // crear pairing canónico (user_a < user_b) — idempotente
  const [a, b] = [invite.owner_id, user.id].sort()
  await c.env.DB.prepare(
    `INSERT INTO pairings (id, user_a, user_b) VALUES (?, ?, ?)
     ON CONFLICT(user_a, user_b) DO UPDATE SET status = 'active', revoked_at = NULL, revoked_by = NULL`,
  )
    .bind(uuid(), a, b)
    .run()

  const partner = await c.env.DB.prepare('SELECT id, email, display_name FROM users WHERE id = ?').bind(invite.owner_id).first()
  await logEvent(c.env, user.id, 'invite_redeem', invite.owner_id)
  return c.json({ ok: true, partner: { id: partner.id, email: partner.email, display_name: partner.display_name } })
})

// DELETE /pair — revoca el vínculo con la pareja
app.delete('/pair', async (c) => {
  const user = await authUser(c.env, c)
  if (!user) return c.json({ error: 'no autorizado' }, 401)

  const pairing = await c.env.DB.prepare(
    `SELECT id, CASE WHEN user_a = ? THEN user_b ELSE user_a END AS partner_id
     FROM pairings WHERE (user_a = ? OR user_b = ?) AND status = 'active'`,
  )
    .bind(user.id, user.id, user.id)
    .first()

  if (!pairing) return c.json({ error: 'no hay pairing activo' }, 404)

  await c.env.DB.prepare(
    "UPDATE pairings SET status = 'revoked', revoked_at = datetime('now'), revoked_by = ? WHERE id = ?",
  )
    .bind(user.id, pairing.id)
    .run()

  await logEvent(c.env, user.id, 'unpair', pairing.partner_id)
  return c.json({ ok: true })
})

// GET /pair — lista la pareja activa y su blob (solo lectura)
app.get('/pair', async (c) => {
  const user = await authUser(c.env, c)
  if (!user) return c.json({ error: 'no autorizado' }, 401)

  const pairing = await c.env.DB.prepare(
    `SELECT
       CASE WHEN user_a = ? THEN user_b ELSE user_a END AS partner_id
     FROM pairings WHERE (user_a = ? OR user_b = ?) AND status = 'active'`,
  )
    .bind(user.id, user.id, user.id)
    .first()

  if (!pairing) return c.json({ partner: null })

  const partner = await c.env.DB.prepare('SELECT id, email, display_name FROM users WHERE id = ?').bind(pairing.partner_id).first()

  const blobRow = await c.env.DB.prepare(
    'SELECT encrypted_blob, blob_version, updated_at FROM calendar_blobs WHERE user_id = ?',
  )
    .bind(pairing.partner_id)
    .first()

  return c.json({
    partner: { id: partner.id, email: partner.email, display_name: partner.display_name },
    partnerBlob: blobRow ? { blob: blobRow.encrypted_blob, version: blobRow.blob_version, updatedAt: blobRow.updated_at } : null,
  })
})

// ---------- health ----------

app.get('/health', (c) => c.json({ ok: true, service: 'goteo-cloud' }))

export default app
