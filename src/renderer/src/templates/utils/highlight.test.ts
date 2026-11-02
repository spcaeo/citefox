import { describe, expect, test } from 'vitest'
import { hasTemplateError, tokenizeTemplate, unknownVariables } from './highlight'

describe('tokenizeTemplate', () => {
  test('splits text, variables and comments and keeps every character', () => {
    const body = 'Title: {{ title }}\n{# a note #}Brand: {{brand_name}}.'
    const tokens = tokenizeTemplate(body, 'buyer_prompts')
    expect(tokens.map((token) => token.kind)).toEqual([
      'text',
      'variable',
      'text',
      'comment',
      'text',
      'variable',
      'text'
    ])
    expect(tokens.map((token) => token.text).join('')).toBe(body)
    expect(tokens[1]?.name).toBe('title')
    expect(tokens[5]?.name).toBe('brand_name')
  })

  test('a name the step does not fill is a warning, by kind', () => {
    expect(tokenizeTemplate('{{ page.url }}', 'buyer_prompts')[0]?.kind).toBe('unknown')
    expect(tokenizeTemplate('{{ page.url }}', 'aio_gap')[0]?.kind).toBe('variable')
    expect(tokenizeTemplate('{{ url }}', 'run_summary')[0]?.kind).toBe('unknown')
    expect(unknownVariables('{{ nope }} {{ url }} {{ nope }} {{ other }}', 'coverage')).toEqual([
      'nope',
      'other'
    ])
  })

  test('a kind added later accepts both variable lists', () => {
    expect(unknownVariables('{{ url }} {{ aio.text }}', 'some_new_step')).toEqual([])
  })

  test('tags, filters, nesting and unclosed braces are errors', () => {
    expect(tokenizeTemplate('{% if x %}', 'coverage')[0]?.kind).toBe('error')
    expect(tokenizeTemplate('{{ title | upper }}', 'coverage')[0]?.kind).toBe('error')
    expect(tokenizeTemplate('{# {{ x }} #}', 'coverage')[0]?.kind).toBe('error')
    const unclosed = tokenizeTemplate('Hello {{ title', 'coverage')
    expect(unclosed.map((token) => token.kind)).toEqual(['text', 'error'])
    expect(unclosed.map((token) => token.text).join('')).toBe('Hello {{ title')
    expect(hasTemplateError('Hello {{ title', 'coverage')).toBe(true)
    expect(hasTemplateError('Hello {{ title }} {# ok #}', 'coverage')).toBe(false)
  })

  test('a single brace is plain text', () => {
    const tokens = tokenizeTemplate('JSON like { "a": 1 } stays text', 'coverage')
    expect(tokens).toEqual([{ kind: 'text', text: 'JSON like { "a": 1 } stays text' }])
  })
})
