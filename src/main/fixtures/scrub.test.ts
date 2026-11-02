import { describe, expect, test } from 'vitest'
import { scrubFixture } from '../../../scripts/record-fixtures'

describe('record-fixtures scrub', () => {
  test('removes exact secrets, key shapes, and token fields', () => {
    const secret = 'local-env-secret-value'
    const bearer = 'abc.def-ghi_123'
    const hex = 'a'.repeat(64)
    const anthropic = 'sk-ant-api03-abcdefghij'
    const scrubbed = scrubFixture(
      {
        status: 200,
        body: {
          note: `key ${secret} and ${anthropic}`,
          authorization: `Bearer ${bearer}`,
          token: secret,
          link: `https://serpapi.com/search.json?api_key=${hex}&engine=google`
        }
      },
      [secret]
    )
    const encoded = JSON.stringify(scrubbed)
    expect(encoded).not.toContain(secret)
    expect(encoded).not.toContain(anthropic)
    expect(encoded).not.toContain(bearer)
    expect(encoded).not.toContain(hex)
    expect(encoded).toContain('[REDACTED]')
    expect(encoded).toContain('api_key=[REDACTED]')
  })

  test('keeps a SHA-256 on a hash field and still redacts the same digest elsewhere', () => {
    const hash = 'ab'.repeat(32)
    const key = 'cd'.repeat(32)
    const scrubbed = scrubFixture(
      {
        templateHash: hash,
        content_hash: hash,
        inputHash: hash.toUpperCase(),
        hash,
        note: `fingerprint ${hash}`,
        token: key,
        nested: { templateHash: hash, other: key }
      },
      [key]
    ) as {
      templateHash: string
      content_hash: string
      inputHash: string
      hash: string
      note: string
      token: string
      nested: { templateHash: string; other: string }
    }
    expect(scrubbed.templateHash).toBe(hash)
    expect(scrubbed.content_hash).toBe(hash)
    expect(scrubbed.inputHash).toBe(hash.toUpperCase())
    expect(scrubbed.hash).toBe(hash)
    expect(scrubbed.nested.templateHash).toBe(hash)
    expect(scrubbed.note).not.toContain(hash)
    expect(scrubbed.token).toBe('[REDACTED]')
    expect(scrubbed.nested.other).toBe('[REDACTED]')
    expect(JSON.stringify(scrubbed)).not.toContain(key)

    const leaked = scrubFixture({ templateHash: key }, [key]) as { templateHash: string }
    expect(leaked.templateHash).toBe('[REDACTED]')
  })
})
