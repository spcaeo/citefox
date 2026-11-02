import { describe, expect, test } from 'vitest'
import { TEMPLATE_VARIABLES } from '@shared/domain'
import { analyzeTemplate, renderTemplate, TemplateCallError } from './syntax'

const channel = 'templates:update'

describe('generation template syntax', () => {
  test('reads supported names and ignores whitespace inside the braces', () => {
    const analysis = analyzeTemplate('{{url}} and {{ prompt_count }}', channel)
    expect(analysis.variables).toEqual(['url', 'prompt_count'])
    expect(analysis.warnings).toEqual([])
  })

  test('warns once for an unknown name and does not reject', () => {
    const analysis = analyzeTemplate('{{ competitor }} {{ competitor }} {{ page.title }}', channel)
    expect(analysis.warnings.map((warning) => warning.name)).toEqual(['competitor', 'page.title'])
    expect(analysis.variables).toEqual([])
  })

  test('rejects an unclosed tag without echoing the body', () => {
    const body = 'Hello {{ url SENTINEL_BODY'
    expect(() => analyzeTemplate(body, channel)).toThrow(TemplateCallError)
    try {
      analyzeTemplate(body, channel)
    } catch (error) {
      expect(error).toBeInstanceOf(TemplateCallError)
      expect((error as TemplateCallError).message).toBe('templates:update: Nunjucks syntax error')
      expect((error as TemplateCallError).message).not.toContain('SENTINEL_BODY')
    }
  })

  test('rejects a filter and a block tag as render errors', () => {
    expect(() => analyzeTemplate('{{ url | upper }}', channel)).toThrow(
      'templates:update: Nunjucks render error'
    )
    expect(() => analyzeTemplate('{% if url %}yes{% endif %}', 'playground:run')).toThrow(
      'playground:run: Nunjucks render error'
    )
  })

  test('fills known variables and blanks unknown ones', () => {
    const values = Object.fromEntries(TEMPLATE_VARIABLES.map((name) => [name, ''])) as Record<
      (typeof TEMPLATE_VARIABLES)[number],
      string
    >
    values.url = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'
    values.brand_name = 'TextBolt'
    const rendered = renderTemplate(
      'Page {{ url }} for {{ brand_name }}. {{ nope }}',
      channel,
      values
    )
    expect(rendered.text).toBe(
      'Page https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/ for TextBolt. '
    )
    expect(rendered.analysis.warnings.map((warning) => warning.name)).toEqual(['nope'])
  })

  test('rejects code in the braces, blanks prototype names, and never runs either', () => {
    const globals = globalThis as { citefoxTemplatePwned?: unknown }
    delete globals.citefoxTemplatePwned
    expect(() =>
      analyzeTemplate(
        "{{ constructor.constructor('globalThis.citefoxTemplatePwned = 1')() }}",
        channel
      )
    ).toThrow('templates:update: Nunjucks syntax error')
    const values = Object.fromEntries(TEMPLATE_VARIABLES.map((name) => [name, 'v'])) as Record<
      (typeof TEMPLATE_VARIABLES)[number],
      string
    >
    const rendered = renderTemplate('[{{ constructor }}][{{ url.constructor }}]', channel, values)
    expect(rendered.text).toBe('[][]')
    expect(rendered.analysis.warnings.map((warning) => warning.name)).toEqual([
      'constructor',
      'url.constructor'
    ])
    expect(globals.citefoxTemplatePwned).toBeUndefined()
  })
})
