import { buildSharePayload } from '../lib/partner-share'
import {
  generatePairingIdentity,
  deriveSharedSecret,
  encryptForPartner,
  decryptFromPartner,
} from '../lib/partner-pairing'
import { normalizeCycles, generateInsights, phaseProfiles, worstSymptomDays, symptomCorrelations } from '../lib/partner-insights'

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
      if (dayOfCycle <= 5) {
        day.bleeding = { value: dayOfCycle <= 2 ? 3 : 2 }
        day.pain = { value: dayOfCycle <= 2 ? 3 : 1 }
        day.mood = { value: dayOfCycle <= 2 ? 2 : 3 }
      } else if (dayOfCycle >= 20) {
        day.mood = { value: 2 }
        day.pain = { value: 1 }
      } else {
        day.mood = { value: 4 }
      }
      if (dayOfCycle % 3 === 0) day.desire = { value: 2 }
      days.push(day)
    }
  }
  return days
}

describe('partner-share', () => {
  const cycleDays = makeCycleDays()
  const starts = ['2025-01-01', '2025-01-29', '2025-02-26']

  test('buildSharePayload sanitiza: sin notas ni temperatura', () => {
    const withNotes = [...cycleDays]
    withNotes[0].note = { value: 'secreto' }
    withNotes[0].temperature = { value: 36.6 }
    const payload = buildSharePayload({ cycleDays: withNotes, cycleStarts: starts })
    for (const d of payload.cycleDays) {
      expect(d.note).toBeUndefined()
      expect(d.temperature).toBeUndefined()
      expect(Object.keys(d)).toEqual(expect.arrayContaining(['date']))
    }
  })

  test('payload incluye cicloStarts y formato correcto', () => {
    const payload = buildSharePayload({ cycleDays, cycleStarts: starts })
    expect(payload.format).toBe('drip-partner-share')
    expect(payload.cycleStarts).toEqual(starts)
    expect(payload.cycleDays.length).toBeGreaterThan(0)
  })

  test('includeBleeding=false excluye sangrado', () => {
    const payload = buildSharePayload({
      cycleDays,
      cycleStarts: starts,
      options: { includeBleeding: false },
    })
    const d = payload.cycleDays[0]
    expect(d.bleeding).toBeUndefined()
  })

  test('flujo E2E completo: share -> cifrar -> descifrar -> insights', () => {
    // persona y pareja hacen pairing
    const persona = generatePairingIdentity()
    const pareja = generatePairingIdentity()
    const secretPersona = deriveSharedSecret(persona.secretKeyB64, pareja.publicKeyB64)
    const secretPareja = deriveSharedSecret(pareja.secretKeyB64, persona.publicKeyB64)

    // persona arma el payload y lo cifra
    const payload = buildSharePayload({ cycleDays, cycleStarts: starts, partnerName: 'Cami' })
    const encrypted = encryptForPartner(secretPersona, JSON.stringify(payload))

    // pareja lo descifra
    const plaintext = decryptFromPartner(secretPareja, encrypted)
    const received = JSON.parse(plaintext)
    expect(received.partnerName).toBe('Cami')
    expect(received.cycleDays.length).toBe(payload.cycleDays.length)

    // pareja corre el motor de inferencia sobre los datos recibidos
    const cycles = normalizeCycles(
      received.cycleDays.map((d) => ({
        ...d,
        mood: d.mood !== undefined ? { value: d.mood } : undefined,
        pain: d.pain !== undefined ? { value: d.pain } : undefined,
        desire: d.desire !== undefined ? { value: d.desire } : undefined,
        bleeding: d.bleeding !== undefined ? { value: d.bleeding } : undefined,
      })),
      received.cycleStarts
    )
    const insights = generateInsights(
      phaseProfiles(cycles),
      symptomCorrelations(cycles),
      worstSymptomDays(cycles)
    )
    // el motor detecta el patrón de dolor del día 1 en los datos recibidos
    const painInsight = insights.find((i) => i.type === 'painPattern')
    expect(painInsight).toBeTruthy()
    expect(painInsight.text).toContain('día 1')
  })
})
