// @vitest-environment happy-dom
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useState, type JSX } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { SecretField } from './SecretField'

afterEach(cleanup)

const ROOT = join(process.cwd(), 'src/renderer/src')
const OWN = join('ui', 'SecretField.tsx')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$|\.test-helper\.tsx?$/.test(entry.name)
      ? [path]
      : []
  })
}

describe('every password and key field goes through ui/SecretField (owner rule, 2026-11-02)', () => {
  it('no other file draws a type="password" input', () => {
    // `type="password"`, `type={'password'}` and `type={shown ? 'text' : 'password'}`.
    const PASSWORD_TYPE = /type=(?:["']password["']|\{[^}]*["']password["'][^}]*\})/
    const offenders = sourceFiles(ROOT)
      .map((file) => relative(ROOT, file))
      .filter((file) => file !== OWN)
      .filter((file) => PASSWORD_TYPE.test(readFileSync(join(ROOT, file), 'utf8')))
    expect(offenders).toEqual([])
  })

  it('no file sets autoComplete="off" next to a SecretField of kind password', () => {
    for (const file of sourceFiles(ROOT)) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/<SecretField[\s\S]*?\/>/g)) {
        if (/kind="password"/.test(match[0])) {
          expect(match[0], relative(ROOT, file)).toMatch(/autoComplete="(current|new)-password"/)
        }
      }
    }
  })
})

describe('SecretField', () => {
  it('a key: masked, the eye shows and hides it, no browser saving', () => {
    const view = render(<SecretField kind="key" id="k" defaultValue="sk-1" aria-label="API key" />)
    const input = view.getByLabelText('API key')
    expect(input.getAttribute('type')).toBe('password')
    expect(input.getAttribute('autocomplete')).toBe('off')
    const eye = view.getByRole('button', { name: 'Show key' })
    expect(eye.getAttribute('aria-pressed')).toBe('false')
    expect(eye.getAttribute('aria-controls')).toBe('k')
    fireEvent.click(eye)
    expect(input.getAttribute('type')).toBe('text')
    const hide = view.getByRole('button', { name: 'Hide key' })
    expect(hide.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(hide)
    expect(input.getAttribute('type')).toBe('password')
  })

  it('a password: Show password / Hide password, with the autocomplete it is given', () => {
    function Controlled(): JSX.Element {
      const [shown, setShown] = useState(false)
      return (
        <SecretField
          kind="password"
          autoComplete="current-password"
          id="p"
          aria-label="Password"
          shown={shown}
          onShownChange={setShown}
        />
      )
    }
    const view = render(<Controlled />)
    const input = view.getByLabelText('Password')
    expect(input.getAttribute('autocomplete')).toBe('current-password')
    fireEvent.click(view.getByRole('button', { name: 'Show password' }))
    expect(input.getAttribute('type')).toBe('text')
    fireEvent.click(view.getByRole('button', { name: 'Hide password' }))
    expect(input.getAttribute('type')).toBe('password')
  })
})
