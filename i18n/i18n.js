import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import moment from 'moment'
import 'moment/locale/es'
import 'moment/locale/de'

// translation files
import en from './en.json'
import de from './de.json'
import es from './es-ES.json'

const resources = {
  'en-US': { translation: en },
  'de-DE': { translation: de },
  'es-ES': { translation: es },
}

i18n
  .use(initReactI18next)
  // init i18next
  // for all options read: https://www.i18next.com/overview/configuration-options
  .init({
    resources,
    fallbackLng: 'en-US',

    interpolation: {
      escapeValue: false, // not needed for react as it escapes by default
    },
  })

// sincroniza moment (fechas) con el idioma de i18next
function applyMomentLocale(lng) {
  moment.locale(lng.startsWith('es') ? 'es' : lng.startsWith('de') ? 'de' : 'en')
}
i18n.on('languageChanged', applyMomentLocale)
applyMomentLocale(i18n.language || 'en-US')

export default i18n
