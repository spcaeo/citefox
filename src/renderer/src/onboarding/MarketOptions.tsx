import type { JSX } from 'react'
import {
  countryOptionsFor,
  LANGUAGE_OPTIONS,
  TOP_COUNTRY_OPTIONS,
  TOP_LANGUAGE_OPTIONS,
  type CountryOption
} from './markets'

/**
 * The full list A to Z by name, the most used ones included: someone looking for India under
 * "I" must find it there too (tester feedback 2026-11-03), not only in "Most used".
 */
function inAlphabeticalOrder(options: readonly CountryOption[]): readonly CountryOption[] {
  return [...options].sort((a, b) => a.label.localeCompare(b.label, 'en'))
}

function Groups({
  options,
  topCount,
  rest
}: {
  options: readonly CountryOption[]
  topCount: number
  rest: string
}): JSX.Element {
  const render = (option: CountryOption): JSX.Element => (
    <option key={option.value} value={option.value}>
      {option.label}
    </option>
  )
  return (
    <>
      <optgroup label="Most used">{options.slice(0, topCount).map(render)}</optgroup>
      <optgroup label={rest}>{inAlphabeticalOrder(options).map(render)}</optgroup>
    </>
  )
}

/** Every country for a select, the most used first; `current` is kept as stored. */
export function CountryOptions({ current }: { current: string | null | undefined }): JSX.Element {
  return (
    <Groups
      options={countryOptionsFor(current)}
      topCount={TOP_COUNTRY_OPTIONS.length}
      rest="All countries"
    />
  )
}

/** Every language for a select, the most used first; an unlisted `current` is added. */
export function LanguageOptions({ current }: { current?: string | null }): JSX.Element {
  const code = (current ?? '').trim()
  const listed = code.length === 0 || LANGUAGE_OPTIONS.some((option) => option.value === code)
  const options = listed
    ? LANGUAGE_OPTIONS
    : [...LANGUAGE_OPTIONS, { value: code, label: code.toUpperCase() }]
  return <Groups options={options} topCount={TOP_LANGUAGE_OPTIONS.length} rest="All languages" />
}
