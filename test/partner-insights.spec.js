import { normalizeCycles, phaseProfiles, symptomCorrelations, worstSymptomDays, generateInsights, mean, pearson } from '../lib/partner-insights'

// Genera un historial sintético de 3 ciclos de 28 días con patrones conocidos:
// - Dolor alto los días 1-2 (menstruación)
// - Ánimo bajo en fase post-ovulatoria (días 20-26)
// - Correlación positiva dolor->ánimo negativo (r<0)
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
      let pain = 0
      let mood = 4
      let desire = 2
      let bleeding = 0
      if (dayOfCycle <= 2) {
        pain = 3
        bleeding = 3
        mood = 2
        desire = 0
      } else if (dayOfCycle <= 5) {
        pain = 1
        bleeding = 2
        mood = 3
      } else if (dayOfCycle >= 20) {
        pain = 1
        mood = 2 // ánimo bajo post-ovulatorio
        desire = 1
      }
      days.push({
        date: iso,
        mood: { value: mood },
        pain: { value: pain },
        desire: { value: desire },
        bleeding: { value: bleeding },
      })
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

  test('phaseProfiles detecta dolor alto en menses', () => {
    const profiles = phaseProfiles(cycles)
    expect(profiles.menses.pain.avg).toBeGreaterThan(1.5)
    expect(profiles.postOvulatory.mood.avg).toBeLessThan(3)
    expect(profiles.postOvulatory.mood.n).toBeGreaterThan(15)
  })

  test('symptomCorrelations encuentra dolor->mood negativo', () => {
    const corrs = symptomCorrelations(cycles)
    const moodPain = corrs.find((c) => c.a === 'mood' && c.b === 'pain')
    expect(moodPain).toBeTruthy()
    expect(moodPain.r).toBeLessThan(-0.5)
  })

  test('worstSymptomDays encuentra día 1 como peor dolor', () => {
    const worst = worstSymptomDays(cycles, 'pain', 3)
    expect(worst[0].dayOfCycle).toBe(1)
    expect(worst[0].avg).toBe(3)
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
