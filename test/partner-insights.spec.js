import { normalizeCycles, phaseProfiles, symptomCorrelations, worstSymptomDays, generateInsights, mean, pearson, normalizePain, normalizeMood } from '../lib/partner-insights'

// Genera un historial sintético de 3 ciclos de 28 días con patrones conocidos,
// usando la FORMA REAL de los CycleDay de drip (Realm): booleans por síntoma.
// - Días 1-2 (menstruación): cramps+headache (2 síntomas de dolor), mood sad+fatigue
// - Días 3-5: bleeding bajo, pain leve
// - Días 20-26 (post-ovu): mood sad+stressed+fatigue (negativo), pain 1
function syntheticCycleDays() {
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
        day.pain = { cramps: true }
        day.mood = { sad: true, stressed: true, fatigue: true } // ánimo bajo post-ovu
      } else {
        day.mood = { happy: true, balanced: true }
      }
      if (dayOfCycle % 3 === 0) day.desire = { value: 2 }
      days.push(day)
    }
  }
  return days
}

describe('partner-insights', () => {
  const rawDays = syntheticCycleDays()
  const starts = ['2025-01-01', '2025-01-29', '2025-02-26']
  const cycles = normalizeCycles(rawDays, starts)

  test('normalizeCycles produce 3 ciclos con 28 días cada uno', () => {
    expect(cycles).toHaveLength(3)
    for (const c of cycles) expect(c.days).toHaveLength(28)
    expect(cycles[0].days[0].dayOfCycle).toBe(1)
  })

  test('clasifica menstruación los primeros días', () => {
    expect(cycles[0].days[0].phase).toBe('menses')
    expect(cycles[0].days[1].phase).toBe('menses')
  })

  test('normalizePain cuenta síntomas booleanos reales de Realm', () => {
    expect(normalizePain({ cramps: true, headache: true })).toBe(2)
    expect(normalizePain({ cramps: true })).toBe(1)
    expect(normalizePain({})).toBeUndefined()
    expect(normalizePain(undefined)).toBeUndefined()
    expect(normalizePain({ value: 3 })).toBe(3) // forma legacy
  })

  test('normalizeMood mapea booleans a escala -2..+2', () => {
    expect(normalizeMood({ happy: true, balanced: true })).toBe(2)
    expect(normalizeMood({ sad: true, fatigue: true })).toBe(-2)
    expect(normalizeMood({ sad: true, happy: true })).toBe(0)
    expect(normalizeMood({})).toBe(0)
    expect(normalizeMood(undefined)).toBeUndefined()
    expect(normalizeMood({ value: 4 })).toBe(4) // forma legacy
  })

  test('mean ignora undefined', () => {
    expect(mean([1, 2, 3])).toBe(2)
    expect(mean([1, undefined, 3])).toBe(2)
    expect(mean([])).toBeNull()
  })

  test('pearson detecta correlación negativa fuerte', () => {
    const r = pearson([1, 2, 3, 4, 5], [5, 4, 3, 2, 1])
    expect(r).toBeCloseTo(-1)
    expect(pearson([1, 2], [1, 2])).toBeNull() // n<3
  })

  test('phaseProfiles detecta dolor alto en menses (datos Realm reales)', () => {
    const profiles = phaseProfiles(cycles)
    expect(profiles.menses.pain.avg).toBeGreaterThan(1)
    expect(profiles.postOvulatory.mood.avg).toBeLessThan(0)
    expect(profiles.postOvulatory.mood.n).toBeGreaterThan(15)
  })

  test('symptomCorrelations encuentra dolor->mood negativo (dataset diseñado)', () => {
    // 2 ciclos donde días con dolor fuerte tienen mood negativo y viceversa
    const days = []
    const starts = ['2025-01-01', '2025-02-01']
    for (let c = 0; c < starts.length; c++) {
      const start = new Date(starts[c])
      for (let d = 0; d < 20; d++) {
        const date = new Date(start)
        date.setDate(start.getDate() + d)
        const iso = date.toISOString().slice(0, 10)
        const day = { date: iso }
        if (d % 2 === 0) {
          day.pain = { cramps: true, headache: true, backache: true } // 3 síntomas
          day.mood = { sad: true, angry: true } // -2
        } else {
          day.pain = { cramps: true } // 1 síntoma
          day.mood = { happy: true, balanced: true } // +2
        }
        days.push(day)
      }
    }
    const cycles = normalizeCycles(days, starts)
    const corrs = symptomCorrelations(cycles)
    const moodPain = corrs.find((c) => c.a === 'mood' && c.b === 'pain')
    expect(moodPain).toBeTruthy()
    expect(moodPain.r).toBeLessThan(-0.5)
    // n debe contar pares válidos (ambas series), no días totales
    expect(moodPain.n).toBeLessThanOrEqual(40)
  })

  test('worstSymptomDays encuentra día 1 como peor dolor', () => {
    const worst = worstSymptomDays(cycles, 'pain', 3)
    expect(worst[0].dayOfCycle).toBe(1)
    expect(worst[0].avg).toBe(2)
  })

  test('generateInsights produce insights con evidencia', () => {
    const insights = generateInsights(
      phaseProfiles(cycles),
      symptomCorrelations(cycles),
      worstSymptomDays(cycles)
    )
    expect(insights.length).toBeGreaterThanOrEqual(2)
    for (const i of insights) {
      expect(i.text).toBeTruthy()
      expect(i.evidence).toBeTruthy()
    }
    const painInsight = insights.find((i) => i.type === 'painPattern')
    expect(painInsight).toBeTruthy()
    expect(painInsight.text).toContain('día 1')
  })
})
