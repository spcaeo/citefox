import { describe, expect, test } from 'vitest'
import {
  TemplateSyntaxError,
  parseTemplate,
  renderTemplateParts,
  templateNames
} from './template-syntax'

function render(body: string, values: Record<string, string | number>): string {
  return renderTemplateParts(parseTemplate(body), values)
}

function issueOf(body: string): string | null {
  try {
    parseTemplate(body)
    return null
  } catch (error) {
    return error instanceof TemplateSyntaxError ? error.issue : 'other'
  }
}

describe('template syntax', () => {
  test('fills own keys, keeps lone braces, and drops comments', () => {
    expect(
      render('{{url}} and {{ prompt_count }} {# note #}{ x }', { url: 'u', prompt_count: 10 })
    ).toBe('u and 10 { x }')
    expect(templateNames('{{ a }} {{ b.c }} {{ a }}')).toEqual(['a', 'b.c'])
  })

  test('blanks unknown and dotted names and never walks a prototype', () => {
    const values = { url: 'https://example.com' }
    expect(render('[{{ missing }}][{{ url.length }}][{{ constructor }}]', values)).toBe('[][][]')
    expect(render('[{{ toString }}][{{ __proto__ }}][{{ hasOwnProperty }}]', values)).toBe('[][][]')
    expect(render('[{{ constructor.constructor }}]', values)).toBe('[]')
  })

  test('rejects code inside the braces and never runs it', () => {
    const globals = globalThis as { citefoxTemplatePwned?: unknown }
    delete globals.citefoxTemplatePwned
    for (const body of [
      "{{ constructor.constructor('globalThis.citefoxTemplatePwned = 1')() }}",
      "{{ url.constructor.constructor('return process')() }}",
      "{{ range.constructor('globalThis.citefoxTemplatePwned = 1')() }}",
      '{{ url["constructor"] }}',
      '{{ 1 + 1 }}',
      "{{ 'text' }}"
    ]) {
      expect(issueOf(body)).toBe('syntax')
      expect(templateNames(body)).toEqual([])
    }
    expect(globals.citefoxTemplatePwned).toBeUndefined()
  })

  test('rejects tags and filters as unsupported, and unclosed spans as syntax', () => {
    expect(issueOf('{% if url %}yes{% endif %}')).toBe('unsupported')
    expect(issueOf("{% set x = 'a' %}")).toBe('unsupported')
    expect(issueOf('{{ url | upper }}')).toBe('unsupported')
    expect(issueOf('Hello {{ url SENTINEL')).toBe('syntax')
    expect(issueOf('{{ }}')).toBe('syntax')
    expect(issueOf('{{ a {{ b }}')).toBe('syntax')
    expect(issueOf('{# open')).toBe('syntax')
  })

  test('the error message never echoes the body', () => {
    try {
      parseTemplate('{% if %} sk-ant-api03-abcdefghij')
    } catch (error) {
      expect((error as Error).message.includes('sk-ant')).toBe(false)
    }
  })

  test('scans a hostile body in linear time', () => {
    const hostile = '{{'.repeat(50_000) + '{'.repeat(50_000) + '{%'.repeat(50_000)
    const started = performance.now()
    expect(templateNames(hostile)).toEqual([])
    expect(issueOf(hostile)).toBe('syntax')
    expect(templateNames('{{ a }}'.repeat(20_000))).toEqual(['a'])
    expect(performance.now() - started).toBeLessThan(1000)
  })
})
