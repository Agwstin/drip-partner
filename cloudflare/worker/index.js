/**
 * Worker API de drip-cloud — el backend de la app.
 *
 * Los datos de salud llegan SIEMPRE cifrados E2EE desde la app:
 * el server guarda blobs ininteligibles (la app cifra con las claves
 * del dispositivo antes de subir). El server solo gestiona cuentas,
 * pairing y sincronización.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()

app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PUT', 'DELETE'] }))

// ---------- helpers ----------

const uuid = () =>
  crypto.randomUUID().replace(/-/g, '')

// hash de contraseña: scrypt con salt aleatorio
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key,
    256,
  )
  const hash = btoa(String.fromCharCode(...new Uint8Array(bits)))
  return `${btoa(String.fromCharCode(...salt))}:${hash}`
}

async function verifyPassword(password, stored) {
  const [saltB64, hashB64] = stored.split(':')
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key,
    256,
  )
  const hash = btoa(String.fromCharCode(...new Uint8Array(bits)))
  return hash === hashB64
}

// hash determinista para tokens de sesión (el token ya es aleatorio de 144 bits)
async function hashToken(token) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function createSession(env, userId, deviceId) {
  const token = crypto.randomUUID() + crypto.randomUUID()
  const tokenHash = await hashToken(token)
  const expires = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString()
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, device_id, expires_at) VALUES (?, ?, ?, ?)',
  )
    .bind(tokenHash, userId, deviceId || null, expires)
    .run()
  return token
}

async function authUser(env, c) {
  const auth = c.req.header('Authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return null
  const tokenHash = await hashToken(token)
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

// ---------- auth ----------

// POST /auth/register {email, password, deviceId}
app.post('/auth/register', async (c) => {
  const env = c.env
  const { email, password, deviceId } = await c.req.json()
  if (!email || !password || password.length < 8) {
    return c.json({ error: 'email y password (min 8 chars) son requeridos' }, 400)
  }
  const id = uuid()
  const passwordHash = await hashPassword(password)
  try {
    await env.DB.prepare(
      'INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)',
    )
      .bind(id, email.toLowerCase(), passwordHash)
      .run()
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return c.json({ error: 'email ya registrado' }, 409)
    }
    throw e
  }
  const token = await createSession(env, id, deviceId)
  return c.json({ token, user: { id, email: email.toLowerCase() } }, 201)
})

// POST /auth/login {email, password, deviceId}
app.post('/auth/login', async (c) => {
  const env = c.env
  const { email, password, deviceId } = await c.req.json()
  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?')
    .bind(email.toLowerCase())
    .first()
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: 'email o password incorrectos' }, 401)
  }
  const token = await createSession(env, user.id, deviceId)
  return c.json({ token, user: { id: user.id, email: user.email, display_name: user.display_name } })
})

// POST /auth/logout
app.post('/auth/logout', async (c) => {
  const env = c.env
  const auth = c.req.header('Authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (token) {
    const tokenHash = await hashToken(token)
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run()
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

// GET /calendar — baja el blob cifrado del usuario
app.get('/calendar', async (c) => {
  const user = await authUser(c.env, c)
  if (!user) return c.json({ error: 'no autorizado' }, 401)
  const row = await c.env.DB.prepare(
    'SELECT encrypted_blob, blob_version, updated_at FROM calendar_blobs WHERE user_id = ?',
  )
    .bind(user.id)
    .first()
  if (!row) return c.json({ blob: null })
  return c.json({ blob: row.encrypted_blob, version: row.blob_version, updatedAt: row.updated_at })
})

// PUT /calendar {blob, version} — sube el blob cifrado (optimistic concurrency)
app.put('/calendar', async (c) => {
  const user = await authUser(c.env, c)
  if (!user) return c.json({ error: 'no autorizado' }, 401)
  const { blob, version } = await c.req.json()
  if (!blob) return c.json({ error: 'blob requerido' }, 400)

  const current = await c.env.DB.prepare(
    'SELECT blob_version FROM calendar_blobs WHERE user_id = ?',
  )
    .bind(user.id)
    .first()

  if (current && version && version !== current.blob_version) {
    return c.json(
      { error: 'conflicto de version: recargá y volvé a intentar', currentVersion: current.blob_version },
      409,
    )
  }

  const newVersion = (current?.blob_version || 0) + 1
  await c.env.DB.prepare(
    `INSERT INTO calendar_blobs (user_id, encrypted_blob, blob_version, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       encrypted_blob = excluded.encrypted_blob,
       blob_version = excluded.blob_version,
       updated_at = datetime('now')`,
  )
    .bind(user.id, blob, newVersion)
    .run()

  await c.env.DB.prepare(
    "INSERT INTO sync_log (user_id, action) VALUES (?, 'push')",
  )
    .bind(user.id)
    .run()

  return c.json({ ok: true, version: newVersion })
})

// ---------- pairing ----------

// POST /pair/invite — genera un código de invitación
app.post('/pair/invite', async (c) => {
  const user = await authUser(c.env, c)
  if (!user) return c.json({ error: 'no autorizado' }, 401)

  // invalidar invites previos sin usar
  await c.env.DB.prepare('DELETE FROM pairing_invites WHERE owner_id = ? AND used_at IS NULL')
    .bind(user.id)
    .run()

  const code = 'DRIP-' + Math.random().toString(36).slice(2, 6).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase()
  const expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
  await c.env.DB.prepare(
    'INSERT INTO pairing_invites (code, owner_id, expires_at) VALUES (?, ?, ?)',
  )
    .bind(code, user.id, expires)
    .run()
  return c.json({ code, expiresAt: expires })
})

// POST /pair/redeem {code} — acepta una invitación; vincula las cuentas
app.post('/pair/redeem', async (c) => {
  const user = await authUser(c.env, c)
  if (!user) return c.json({ error: 'no autorizado' }, 401)
  const { code } = await c.req.json()
  if (!code) return c.json({ error: 'code requerido' }, 400)

  const invite = await c.env.DB.prepare(
    'SELECT * FROM pairing_invites WHERE code = ?',
  )
    .bind(String(code).toUpperCase())
    .first()

  if (!invite || invite.used_at) return c.json({ error: 'código inválido o ya usado' }, 404)
  if (new Date(invite.expires_at) < new Date()) return c.json({ error: 'código expirado' }, 410)
  if (invite.owner_id === user.id) return c.json({ error: 'no podés vincularte con vos mismo' }, 400)

  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO pairings (id, user_a, user_b) VALUES (?, ?, ?)',
  )
    .bind(uuid(), invite.owner_id, user.id)
    .run()
  await c.env.DB.prepare(
    "UPDATE pairing_invites SET used_at = datetime('now') WHERE code = ?",
  )
    .bind(String(code).toUpperCase())
    .run()

  const partner = await c.env.DB.prepare(
    'SELECT id, email, display_name FROM users WHERE id = ?',
  )
    .bind(invite.owner_id)
    .first()

  return c.json({ ok: true, partner: { id: partner.id, email: partner.email, display_name: partner.display_name } })
})

// GET /pair — lista la pareja vinculada y su blob (para el modo solo-lectura)
app.get('/pair', async (c) => {
  const user = await authUser(c.env, c)
  if (!user) return c.json({ error: 'no autorizado' }, 401)

  const pairing = await c.env.DB.prepare(
    `SELECT
       CASE WHEN user_a = ? THEN user_b ELSE user_a END AS partner_id
     FROM pairings WHERE user_a = ? OR user_b = ?`,
  )
    .bind(user.id, user.id, user.id)
    .first()

  if (!pairing) return c.json({ partner: null })

  const partner = await c.env.DB.prepare(
    'SELECT id, email, display_name FROM users WHERE id = ?',
  )
    .bind(pairing.partner_id)
    .first()

  // el blob de la pareja solo si hay vínculo (solo-lectura)
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

app.get('/health', (c) => c.json({ ok: true, service: 'goteo-cloud', time: new Date().toISOString() }))

export default app
