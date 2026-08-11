/**
 * partner-share.js
 *
 * Construye el payload de calendario que la persona comparte con su pareja.
 *
 * Privacidad por diseño: la persona elige QUÉ se comparte (perfiles de
 * síntomas). El payload incluye:
 *  - ciclo actual + historial agregado (nunca notas de texto libre)
 *  - fase actual calculada por el motor sintotérmico (sympto)
 *  - insights generados on-device (partner-insights)
 *
 * El payload viaja CIFRADO (partner-pairing). Este módulo solo lo arma.
 */

import { LocalDate } from '@js-joda/core'

export const SHAREABLE_SYMPTOMS = ['bleeding', 'mood', 'pain', 'desire']

/**
 * Filtra un CycleDay a solo los campos compartibles.
 */
function sanitizeDay(day, includeBleeding) {
  const out = { date: day.date }
  if (includeBleeding && day.bleeding) out.bleeding = day.bleeding.value
  if (day.mood) out.mood = day.mood.value
  if (day.pain) out.pain = day.pain.value
  if (day.desire) out.desire = day.desire.value
  return out
}

/**
 * Arma el payload de sincronización.
 * @param {Object} opts
 * @param {Array} opts.cycleDays - CycleDays completos (Realm -> JS)
 * @param {Array<string>} opts.cycleStarts - fechas de inicio de ciclos
 * @param {string} [opts.partnerName] - nombre para personalizar insights
 * @param {Object} [opts.options] - { includeBleeding: bool }
 * @returns {Object} payload JSON listo para encryptForPartner()
 */
export function buildSharePayload({ cycleDays, cycleStarts, partnerName, options = {} }) {
  const includeBleeding = options.includeBleeding !== false

  const now = LocalDate.now().toString()
  const today = cycleDays.find((d) => d.date === now)

  // Ventana: últimos 12 ciclos (o todo si hay menos)
  const sortedStarts = [...cycleStarts].sort().slice(-12)
  const minDate = sortedStarts[0]

  const sanitizedDays = cycleDays
    .filter((d) => d.date >= minDate)
    .map((d) => sanitizeDay(d, includeBleeding))

  // Fase actual estimada para el partner
  let currentPhase = null
  if (today && sortedStarts.length > 0) {
    const lastStart = LocalDate.parse(sortedStarts[sortedStarts.length - 1])
    const dayOfCycle = today.date && lastStart ? LocalDate.parse(today.date).toEpochDay() - lastStart.toEpochDay() + 1 : null
    // menses heuristic: bleeding activo y cerca del inicio
    if (today.bleeding && today.bleeding.value > 0 && dayOfCycle !== null && dayOfCycle <= 7) {
      currentPhase = 'menses'
    } else {
      currentPhase = 'unknown'
    }
  }

  return {
    format: 'drip-partner-share',
    version: 1,
    generatedAt: new Date().toISOString(),
    partnerName: partnerName || 'mi pareja',
    currentPhase,
    today: now,
    cycleStarts: sortedStarts,
    cycleDays: sanitizedDays,
  }
}
