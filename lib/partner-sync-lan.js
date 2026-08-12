/**
 * partner-sync-lan.js
 *
 * Transporte LAN local (P2P, sin servidores): las apps de la pareja se
 * encuentran en la misma red y sincronizan blobs cifrados directamente.
 *
 * Diseño:
 *  - Descubrimiento: beacon UDP broadcast en puerto fijo (LAN_DISCOVERY_PORT).
 *    Cada app anuncia { pairingId, tcpPort, name } cada N segundos.
 *    Solo se empareja si el pairingId coincide con el peer vinculado.
 *  - Transferencia: conexión TCP directa; el lado "nuevo dato" envía el blob
 *    cifrado; el receptor responde OK y regenera insights.
 *
 * Nota: requiere react-native-udp + react-native-tcp-socket (módulos nativos).
 */

import TcpSocket from 'react-native-tcp-socket'
import { createSocket } from 'react-native-udp'

export const LAN_DISCOVERY_PORT = 41234
export const LAN_BEACON_INTERVAL_MS = 5000
export const LAN_TCP_PORT = 41235

const BEACON_TIMEOUT_MS = 15000 // si no se oye al peer en 15s, se lo da de baja

/**
 * Motor LAN para un pairing dado.
 * @param {Object} opts
 * @param {() => {pairingId, name}} opts.getIdentity
 * @param {() => {pairingId} | null} opts.getPeer
 * @param {() => string | null} opts.getBlob - blob cifrado actual (o null)
 * @param {(blob: string) => Promise<void>} opts.onBlobReceived
 * @param {(status: Object) => void} [opts.onStatus]
 */
export function createLanTransport(opts) {
  let udp = null
  let tcpServer = null
  let beaconTimer = null
  let lastSeen = null
  let peerAddress = null
  let running = false

  function report(s) {
    if (opts.onStatus) opts.onStatus(s)
  }

  function startUdp() {
    udp = createSocket('udp4')
    udp.on('message', (msg, rinfo) => {
      try {
        const beacon = JSON.parse(msg.toString('utf8'))
        const peer = opts.getPeer()
        if (!peer) return
        // solo nos interesa el beacon de NUESTRA pareja
        if (beacon.pairingId !== peer.pairingId) return
        lastSeen = Date.now()
        peerAddress = rinfo.address
        report({ type: 'lan-peer-seen', address: peerAddress, name: beacon.name })
      } catch (e) {
        // beacon inválido, ignorar
      }
    })
    udp.bind(LAN_DISCOVERY_PORT, () => {
      udp.setBroadcast(true)
      report({ type: 'lan-udp-ready', port: LAN_DISCOVERY_PORT })
    })
  }

  function sendBeacon() {
    if (!udp) return
    const identity = opts.getIdentity()
    if (!identity) return
    const beacon = JSON.stringify({
      pairingId: identity.pairingId,
      name: identity.name || 'yo',
      tcpPort: LAN_TCP_PORT,
    })
    try {
      udp.send(Buffer.from(beacon, 'utf8'), undefined, LAN_DISCOVERY_PORT, '255.255.255.255')
    } catch (e) {
      report({ type: 'lan-beacon-error', error: e.message })
    }
  }

  function startTcpServer() {
    tcpServer = TcpSocket.createServer((socket) => {
      let chunks = []
      socket.on('data', (chunk) => {
        chunks.push(chunk)
        const buf = Buffer.concat(chunks)
        // protocolo: [4 bytes len][blob]
        if (buf.length >= 4) {
          const len = buf.readUInt32BE(0)
          if (buf.length >= 4 + len) {
            const blob = buf.slice(4, 4 + len).toString('utf8')
            chunks = []
            opts
              .onBlobReceived(blob)
              .then(() => {
                socket.write('OK')
                report({ type: 'lan-blob-received', bytes: len })
              })
              .catch((e) => {
                socket.write('ERR:' + e.message.slice(0, 100))
                report({ type: 'lan-blob-error', error: e.message })
              })
          }
        }
      })
      socket.on('error', (e) => report({ type: 'lan-socket-error', error: e.message }))
    })
    tcpServer.listen({ port: LAN_TCP_PORT, host: '0.0.0.0' }, () => {
      report({ type: 'lan-tcp-ready', port: LAN_TCP_PORT })
    })
  }

  /** Envía el blob actual al peer si está visible en la LAN */
  async function sendToPeer(blob) {
    if (!peerAddress || !blob) return { sent: false, reason: peerAddress ? 'no-blob' : 'peer-not-visible' }
    return new Promise((resolve) => {
      const socket = TcpSocket.createConnection({ port: LAN_TCP_PORT, host: peerAddress }, () => {
        const buf = Buffer.from(blob, 'utf8')
        const header = Buffer.alloc(4)
        header.writeUInt32BE(buf.length, 0)
        socket.write(Buffer.concat([header, buf]))
      })
      const timer = setTimeout(() => {
        socket.destroy()
        resolve({ sent: false, reason: 'timeout' })
      }, 8000)
      socket.on('data', (resp) => {
        clearTimeout(timer)
        const text = resp.toString('utf8')
        socket.destroy()
        if (text === 'OK') resolve({ sent: true })
        else resolve({ sent: false, reason: text })
      })
      socket.on('error', (e) => {
        clearTimeout(timer)
        resolve({ sent: false, reason: e.message })
      })
    })
  }

  function start() {
    if (running) return
    running = true
    startUdp()
    startTcpServer()
    sendBeacon()
    beaconTimer = setInterval(sendBeacon, LAN_BEACON_INTERVAL_MS)
    // el orquestador (partner-sync) llama sendToPeer via lanSend
  }

  function stop() {
    running = false
    if (beaconTimer) clearInterval(beaconTimer)
    if (udp) {
      try { udp.close() } catch (e) { /* ya cerrado */ }
      udp = null
    }
    if (tcpServer) {
      try { tcpServer.close() } catch (e) { /* ya cerrado */ }
      tcpServer = null
    }
  }

  return {
    start,
    stop,
    sendToPeer,
    isPeerVisible: () => !!peerAddress && Date.now() - (lastSeen || 0) < BEACON_TIMEOUT_MS,
  }
}
