import { LocalDate } from '@js-joda/core'
import moment from 'moment'
import 'moment/locale/es'
import 'moment/locale/de'

import i18n from '../../i18n/i18n'

/** Deriva el locale de moment desde el idioma activo de i18next */
function momentLocale() {
  const lng = i18n.language || 'en-US'
  if (lng.startsWith('es')) return 'es'
  if (lng.startsWith('de')) return 'de'
  return 'en'
}

function fmt(dateString, format) {
  return moment(dateString).locale(momentLocale()).format(format)
}

export function formatDateForShortText(date) {
  return fmt(date.toString(), 'LL')
}

export function dateToTitle(dateString) {
  const today = LocalDate.now()
  const dateToDisplay = LocalDate.parse(dateString)
  return today.equals(dateToDisplay)
    ? i18n.t('cycleDay.today')
    : fmt(dateString, 'ddd DD. MMM YY')
}

export function humanizeDate(dateString) {
  if (!dateString) return ''

  const today = LocalDate.now()

  try {
    const dateToDisplay = LocalDate.parse(dateString)
    return today.equals(dateToDisplay)
      ? i18n.t('cycleDay.today')
      : fmt(dateString, 'DD. MMM YY')
  } catch (e) {
    return ''
  }
}
