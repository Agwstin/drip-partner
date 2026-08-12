/**
 * lib/import-export/clue-to-csv.js
 *
 * Convierte el export JSON de Clue al CSV que drip importa.
 * Port del proyecto clue-to-drip (fabfabretti, MIT) a módulo ES puro,
 * sin dependencias de browser — usable en la app y en tests.
 *
 * Formato de entrada (Clue):
 *   [{ date: "2024-01-01", type: "period", value: { option: "medium" } }, ...]
 *   (los tags tienen value: [{ option: "sad" }, ...])
 *
 * Formato de salida: CSV con los headers que import-from-csv.js espera.
 */

export const CSV_HEADERS =
  'date,temperature.value,temperature.exclude,temperature.time,temperature.note,' +
  'bleeding.value,bleeding.exclude,mucus.feeling,mucus.texture,mucus.value,mucus.exclude,' +
  'cervix.opening,cervix.firmness,cervix.position,cervix.exclude,note.value,desire.value,' +
  'sex.solo,sex.partner,sex.condom,sex.pill,sex.iud,sex.patch,sex.ring,sex.implant,' +
  'sex.diaphragm,sex.none,sex.other,sex.note,pain.cramps,pain.ovulationPain,pain.headache,' +
  'pain.backache,pain.nausea,pain.tenderBreasts,pain.migraine,pain.other,pain.note,' +
  'mood.happy,mood.sad,mood.stressed,mood.balanced,mood.fine,mood.anxious,mood.energetic,' +
  'mood.fatigue,mood.angry,mood.other,mood.note'

const BLEEDING_VALUES = { light: 1, medium: 2, heavy: 3, very_heavy: 3 }

/**
 * @param {string} dataString JSON de Clue (el archivo dentro del zip exportado)
 * @returns {Array<Object>} entradas en forma "drip-like" (una por fecha)
 */
export function clueToObjects(dataString) {
  const data = JSON.parse(dataString)
  if (!Array.isArray(data)) {
    throw new Error('El archivo de Clue no parece un array de mediciones')
  }

  const entryDates = Array.from(new Set(data.map((entry) => entry.date)))

  const dripEntries = []

  entryDates.forEach((date) => {
    const currEntries = data.filter((entry) => entry.date === date)
    const dripEntry = {}

    currEntries.forEach((entry) => {
      switch (entry.type) {
        case 'period':
          dripEntry.bleedingValue = BLEEDING_VALUES[entry.value.option] || 1
          dripEntry.bleedingExclude = false
          break
        case 'spotting':
          dripEntry.bleedingValue = 0
          dripEntry.bleedingExclude = true
          break
        case 'pain':
          ;(entry.value || []).forEach((item) => {
            switch (item.option) {
              case 'period_cramps': dripEntry.painCramps = true; break
              case 'lower_back': dripEntry.painBackache = true; break
              case 'breast_tenderness': dripEntry.painTenderBreasts = true; break
              case 'headache': dripEntry.painHeadache = true; break
              case 'ovulation': dripEntry.painOvulationPain = true; break
              case 'migraine':
              case 'migraine_with_aura':
                dripEntry.painNote = appendNote(dripEntry.painNote, item.option)
                dripEntry.painMigraine = true
                break
              case 'pain_free': break
              default:
                dripEntry.painOther = true
                dripEntry.painNote = appendNote(dripEntry.painNote, item.option)
            }
          })
          break
        case 'feelings':
          ;(entry.value || []).forEach((item) => {
            switch (item.option) {
              case 'sad': dripEntry.moodSad = true; break
              case 'happy': dripEntry.moodHappy = true; break
              case 'angry': dripEntry.moodAngry = true; break
              case 'anxious': dripEntry.moodAnxious = true; break
              case 'indifferent': dripEntry.moodFine = true; break
              default:
                dripEntry.moodOther = true
                dripEntry.moodNote = appendNote(dripEntry.moodNote, item.option)
            }
          })
          break
        case 'sex_life':
          ;(entry.value || []).forEach((item) => {
            switch (item.option) {
              case 'no_sex_today':
              case 'withdrawal': dripEntry.sexNone = true; break
              case 'masturbation': dripEntry.sexSolo = true; break
              case 'high_sex_drive': dripEntry.desireValue = 2; break
              case 'low_sex_drive': dripEntry.desireValue = 0; break
              default:
                dripEntry.sexPartner = true
                dripEntry.sexOther = true
                dripEntry.sexNote = appendNote(dripEntry.sexNote, item.option)
            }
          })
          break
        case 'energy':
          ;(entry.value || []).forEach((item) => {
            switch (item.option) {
              case 'energetic':
              case 'fully_energized': dripEntry.moodEnergetic = true; break
              case 'exhausted':
              case 'tired': dripEntry.moodFatigue = true; break
              default: break
            }
          })
          break
        case 'pms':
          dripEntry.noteValue = appendNote(dripEntry.noteValue, 'pms')
          break
        case 'digestion':
          ;(entry.value || []).forEach((item) => {
            if (item.option === 'nauseous') {
              dripEntry.painNausea = true
            } else {
              dripEntry.painOther = true
              dripEntry.painNote = appendNote(dripEntry.painNote, `[digestion: ${item.option}]`)
            }
          })
          break
        case 'discharge':
          ;(entry.value || []).forEach((item) => {
            dripEntry.mucusExclude = false
            switch (item.option) {
              case 'none': dripEntry.mucusTexture = 0; break
              case 'sticky':
              case 'creamy': dripEntry.mucusTexture = 1; break
              case 'egg_white': dripEntry.mucusTexture = 2; break
              default: break
            }
          })
          break
        case 'bbt':
          dripEntry.temperatureExclude = entry.value.excluded
          dripEntry.temperatureValue = entry.value.celsius
          dripEntry.temperatureTime = '00:00'
          break
        // tags que drip no soporta: van a la nota libre
        case 'collection_method':
        case 'social_life':
        case 'craving':
        case 'mind':
        case 'exercise':
        case 'stool':
        case 'leisure':
        case 'hair':
        case 'skin':
        case 'medication':
        case 'appointments':
        case 'ailments':
        case 'tags':
        case 'partying':
        case 'sleep_duration':
        case 'sleep_quality':
          ;(entry.value || []).forEach((item) => {
            dripEntry.noteValue = appendNote(dripEntry.noteValue, `[${entry.type}: ${item.option}]`)
          })
          break
        default:
          // tipos desconocidos: ignorar silenciosamente (no romper el import)
          break
      }
    })

    // solo guardar días con al menos un dato soportado
    if (Object.keys(dripEntry).length > 0) {
      dripEntry.date = date
      dripEntries.push(dripEntry)
    }
  })

  return dripEntries
}

function appendNote(current, text) {
  return current ? `${current} ${text}` : text
}

/** Escapa un valor para CSV (comas, comillas, saltos de línea) */
function csvEscape(value) {
  const s = String(value)
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

/**
 * @param {Array<Object>} data salida de clueToObjects()
 * @returns {string} CSV listo para import-from-csv.js
 */
export function objectsToCsv(data) {
  const rows = [CSV_HEADERS]
  const fieldMap = {
    temperatureValue: 'temperature.value',
    temperatureExclude: 'temperature.exclude',
    temperatureTime: 'temperature.time',
    temperatureNote: 'temperature.note',
    bleedingValue: 'bleeding.value',
    bleedingExclude: 'bleeding.exclude',
    mucusFeeling: 'mucus.feeling',
    mucusTexture: 'mucus.texture',
    mucusValue: 'mucus.value',
    mucusExclude: 'mucus.exclude',
    cervixOpening: 'cervix.opening',
    cervixFirmness: 'cervix.firmness',
    cervixPosition: 'cervix.position',
    cervixExclude: 'cervix.exclude',
    noteValue: 'note.value',
    desireValue: 'desire.value',
    sexSolo: 'sex.solo',
    sexPartner: 'sex.partner',
    sexCondom: 'sex.condom',
    sexPill: 'sex.pill',
    sexIud: 'sex.iud',
    sexPatch: 'sex.patch',
    sexRing: 'sex.ring',
    sexImplant: 'sex.implant',
    sexDiaphragm: 'sex.diaphragm',
    sexNone: 'sex.none',
    sexOther: 'sex.other',
    sexNote: 'sex.note',
    painCramps: 'pain.cramps',
    painOvulationPain: 'pain.ovulationPain',
    painHeadache: 'pain.headache',
    painBackache: 'pain.backache',
    painNausea: 'pain.nausea',
    painTenderBreasts: 'pain.tenderBreasts',
    painMigraine: 'pain.migraine',
    painOther: 'pain.other',
    painNote: 'pain.note',
    moodHappy: 'mood.happy',
    moodSad: 'mood.sad',
    moodStressed: 'mood.stressed',
    moodBalanced: 'mood.balanced',
    moodFine: 'mood.fine',
    moodAnxious: 'mood.anxious',
    moodEnergetic: 'mood.energetic',
    moodFatigue: 'mood.fatigue',
    moodAngry: 'mood.angry',
    moodOther: 'mood.other',
    moodNote: 'mood.note',
  }

  const headerIndex = {}
  CSV_HEADERS.split(',').forEach((h, i) => {
    headerIndex[h] = i
  })

  data.forEach((entry) => {
    const cells = new Array(CSV_HEADERS.split(',').length).fill('')
    cells[headerIndex.date] = entry.date
    Object.entries(fieldMap).forEach(([key, header]) => {
      if (entry[key] !== undefined && headerIndex[header] !== undefined) {
        cells[headerIndex[header]] = csvEscape(entry[key])
      }
    })
    rows.push(cells.join(','))
  })

  return rows.join('\n')
}

/** Función principal: JSON de Clue -> CSV de drip */
export function clueJsonToCsv(dataString) {
  return objectsToCsv(clueToObjects(dataString))
}
