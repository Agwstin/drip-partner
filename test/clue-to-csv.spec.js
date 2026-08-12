import { clueToObjects, objectsToCsv, clueJsonToCsv } from '../lib/import-export/clue-to-csv'

// JSON de Clue en el formato real (según clue-to-drip/script.js):
// array de mediciones {date, type, value:{option|...}} — una por tag por día
const clueFixture = JSON.stringify([
  // día 1: período medio + calambres + triste
  { date: '2024-01-01', type: 'period', value: { option: 'medium' } },
  { date: '2024-01-01', type: 'pain', value: [{ option: 'period_cramps' }] },
  { date: '2024-01-01', type: 'feelings', value: [{ option: 'sad' }] },
  // día 2: spotting + dolor de espalda + bajo deseo
  { date: '2024-01-02', type: 'spotting', value: { option: 'spotting' } },
  { date: '2024-01-02', type: 'pain', value: [{ option: 'lower_back' }] },
  { date: '2024-01-02', type: 'sex_life', value: [{ option: 'low_sex_drive' }] },
  // día 3: temperatura + energía
  { date: '2024-01-03', type: 'bbt', value: { celsius: 36.5, excluded: false } },
  { date: '2024-01-03', type: 'energy', value: [{ option: 'exhausted' }] },
  // día 4: tag no soportado -> nota
  { date: '2024-01-04', type: 'exercise', value: [{ option: 'yoga' }] },
  // día 5: moco + tag custom
  { date: '2024-01-05', type: 'discharge', value: [{ option: 'egg_white' }] },
  { date: '2024-01-05', type: 'tags', value: [{ option: 'high libido' }] },
])

describe('clue-to-csv', () => {
  test('clueToObjects: agrupa por fecha y mapea período', () => {
    const entries = clueToObjects(clueFixture)
    // 5 días únicos con datos
    expect(entries).toHaveLength(5)
    const day1 = entries.find((e) => e.date === '2024-01-01')
    expect(day1.bleedingValue).toBe(2) // medium
    expect(day1.bleedingExclude).toBe(false)
    expect(day1.painCramps).toBe(true)
    expect(day1.moodSad).toBe(true)
  })

  test('spotting se marca como excluido', () => {
    const entries = clueToObjects(clueFixture)
    const day2 = entries.find((e) => e.date === '2024-01-02')
    expect(day2.bleedingValue).toBe(0)
    expect(day2.bleedingExclude).toBe(true)
    expect(day2.painBackache).toBe(true)
    expect(day2.desireValue).toBe(0)
  })

  test('bbt mapea temperatura', () => {
    const entries = clueToObjects(clueFixture)
    const day3 = entries.find((e) => e.date === '2024-01-03')
    expect(day3.temperatureValue).toBe(36.5)
    expect(day3.temperatureExclude).toBe(false)
    expect(day3.moodFatigue).toBe(true)
  })

  test('tags no soportados van a la nota', () => {
    const entries = clueToObjects(clueFixture)
    const day4 = entries.find((e) => e.date === '2024-01-04')
    expect(day4.noteValue).toContain('[exercise: yoga]')
  })

  test('moco y tags custom', () => {
    const entries = clueToObjects(clueFixture)
    const day5 = entries.find((e) => e.date === '2024-01-05')
    expect(day5.mucusTexture).toBe(2) // egg_white
    expect(day5.noteValue).toContain('[tags: high libido]')
  })

  test('objectsToCsv produce CSV con headers y valores alineados', () => {
    const entries = clueToObjects(clueFixture)
    const csv = objectsToCsv(entries)
    const lines = csv.split('\n')
    expect(lines[0]).toContain('date,temperature.value')
    expect(lines[0]).toContain('mood.note')
    const day1Line = lines.find((l) => l.startsWith('2024-01-01'))
    const day1Cols = day1Line.split(',')
    // header index de bleeding.value
    const header = lines[0].split(',')
    const bleedingIdx = header.indexOf('bleeding.value')
    const painCrampsIdx = header.indexOf('pain.cramps')
    expect(day1Cols[bleedingIdx]).toBe('2')
    expect(day1Cols[painCrampsIdx]).toBe('true')
  })

  test('clueJsonToCsv roundtrip completo', () => {
    const csv = clueJsonToCsv(clueFixture)
    expect(csv.split('\n')[0]).toContain('date,')
    expect(csv).toContain('2024-01-01')
    expect(csv).toContain('2024-01-05')
  })

  test('rechaza JSON inválido o no-array', () => {
    expect(() => clueToObjects('{not json')).toThrow()
    expect(() => clueToObjects('{"obj": 1}')).toThrow(/array/)
  })

  test('escapa comas y comillas en notas', () => {
    const fixture = JSON.stringify([
      { date: '2024-02-01', type: 'tags', value: [{ option: 'comma, and "quote"' }] },
    ])
    const csv = clueJsonToCsv(fixture)
    expect(csv).toContain('"[tags: comma, and ""quote""]"')
  })
})
