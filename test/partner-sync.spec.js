import { createPartnerSync, handleReceivedBlob } from '../lib/partner-sync'
import { generatePairingIdentity, buildInvite, parseInvite, deriveSharedSecret, encryptForPartner, decryptFromPartner } from '../lib/partner-pairing'
import { normalizeCycles, generateInsights, phaseProfiles, worstSymptomDays, symptomCorrelations } from '../lib/partner-insights'

// Relay real en un puerto local (sin deps externas)
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')

function makeCycleDays() {
  const days = []
  const starts = ['2025-01-01', '2025-01-29', '2025-02-26']
  for (let c = 0; c < starts.length; c++) {
    const start = new Date(starts[c])
    for (let d = 0; d < 28; d++) {
      const date = new Date(start)
      date.setDate(start.getDate() + d)
      const iso = date.toISOString().slice(0, 10)
      const dayOfCycle = d + 1
      const day = { date: iso }
      if (dayOfCycle <= 2) {
        day.bleeding = { value: 3 }
        day.pain = { cramps: true, headache: true }
        day.mood = { sad: true, fatigue: true }
      } else if (dayOfCycle <= 5) {
        day.bleeding = { value: 2 }
        day.pain = { cramps: true }
        day.mood = { fine: true }
      } else if (dayOfCycle >= 20) {
        day.mood = { sad: true, stressed: true }
      } else {
        day.mood = { happy: true }
      }
      days.push(day)
    }
  }
  return days
}

function startRelay() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/health') {
      res.writeHead(200)
      res.end(JSON.stringify({ ok: true }))
      return
    }
    const m = url.pathname.match(/^\/pairing\/([0-9a-f]{8,64})$/)
    if (!m) {
      res.writeHead(404)
      res.end('{}')
      return
    }
    const file = path.join(os.tmpdir(), `relay-test-${m[1]}.json`)
    if (req.method === 'PUT') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const { blob } = JSON.parse(body)
        fs.writeFileSync(file, JSON.stringify({ blob, updatedAt: new Date().toISOString() }))
        res.writeHead(200)
        res.end(JSON.stringify({ ok: true }))
      })
      return
    }
    if (req.method === 'GET') {
      const record = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
      res.writeHead(200)
      res.end(JSON.stringify(record || { blob: null, updatedAt: null }))
      return
    }
    res.writeHead(405)
    res.end('{}')
  })
  return new Promise((resolve) => {
    server.listen(0, () => resolve({ server, port: server.address().port }))
  })
}

describe('partner-sync', () => {
  let relay
  let relayBaseUrl

  beforeAll(async () => {
    relay = await startRelay()
    relayBaseUrl = `http://localhost:${relay.port}`
  })
  afterAll(() => relay.server.close())

  test('persona push -> pareja pull via relay (E2E sin copypaste)', async () => {
    const persona = generatePairingIdentity()
    const pareja = generatePairingIdentity()
    const personaInvite = buildInvite(persona, 'Jorbis')
    parseInvite(personaInvite) // valida el invite
    const secret = deriveSharedSecret(pareja.secretKeyB64, persona.publicKeyB64)

    const cycleDays = makeCycleDays()
    const cycleStarts = ['2025-01-01', '2025-01-29', '2025-02-26']
    const received = { blobs: [] }

    // lado persona: sync motor con push al relay
    const personaSync = createPartnerSync({
      getIdentity: () => persona,
      getPeer: () => ({ pairingId: pareja.pairingId, publicKeyB64: pareja.publicKeyB64, name: 'Cami' }),
      getCycleDays: () => cycleDays,
      getCycleStarts: () => cycleStarts,
      getRelayBaseUrl: () => relayBaseUrl,
      onReceivedBlob: async (blob) => received.blobs.push(blob),
      intervalMs: 3600 * 1000, // no auto-ciclo en test
    })
    const pushRes = await personaSync.syncNow()
    expect(pushRes.push.pushed).toBe(true)
    expect(pushRes.push.relay.ok).toBe(true)

    // lado pareja: pull del relay (buzon de la persona)
    const parejaSync = createPartnerSync({
      getIdentity: () => pareja,
      getPeer: () => ({ pairingId: persona.pairingId, publicKeyB64: persona.publicKeyB64, name: 'Jorbis' }),
      getCycleDays: () => [],
      getCycleStarts: () => [],
      getRelayBaseUrl: () => relayBaseUrl,
      onReceivedBlob: async (blob) => received.blobs.push(blob),
      intervalMs: 3600 * 1000,
    })
    const pullRes = await parejaSync.syncNow()
    expect(pullRes.pull.pulled).toBe(true)
    expect(pullRes.pull.changed).toBe(true)

    // la pareja descifra el blob recibido y corre el motor
    expect(received.blobs.length).toBeGreaterThanOrEqual(1)
    const blob = received.blobs[received.blobs.length - 1]
    const plaintext = decryptFromPartner(secret, blob)
    const payload = JSON.parse(plaintext)
    expect(payload.cycleDays.length).toBe(84)

    const cycles = normalizeCycles(payload.cycleDays, payload.cycleStarts)
    const insights = generateInsights(
      phaseProfiles(cycles),
      symptomCorrelations(cycles),
      worstSymptomDays(cycles)
    )
    const painInsight = insights.find((i) => i.type === 'painPattern')
    expect(painInsight).toBeTruthy()
    expect(painInsight.text).toContain('día 1')
  })

  test('handleReceivedBlob descifra, guarda y genera insights', async () => {
    const persona = generatePairingIdentity()
    const pareja = generatePairingIdentity()
    const secret = deriveSharedSecret(persona.secretKeyB64, pareja.publicKeyB64)
    const payload = {
      format: 'drip-partner-share',
      version: 1,
      cycleStarts: ['2025-01-01'],
      cycleDays: [{ date: '2025-01-01', pain: { cramps: true }, mood: { sad: true } }],
    }
    const blob = encryptForPartner(secret, JSON.stringify(payload))
    const saved = []
    const { payload: out, insights } = await handleReceivedBlob(blob, {
      identity: persona,
      peer: { publicKeyB64: pareja.publicKeyB64 },
      saveBlob: async (b) => saved.push(b),
      generateInsightsFor: (p) => {
        const cycles = normalizeCycles(p.cycleDays, p.cycleStarts)
        return generateInsights(phaseProfiles(cycles), symptomCorrelations(cycles), worstSymptomDays(cycles))
      },
    })
    expect(out.cycleDays).toHaveLength(1)
    expect(saved).toHaveLength(1)
    expect(Array.isArray(insights)).toBe(true)
  })
})
