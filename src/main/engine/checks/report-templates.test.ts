import { describe, expect, test } from 'vitest'
import {
  AIO_GAP_TEMPLATE,
  CheckTemplateError,
  RUN_SUMMARY_TEMPLATE,
  renderCheckTemplate,
  type CheckTemplateContext
} from './report-templates'

describe('shipped check templates', () => {
  test('aio_gap.md fills every variable with its value', () => {
    const context = filledContext()
    const rendered = renderCheckTemplate(AIO_GAP_TEMPLATE.body, context)
    expect(rendered).toBe(expected(AIO_GAP_TEMPLATE.body, context))
    expect(rendered).not.toContain('{{')
    expect(rendered).toContain('Page: https://textbolt.com/alerts\n')
    expect(rendered).toContain(
      'Sources the overview cites, in order:\n1. twilio.com\n2. textbolt.com\n\nBody line one.'
    )
    expect(rendered.startsWith('Template: aio_gap.md\n')).toBe(true)
  })

  test('run_summary.md fills every variable with its value', () => {
    const context = filledContext()
    const rendered = renderCheckTemplate(RUN_SUMMARY_TEMPLATE.body, context)
    expect(rendered).toBe(expected(RUN_SUMMARY_TEMPLATE.body, context))
    expect(rendered).toContain('Totals: 2 overviews shown for 3 prompts.')
    expect(rendered).toContain('Previous check: this page cited in none.')
    expect(rendered).toContain('Product: Email to SMS.\nTwilio, SimpleTexting\n')
    expect(rendered).not.toContain('desktop')
    expect(rendered).not.toContain('Austin')
    expect(rendered.endsWith('Reply with JSON that matches the schema and no other text.\n')).toBe(
      true
    )
  })

  test('template syntax inside a value is written as text, not run', () => {
    const context = filledContext()
    context.aio.text = '{{ page.url }} {% for x in y %}{{ x }}{% endfor %} {# hidden #}'
    context.page.title = "{{ constructor }} {{ ''.constructor }}"
    const rendered = renderCheckTemplate(AIO_GAP_TEMPLATE.body, context)
    expect(rendered).toContain(
      '\n{{ page.url }} {% for x in y %}{{ x }}{% endfor %} {# hidden #}\n'
    )
    expect(rendered).toContain("Title: {{ constructor }} {{ ''.constructor }}\n")
  })

  test('a comment renders nothing', () => {
    expect(renderCheckTemplate('A{# note #}B {{ count }}', filledContext())).toBe('AB 3')
  })

  test.each([
    ['an unknown name', 'Hello {{ nope }}'],
    ['an unknown dotted name', '{{ page.nope }}'],
    ['a name deeper than a value', '{{ page.url.length }}'],
    ['an object, not a value', '{{ page }}'],
    ['a prototype key', '{{ constructor }}'],
    ['a prototype key on a group', '{{ page.constructor }}'],
    ['a proto key', '{{ __proto__ }}'],
    ['a tag', '{% if count %}yes{% endif %}'],
    ['a filter', '{{ count | upper }}'],
    ['a call', '{{ count() }}'],
    ['an unclosed variable', 'Hello {{ count'],
    ['an empty variable', '{{ }}']
  ])('%s fails the render', (_label, body) => {
    expect(() => renderCheckTemplate(body, filledContext())).toThrow(CheckTemplateError)
  })

  test('the error message never repeats the template body', () => {
    try {
      renderCheckTemplate('secret-body {{ nope }}', filledContext())
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(CheckTemplateError)
      expect((error as Error).message).not.toContain('secret-body')
    }
  })
})

/** Reference fill: each `{{ a.b }}` replaced by its string value. */
function expected(body: string, context: CheckTemplateContext): string {
  return body.replace(/\{\{\s*([a-z0-9_.]+)\s*\}\}/g, (_match, path: string) => {
    let value: unknown = context
    for (const key of path.split('.')) {
      value = (value as Record<string, unknown>)[key]
    }
    if (typeof value !== 'string') throw new Error(`missing ${path}`)
    return value
  })
}

function filledContext(): CheckTemplateContext {
  return {
    page: {
      url: 'https://textbolt.com/alerts',
      title: 'Text alerts for business',
      meta_description: 'Send alerts.',
      h1: 'Text alerts',
      body: 'Body line one.\nBody line two.'
    },
    market: { country: 'US', language: 'en', location: 'Austin', device: 'desktop' },
    icp: 'Office managers.',
    product: 'Product: Email to SMS.',
    brand_names: 'TextBolt',
    competitors: 'Twilio, SimpleTexting',
    count: '3',
    prompts: '1. How do I alert the crew?\n2. Bulk SMS pricing',
    aio: {
      prompt: 'How do I alert the crew?',
      text: 'Use an SMS service.',
      references: '1. twilio.com\n2. textbolt.com',
      status: 'not_cited'
    },
    run: {
      aios_shown: '2',
      page_cited: '1',
      other_own_page: '0',
      named_without_link: '0',
      invisible: '1',
      previous_page_cited: 'none',
      baseline_page_cited: '0',
      content_changed: 'no',
      content_change: ''
    },
    notes: ''
  }
}
