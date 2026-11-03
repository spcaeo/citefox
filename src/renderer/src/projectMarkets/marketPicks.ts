import type { HelpFillRow } from '@shared/ipc'
import { LANGUAGE_OPTIONS } from '../onboarding/markets'
import { usualLanguage } from './model'

/**
 * ✦ Help me fill this in Add market: the rows main read (`country`, `language`,
 * `city`, already cleaned to codes) as picks for the drawer's own form. A pick
 * only fills the form; the drawer's button adds the market.
 */

/** One suggested market, ready to fill the Add market form. */
export interface MarketPick {
  id: string
  country: string
  language: string
  city: string
  /** "CA · English · Toronto". */
  label: string
}

/**
 * Rows as picks. A row with no language takes its country's usual one, else
 * `fallbackLanguage` (the form's). Rows without a country are left out.
 */
export function marketPicks(rows: readonly HelpFillRow[], fallbackLanguage = 'en'): MarketPick[] {
  return rows.flatMap((row) => {
    const country = (row.values.country ?? '').trim().toUpperCase()
    if (country.length === 0) return []
    const language =
      (row.values.language ?? '').trim().toLowerCase() || usualLanguage(country) || fallbackLanguage
    const city = (row.values.city ?? '').trim()
    const label = [country, languageName(language), city].filter(Boolean).join(' · ')
    return [{ id: row.id, country, language, city, label }]
  })
}

/** "English" for "en"; the code in capitals when the runtime has no name for it. */
export function languageName(code: string): string {
  const listed = LANGUAGE_OPTIONS.find((option) => option.value === code)
  if (listed) return listed.label.split(' · ')[0] ?? listed.label
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(code)
    if (name && name !== code) return name
  } catch {
    // An odd code: show it as it is.
  }
  return code.toUpperCase()
}

/**
 * The Add market language list, with `current` added when it is not one of the
 * usual ones (a pick in Portuguese shows "PT · Portuguese" instead of a wrong row).
 */
export function languageOptionsWith(current: string): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = LANGUAGE_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label
  }))
  const code = current.trim()
  if (code.length === 0 || options.some((option) => option.value === code)) return options
  return [...options, { value: code, label: `${code.toUpperCase()} · ${languageName(code)}` }]
}
