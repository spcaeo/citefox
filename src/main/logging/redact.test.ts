import { describe, expect, test } from 'vitest'
import { createLogger } from './logger'
import { redactError, redactString, redactValue, REDACTED, REDACTED_PROMPT } from './redact'

const ANTHROPIC = `sk-ant-api03-${'f'.repeat(24)}`
const SERPAPI = 'ab'.repeat(32)
const UNUSUAL = 'correct-horse-battery'

describe('redaction', () => {
  test('masks Anthropic keys, SerpApi keys, bearer tokens, and api_key query params', () => {
    const input = [
      `Claude rejected ${ANTHROPIC}`,
      `serpapi ${SERPAPI}`,
      'Authorization: Bearer aaa.bbb.ccc',
      'https://serpapi.com/search.json?engine=google&api_key=super-secret&q=widgets',
      '{"api_key":"super-secret","q":"widgets"}'
    ].join('\n')
    const output = redactString(input)
    expect(output).not.toContain(ANTHROPIC)
    expect(output).not.toContain(SERPAPI)
    expect(output).not.toContain('aaa.bbb.ccc')
    expect(output).not.toContain('super-secret')
    expect(output).toContain('Bearer [REDACTED]')
    expect(output).toContain('api_key=[REDACTED]')
    expect(output).toContain('"api_key":"[REDACTED]"')
    expect(output).toContain('q=widgets')
  })

  test('masks SMTP passwords, URL userinfo, and Slack webhook URLs', () => {
    const output = redactString(
      [
        'smtp_password=s3cret!',
        'smtp-password: hunter2',
        'smtp://mailer:s3cret@smtp.example:587',
        'https://hooks.slack.com/services/T00/B00/secret'
      ].join(' ')
    )
    expect(output).not.toContain('s3cret')
    expect(output).not.toContain('hunter2')
    expect(output).not.toContain('/secret')
    expect(output).toContain('smtp_password=[REDACTED]')
    expect(output).toContain('smtp://mailer:[REDACTED]@smtp.example:587')
    expect(output).toContain(REDACTED)
  })

  test('masks a known secret that does not match a key pattern', () => {
    const output = redactString(`login failed for ${UNUSUAL} today`, { secrets: [UNUSUAL] })
    expect(output).not.toContain(UNUSUAL)
    expect(output).toContain(REDACTED)
    const short = redactString('password is abc', { secrets: ['abc'] })
    expect(short).not.toContain('abc')
    expect(short).toContain(REDACTED)
  })

  test('redacts nested objects, sensitive fields, and circular values without mutating them', () => {
    const nested: Record<string, unknown> = {
      note: `see ${ANTHROPIC}`,
      smtpPassword: UNUSUAL,
      keychainRef: 'citefox.serpapi.one',
      child: { token: 'plain-token', count: 2 }
    }
    nested.self = nested
    const output = redactValue(nested, { secrets: [UNUSUAL] }) as {
      note: string
      smtpPassword: string
      keychainRef: string
      child: { token: string; count: number }
      self: string
    }
    expect(output.note).not.toContain(ANTHROPIC)
    expect(output.smtpPassword).toBe(REDACTED)
    expect(output.keychainRef).toBe('citefox.serpapi.one')
    expect(output.child.token).toBe(REDACTED)
    expect(output.child.count).toBe(2)
    expect(output.self).toBe('[Circular]')
    expect(nested.note).toContain(ANTHROPIC)
  })

  test('replaces prompt text with [prompt] and still masks secrets', () => {
    const output = redactValue({
      prompt: `Use ${ANTHROPIC} in this prompt`,
      renderedPrompt: 'How do I alert the crew?',
      suppliedText: 'page body',
      note: 'kept'
    }) as { prompt: string; renderedPrompt: string; suppliedText: string; note: string }
    expect(output.prompt).toBe(REDACTED_PROMPT)
    expect(output.renderedPrompt).toBe(REDACTED_PROMPT)
    expect(output.suppliedText).toBe(REDACTED_PROMPT)
    expect(output.note).toBe('kept')
    const logs: string[] = []
    const logger = createLogger({
      write: (_level, line) => logs.push(line),
      secrets: [ANTHROPIC]
    })
    logger.info('claude assist', { prompt: `secret ${ANTHROPIC} and the question` })
    expect(logs[0]).toContain(REDACTED_PROMPT)
    expect(logs[0]).not.toContain(ANTHROPIC)
    expect(logs[0]).not.toContain('the question')
  })

  test('redacts error messages, stacks, and causes', () => {
    const cause = new Error(`caused by ${ANTHROPIC}`)
    const error = new Error(`request failed ${SERPAPI}`)
    error.cause = cause
    const redacted = redactError(error, { secrets: [UNUSUAL] })
    expect(error.message).toContain(SERPAPI)
    expect(redacted.message).not.toContain(SERPAPI)
    expect(redacted.stack ?? '').not.toContain(SERPAPI)
    const causeMessage =
      redacted.cause && typeof redacted.cause === 'object' && 'message' in redacted.cause
        ? String(redacted.cause.message)
        : ''
    expect(causeMessage).not.toContain(ANTHROPIC)
    expect(cause.message).toContain(ANTHROPIC)
  })

  test('logger writes only redacted lines', () => {
    const lines: string[] = []
    const logger = createLogger({
      write: (_level, line) => lines.push(line),
      secrets: [UNUSUAL]
    })
    logger.info(`using ${UNUSUAL}`, { authorization: `Bearer ${ANTHROPIC}`, ok: true })
    logger.error('boom', new Error(`smtp_password=${UNUSUAL}`))
    const dumped = lines.join('\n')
    expect(dumped).not.toContain(UNUSUAL)
    expect(dumped).not.toContain(ANTHROPIC)
    expect(dumped).toContain('INFO')
    expect(dumped).toContain('ERROR')
    expect(dumped).toContain(REDACTED)
  })
})
