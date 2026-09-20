import type { Locale as AntdLocale } from 'antdv-next/dist/locale/index'

import antdEnUS from 'antdv-next/locale/en_US'
import { createI18n } from 'vue-i18n'

import type { Language } from '@/stores/general'

import { LANGUAGE } from '@/constants'

import enUS from './en-US.json'

export const i18n = createI18n({
  legacy: false,
  locale: LANGUAGE.EN_US,
  fallbackLocale: LANGUAGE.EN_US,
  messages: {
    [LANGUAGE.EN_US]: enUS,
  },
})

export function getAntdLocale(language: Language = LANGUAGE.EN_US) {
  const antdLanguage: Record<Language, AntdLocale> = {
    [LANGUAGE.EN_US]: antdEnUS,
  }

  // Valeur persistée inconnue (ancien store) → fallback, jamais undefined.
  return antdLanguage[language] ?? antdEnUS
}
