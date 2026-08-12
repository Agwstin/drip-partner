/**
 * partner-sync-relay.js
 *
 * Cliente del relay E2EE (relay/server.js). Transporte remoto del sync:
 * la app sube su blob cifrado cuando cambian los datos y baja el de la
 * pareja (periodicamente o al abrir).
 *
 * El relay solo almacena blobs cifrados: nunca ve el contenido.
 */

const RELAY_TIMEOUT_MS = 15000

/**
 * Sube el blob cifrado actual al relay.
 * @param {string} relayBaseUrl ej. "https://relay.ejemplo.com"
 * @param {string} pairingId
 * @param {string} encryptedBlob base64
 * @returns {Promise<{ok: boolean, updatedAt?: string, error?: string}>}
 */
export async function relayPush(relayBaseUrl, pairingId, encryptedBlob) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), RELAY_TIMEOUT_MS)
    const res = await fetch(`${relayBaseUrl}/pairing/${pairingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blob: encryptedBlob }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return { ok: false, error: `relay HTTP ${res.status}` }
    const data = await res.json()
    return { ok: true, updatedAt: data.updatedAt }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

/**
 * Baja el blob de la pareja desde el relay.
 * @returns {Promise<{ok: boolean, blob?: string, updatedAt?: string, error?: string}>}
 */
export async function relayPull(relayBaseUrl, pairingId) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), RELAY_TIMEOUT_MS)
    const res = await fetch(`${relayBaseUrl}/pairing/${pairingId}`, {
      method: 'GET',
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return { ok: false, error: `relay HTTP ${res.status}` }
    const data = await res.json()
    if (!data.blob) return { ok: true, blob: null, updatedAt: data.updatedAt }
    return { ok: true, blob: data.blob, updatedAt: data.updatedAt }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

/** Valida una URL de relay razonable (http/https, sin path) */
export function isValidRelayUrl(url) {
  try {
    const u = new URL(url)
    return (u.protocol === 'http:' || u.protocol === 'https:') && !u.pathname || u.pathname === '/'
  } catch (e) {
    return false
  }
}
