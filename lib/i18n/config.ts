export interface LocaleMeta {
  code: string
  label: string // native-language name, shown in the language switcher
  dir: 'ltr' | 'rtl'
}

export const SOURCE_LOCALE = 'en'
export const DEFAULT_LOCALE = 'en'

// en source + 14 target languages, incl. RTL Arabic and CJK (ja/ko).
// Mandarin (zh) dropped; Filipino (fil) and Thai (th) added in its place.
export const LOCALES: LocaleMeta[] = [
  { code: 'en', label: 'English', dir: 'ltr' },
  { code: 'es', label: 'Español', dir: 'ltr' },
  { code: 'fr', label: 'Français', dir: 'ltr' },
  { code: 'de', label: 'Deutsch', dir: 'ltr' },
  { code: 'pt', label: 'Português', dir: 'ltr' },
  { code: 'nl', label: 'Nederlands', dir: 'ltr' },
  { code: 'el', label: 'Ελληνικά', dir: 'ltr' },
  { code: 'sk', label: 'Slovenčina', dir: 'ltr' },
  { code: 'lv', label: 'Latviešu', dir: 'ltr' },
  { code: 'it', label: 'Italiano', dir: 'ltr' },
  { code: 'ja', label: '日本語', dir: 'ltr' },
  { code: 'ko', label: '한국어', dir: 'ltr' },
  { code: 'ar', label: 'العربية', dir: 'rtl' },
  { code: 'fil', label: 'Filipino', dir: 'ltr' },
  { code: 'th', label: 'ไทย', dir: 'ltr' },
]

export const TARGET_LOCALES: LocaleMeta[] = LOCALES.filter((l) => l.code !== SOURCE_LOCALE)

export function isLocale(value: string): boolean {
  return LOCALES.some((l) => l.code === value)
}

export function getLocaleMeta(code: string): LocaleMeta {
  return LOCALES.find((l) => l.code === code) ?? LOCALES[0]
}

export function getDir(code: string): 'ltr' | 'rtl' {
  return getLocaleMeta(code).dir
}
