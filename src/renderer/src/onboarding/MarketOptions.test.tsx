// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { CountryOptions } from './MarketOptions'

afterEach(cleanup)

describe('country dropdown groups', () => {
  test('India is in Most used and also in the full A to Z list', () => {
    const view = render(
      <select>
        <CountryOptions current="US" />
      </select>
    )
    const groups = [...view.container.querySelectorAll('optgroup')]
    expect(groups.map((group) => group.label)).toEqual(['Most used', 'All countries'])
    const names = (group: Element | undefined): string[] =>
      [...(group?.querySelectorAll('option') ?? [])].map((option) => option.textContent ?? '')
    expect(names(groups[0])).toContain('India · IN 🇮🇳')
    const all = names(groups[1])
    expect(all).toContain('India · IN 🇮🇳')
    expect(all.length).toBeGreaterThan(200)
    // A to Z by name: Iceland, then India, then Indonesia.
    const at = (name: string): number => all.findIndex((label) => label.startsWith(`${name} ·`))
    expect(at('Iceland')).toBeLessThan(at('India'))
    expect(at('India')).toBeLessThan(at('Indonesia'))
  })
})
