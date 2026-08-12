/**
 * partner-sync.js
 *
 * Orquestador del sync continuo híbrido:
 *  - Relay E2EE (remoto, funciona siempre)   -> partner-sync-relay.js
 *  - LAN local (misma red, sin servidores)   -> partner-sync-lan.js (plug-in)
 *
 * Ciclo:
 *  1. La persona cambia datos en la app -> buildSharePayload + cifrar
 *     -> push al relay Y a la pareja por LAN (si está visible)
 *  2. Periodicamente (y al abrir la app) -> pull del relay
 *  3. Cada blob recibido se descifra, se guarda y regenera insights
 *
 * La app ya tiene todo: buildSharePayload (emisor), encrypt/decryptForPartner,
 * deriveSharedSecret. Este módulo solo coordina cuándo y por dónde viaja.
 */

import { buildSharePayload } from './partner-share'
import { encryptForPartner, decryptFromPartner, deriveSharedSecret } from './partner-pairing'
import { relayPush, relayPull } from './partner-sync-relay'
import { createLanTransport } from './partner-sync-lan'

export const SYNC_INTERVAL_MS = 60 * 1000 // pull periodico: 1 min

/**
 * Crea el motor de sync para una pareja vinculada.
 * @param {Object} deps
 * @param {() => {secretKeyB64, publicKeyB64, pairingId}} deps.getIdentity
 * @param {() => {publicKeyB64, name} | null} deps.getPeer
 * @param {() => Array} deps.getCycleDays  - CycleDays reales de la DB
 * @param {() => Array<string>} deps.getCycleStarts
 * @param {(blob: string) => Promise<void>} deps.onReceivedBlob - guarda + regenera insights
 * @param {(status: Object) => void} [deps.onStatus] - feedback de UI (opcional)
 * @returns {{ start, stop, syncNow }}
 */
export function createPartnerSync(deps) {
  let timer = null
  let running = false
  let lastPushedAt = null
  let lastPulledAt = null
  let lanTransport = null

  const relayBaseUrl = deps.getRelayBaseUrl ? deps.getRelayBaseUrl() : null

  function report(status) {
    if (deps.onStatus) deps.onStatus(status)
  }

  /** Inicializa el transporte LAN (P2P local) si el peer está vinculado */
  function initLan() {
    if (lanTransport) return lanTransport
    const peer = deps.getPeer()
    const identity = deps.getIdentity()
    if (!peer || !identity) return null
    lanTransport = createLanTransport({
      getIdentity: () => deps.getIdentity(),
      getPeer: () => deps.getPeer(),
      getBlob: () => buildEncryptedBlob(),
      onBlobReceived: (blob) => deps.onReceivedBlob(blob),
      onStatus: (s) => report(s),
    })
    lanTransport.start()
    return lanTransport
  }

  /** Arma y cifra el blob actual de la persona (si hay datos) */
  function buildEncryptedBlob() {
    const identity = deps.getIdentity()
    const peer = deps.getPeer()
    if (!identity || !peer) return null

    const cycleDays = deps.getCycleDays()
    const cycleStarts = deps.getCycleStarts()
    if (!cycleDays || cycleDays.length === 0) return null

    const payload = buildSharePayload({
      cycleDays,
      cycleStarts,
      partnerName: peer.name || 'mi pareja',
    })
    const secret = deriveSharedSecretCached(identity, peer)
    if (!secret) return null
    return encryptForPartner(secret, JSON.stringify(payload))
  }

  let cachedSecret = null
  let cachedIdentityKey = null
  function deriveSharedSecretCached(identity, peer) {
    const key = identity.secretKeyB64 + '|' + peer.publicKeyB64
    if (cachedIdentityKey === key && cachedSecret) return cachedSecret
    cachedSecret = deriveSharedSecret(identity.secretKeyB64, peer.publicKeyB64)
    cachedIdentityKey = key
    return cachedSecret
  }

  /** Push local: sube el blob propio al relay y a la pareja por LAN */
  async function pushLocal() {
    try {
      const identity = deps.getIdentity()
      const peer = deps.getPeer()
      if (!identity || !peer) return { pushed: false, reason: 'not-paired' }

      const blob = buildEncryptedBlob()
      if (!blob) return { pushed: false, reason: 'no-data' }

      let relayResult = { ok: false, skipped: true }
      if (relayBaseUrl) {
        relayResult = await relayPush(relayBaseUrl, identity.pairingId, blob)
      }
      // LAN: transporte P2P local (si el peer está visible en la red)
      let lanResult = { ok: false, skipped: true }
      const lan = initLan()
      if (lan) {
        lanResult = await lan.sendToPeer(blob)
      }
      lastPushedAt = new Date().toISOString()
      report({ type: 'pushed', at: lastPushedAt, relay: relayResult, lan: lanResult })
      return { pushed: true, relay: relayResult, lan: lanResult }
    } catch (e) {
      report({ type: 'push-error', error: e.message })
      return { pushed: false, error: e.message }
    }
  }

  /** Pull remoto: baja el blob de la pareja desde el relay */
  async function pullRemote() {
    try {
      const identity = deps.getIdentity()
      const peer = deps.getPeer()
      if (!identity || !peer || !relayBaseUrl) return { pulled: false, reason: 'not-paired-or-no-relay' }

      // el blob de la pareja vive en el buzón del PEER (su pairingId)
      const res = await relayPull(relayBaseUrl, peer.pairingId)
      if (!res.ok) {
        report({ type: 'pull-error', error: res.error })
        return { pulled: false, error: res.error }
      }
      lastPulledAt = new Date().toISOString()
      if (res.blob) {
        await deps.onReceivedBlob(res.blob)
        report({ type: 'pulled', at: lastPulledAt, changed: true })
        return { pulled: true, changed: true }
      }
      report({ type: 'pulled', at: lastPulledAt, changed: false })
      return { pulled: true, changed: false }
    } catch (e) {
      report({ type: 'pull-error', error: e.message })
      return { pulled: false, error: e.message }
    }
  }

  /** Un ciclo de sync: push local + pull remoto */
  async function syncNow() {
    if (running) return { running: true }
    running = true
    try {
      const push = await pushLocal()
      const pull = await pullRemote()
      return { push, pull }
    } finally {
      running = false
    }
  }

  /** Arranca el ciclo periodico */
  function start() {
    if (timer) return
    const interval = deps.intervalMs || SYNC_INTERVAL_MS
    initLan() // levanta el transporte LAN (beacons + TCP server)
    // primer sync inmediato
    syncNow()
    timer = setInterval(syncNow, interval)
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    if (lanTransport) {
      lanTransport.stop()
      lanTransport = null
    }
  }

  return { start, stop, syncNow, getLastSync: () => ({ lastPushedAt, lastPulledAt }) }
}

/** Descifra un blob recibido con la clave local (helper para la UI) */
export async function handleReceivedBlob(blob, { identity, peer, saveBlob, generateInsightsFor }) {
  const secret = deriveSharedSecret(identity.secretKeyB64, peer.publicKeyB64)
  const plaintext = decryptFromPartner(secret, blob)
  const payload = JSON.parse(plaintext)
  await saveBlob({ encrypted: blob, receivedAt: new Date().toISOString() })
  const insights = generateInsightsFor(payload)
  return { payload, insights }
}
