/**
 * partner-insights.js
 *
 * Motor de inferencia local para la vista de pareja.
 * Analiza el historial de CycleDays de la persona y genera
 * insights accionables para su pareja, basados en patrones
 * estadísticos personales (NO tips genéricos).
 *
 * Filosofía: todo corre on-device, los datos nunca salen del
 * dispositivo sin cifrar (ver partner-sync).
 *
 * API: funciones puras sobre arrays de ciclos, testeables sin UI.
 */

import { LocalDate, ChronoUnit } from '@js-joda/core'

export const PHASES = ['menses', 'preOvulatory', 'periOvulatory', 'postOvulatory']

// Escala ordinal de síntomas (consistente con la UI de drip)
export const SYMPTOM_SCALES = {
  mood: { min: 1, max: 5 }, // 1 = muy mal ... 5 = muy bien
  pain: { min: 0, max: 4 }, // 0 = nada ... 4 = insoportable
  desire: { min: 0, max: 4 },
  bleeding: { min: 0, max: 4 },
}

/**
 * Normaliza un set de ciclos crudos a una estructura analizable.
 * @param {Array<{date: string, mood?: number, pain?: number, desire?: number}>} cycleDays
 *   Días con síntomas, ordenados por fecha (ISO yyyy-MM-dd).
 * @param {Array<string>} cycleStarts fechas de inicio de cada ciclo
 * @returns {Array<{index: number, days: Array<{date, dayOfCycle, phase, mood, pain, desire}>}>}
 */
export function normalizeCycles(cycleDays, cycleStarts) {
  const starts = [...cycleStarts].sort()
  if (starts.length === 0) return []

  const cycles = []
  for (let i = 0; i < starts.length; i++) {
    const start = LocalDate.parse(starts[i])
    const end =
      i + 1 < starts.length
        ? LocalDate.parse(starts[i + 1]) // exclusivo
        : start.plusDays(60) // ventana abierta para ciclo actual

    const days = cycleDays
      .map((d) => LocalDate.parse(d.date))
      .filter((d) => (d.isAfter(start) || d.equals(start)) && d.isBefore(end) && !d.isAfter(LocalDate.now()))
      .sort((a, b) => a.compareTo(b))
      .map((d) => {
        const raw = cycleDays.find((c) => c.date === d.toString())
        return {
          date: d.toString(),
          dayOfCycle: ChronoUnit.DAYS.between(start, d) + 1,
          phase: classifyPhase(d, start, end, cycleDays),
          mood: raw && raw.mood ? raw.mood.value : undefined,
          pain: raw && raw.pain ? raw.pain.value : undefined,
          desire: raw && raw.desire ? raw.desire.value : undefined,
          bleeding: raw && raw.bleeding ? raw.bleeding.value : undefined,
        }
      })
    if (days.length > 0) {
      cycles.push({ index: i, startDate: start.toString(), days })
    }
  }
  return cycles
}

/**
 * Clasifica un día en una fase del ciclo sintotérmico.
 * Heurística documentada; en el futuro se puede conectar al
 * output real de sympto (lib/sympto-adapter.js).
 */
export function classifyPhase(date, cycleStart, cycleEnd, allDays) {
  const dayOfCycle = ChronoUnit.DAYS.between(cycleStart, date) + 1

  // Menses: días con sangrado registrado
  const dayData = allDays.find((d) => d.date === date.toString())
  if (dayData && dayData.bleeding && dayData.bleeding.value > 0 && dayOfCycle <= 7) {
    return 'menses'
  }

  // Ovulación estimada: ventana alrededor del día 14 (ciclo medio típico)
  // En el futuro: usar el día del shift térmico real de sympto
  const cycleLength = ChronoUnit.DAYS.between(cycleStart, cycleEnd) + 1
  const ovulationDay = Math.max(10, Math.min(cycleLength - 8, 14))

  if (dayOfCycle < ovulationDay - 2) return 'preOvulatory'
  if (dayOfCycle <= ovulationDay + 2) return 'periOvulatory'
  return 'postOvulatory'
}

/** Promedio simple ignorando undefined */
export function mean(values) {
  const nums = values.filter((v) => v !== undefined && v !== null)
  if (nums.length === 0) return null
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

/**
 * Perfil estadístico por fase del ciclo.
 * @returns {Object} { preOvulatory: {mood: {avg, n}, pain: {...}}, ... }
 */
export function phaseProfiles(cycles) {
  const byPhase = {}
  for (const phase of PHASES) byPhase[phase] = { mood: [], pain: [], desire: [], bleeding: [] }

  for (const cycle of cycles) {
    for (const day of cycle.days) {
      if (!byPhase[day.phase]) continue
      for (const sym of ['mood', 'pain', 'desire', 'bleeding']) {
        if (day[sym] !== undefined) byPhase[day.phase][sym].push(day[sym])
      }
    }
  }

  const profiles = {}
  for (const phase of PHASES) {
    profiles[phase] = {}
    for (const sym of ['mood', 'pain', 'desire', 'bleeding']) {
      const avg = mean(byPhase[phase][sym])
      profiles[phase][sym] = {
        avg,
        n: byPhase[phase][sym].length,
      }
    }
  }
  return profiles
}

/**
 * Correlación de Pearson entre dos series (mismo largo, ignora pares con null).
 */
export function pearson(a, b) {
  const pairs = []
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== undefined && a[i] !== null && b[i] !== undefined && b[i] !== null) {
      pairs.push([a[i], b[i]])
    }
  }
  if (pairs.length < 3) return null
  const n = pairs.length
  const meanX = pairs.reduce((s, p) => s + p[0], 0) / n
  const meanY = pairs.reduce((s, p) => s + p[1], 0) / n
  let num = 0
  let dx = 0
  let dy = 0
  for (const [x, y] of pairs) {
    num += (x - meanX) * (y - meanY)
    dx += (x - meanX) ** 2
    dy += (y - meanY) ** 2
  }
  if (dx === 0 || dy === 0) return null
  return num / Math.sqrt(dx * dy)
}

/**
 * Correlaciones entre pares de síntomas a lo largo del historial.
 * @returns {Array<{a: string, b: string, r: number, n: number}>} ordenado por |r| desc
 */
export function symptomCorrelations(cycles) {
  const series = { mood: [], pain: [], desire: [], bleeding: [] }
  for (const cycle of cycles) {
    for (const day of cycle.days) {
      for (const sym of Object.keys(series)) {
        series[sym].push(day[sym] !== undefined ? day[sym] : null)
      }
    }
  }
  const pairs = [
    ['mood', 'pain'],
    ['mood', 'desire'],
    ['pain', 'desire'],
    ['pain', 'bleeding'],
    ['mood', 'bleeding'],
    ['desire', 'bleeding'],
  ]
  const results = []
  for (const [a, b] of pairs) {
    const r = pearson(series[a], series[b])
    if (r !== null && Math.abs(r) >= 0.2) {
      results.push({ a, b, r: Math.round(r * 100) / 100, n: series[a].filter((v) => v !== null).length })
    }
  }
  return results.sort((x, y) => Math.abs(y.r) - Math.abs(x.r))
}

/**
 * Detecta el día del ciclo donde un síntoma es peor en promedio.
 * @returns {Array<{dayOfCycle, phase, symptom, avg}>} top ventanas de riesgo
 */
export function worstSymptomDays(cycles, symptom = 'pain', topN = 3) {
  const byDay = {}
  for (const cycle of cycles) {
    for (const day of cycle.days) {
      if (day[symptom] === undefined) continue
      if (!byDay[day.dayOfCycle]) byDay[day.dayOfCycle] = { values: [], phase: day.phase }
      byDay[day.dayOfCycle].values.push(day[symptom])
    }
  }
  const results = []
  for (const [dayOfCycle, { values, phase }] of Object.entries(byDay)) {
    if (values.length < 2) continue
    results.push({
      dayOfCycle: Number(dayOfCycle),
      phase,
      symptom,
      avg: Math.round(mean(values) * 100) / 100,
      n: values.length,
    })
  }
  return results.sort((a, b) => b.avg - a.avg).slice(0, topN)
}

/**
 * Genera insights legibles para la pareja a partir del perfil estadístico.
 * @param {Object} profile salida de phaseProfiles()
 * @param {Array} correlations salida de symptomCorrelations()
 * @param {Array} worstDays salida de worstSymptomDays()
 * @returns {Array<{type: string, phase?: string, text: string, evidence: Object}>}
 */
export function generateInsights(profile, correlations, worstDays) {
  const insights = []

  const phaseName = {
    menses: 'menstruación',
    preOvulatory: 'fase pre-ovulatoria',
    periOvulatory: 'ventana fértil',
    postOvulatory: 'fase post-ovulatoria',
  }

  // 1. Días de dolor recurrente
  for (const w of worstDays) {
    if (w.avg >= 1.5) {
      insights.push({
        type: 'painPattern',
        phase: w.phase,
        text:
          `En los últimos ciclos, el día ${w.dayOfCycle} (${phaseName[w.phase]}) ` +
          `tu pareja suele registrar dolor (promedio ${w.avg.toFixed(1)}/4 en ${w.n} ciclos). ` +
          `Anticipate: preguntale cómo está, ofrecete a calentar una bolsa o hacerse un té.`,
        evidence: w,
      })
    }
  }

  // 2. Correlaciones personales (ciencia, no folklore)
  const relationText = {
    'mood-pain': 'cuando hay dolor, el ánimo tiende a bajar',
    'mood-desire': 'el deseo y el ánimo se mueven juntos',
    'pain-desire': 'el dolor suele venir con menor deseo',
    'pain-bleeding': 'el dolor está ligado al sangrado',
    'mood-bleeding': 'el ánimo está ligado a la menstruación',
    'desire-bleeding': 'el deseo baja durante el sangrado',
  }
  for (const c of correlations.slice(0, 2)) {
    const key = `${c.a}-${c.b}`
    const dir = c.r > 0 ? 'positiva' : 'negativa'
    insights.push({
      type: 'correlation',
      text:
        `En su historial, ${relationText[key] || `${c.a} y ${c.b} están relacionados`} ` +
        `(correlación ${dir} ${Math.abs(c.r).toFixed(2)}, ${c.n} días de datos). ` +
        `Es un patrón propio, no una generalización.`,
      evidence: c,
    })
  }

  // 3. Fase actual de mayor sensibilidad
  const moodByPhase = Object.entries(profile)
    .filter(([, v]) => v.mood && v.mood.n >= 3)
    .sort((a, b) => a[1].mood.avg - b[1].mood.avg)
  if (moodByPhase.length > 0) {
    const [phase, stats] = moodByPhase[0]
    if (stats.mood.avg <= 2.5) {
      insights.push({
        type: 'lowMoodPhase',
        phase,
        text:
          `El ánimo promedio más bajo de tu pareja ocurre en ${phaseName[phase]} ` +
          `(${stats.mood.avg.toFixed(1)}/5 en ${stats.mood.n} registros). ` +
          `En esos días, planes tranquilos y sin presión rinden mejor que sorpresas exigentes.`,
        evidence: { phase, avg: stats.mood.avg, n: stats.mood.n },
      })
    }
  }

  return insights
}
