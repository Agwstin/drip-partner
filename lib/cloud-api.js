/**
 * lib/cloud-api.js
 *
 * Cliente del backend goteo-cloud (Cloudflare Workers + D1).
 * La app usa estos métodos para: cuenta (register/login), subir/bajar
 * el calendario cifrado, y pairing con la pareja.
 *
 * Todos los datos de salud viajan CIFRADOS (E2EE): la app cifra con las
 * claves del dispositivo (lib/partner-pairing.js) ANTES de llamar a este
 * módulo. El server guarda blobs ininteligibles.
 */

const DEFAULT_API_URL = 'https://goteo-cloud.drip-cloud.workers.dev'

let apiUrl = DEFAULT_API_URL
let authToken = null

export function configureCloud({ url, token }) {
  if (url) apiUrl = url.replace(/\/$/, '')
  if (token !== undefined) authToken = token
}

export function getCloudToken() {
  return authToken
}

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const effectiveToken = token !== undefined ? token : authToken
  if (effectiveToken) headers.Authorization = `Bearer ${effectiveToken}`

  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  let data = null
  try {
    data = await res.json()
  } catch (e) {
    // respuesta no-JSON (ej. 500)
  }

  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

// ---------- cuenta ----------

export async function cloudRegister(email, password, deviceId) {
  const res = await request('/auth/register', {
    method: 'POST',
    body: { email, password, deviceId },
  })
  authToken = res.token
  return res
}

export async function cloudLogin(email, password, deviceId) {
  const res = await request('/auth/login', {
    method: 'POST',
    body: { email, password, deviceId },
  })
  authToken = res.token
  return res
}

export async function cloudLogout() {
  try {
    await request('/auth/logout', { method: 'POST' })
  } finally {
    authToken = null
  }
}

export async function cloudMe() {
  const res = await request('/auth/me')
  return res.user
}

// ---------- calendario (blob E2EE) ----------

export async function cloudGetCalendar() {
  return request('/calendar')
}

export async function cloudPutCalendar(blob, version) {
  return request('/calendar', { method: 'PUT', body: { blob, version } })
}

// ---------- pairing ----------

export async function cloudCreateInvite() {
  return request('/pair/invite', { method: 'POST' })
}

export async function cloudRedeemInvite(code) {
  return request('/pair/redeem', { method: 'POST', body: { code } })
}

export async function cloudGetPair() {
  return request('/pair')
}

export async function cloudHealth() {
  return request('/health')
}
