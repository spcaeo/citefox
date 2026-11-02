import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { ProviderError } from './errors'
import { createFileFixtureSource, createFixtureHttpTransport } from './fixtures'

const FIXTURE_ROOT = join(process.cwd(), 'src/main/providers/fixtures')

function fixtureFiles(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      found.push(...fixtureFiles(path))
      continue
    }
    found.push(path)
  }
  return found
}

describe('recorded fixtures', () => {
  test('contain no emails, real keys, or non-fake hex secrets', () => {
    const files = fixtureFiles(FIXTURE_ROOT)
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toMatch(/@/)
      expect(text, file).not.toMatch(/sk-ant-/)
      const hex = text.match(/\b[a-fA-F0-9]{64}\b/g) ?? []
      for (const value of hex) expect(value, file).toBe('a'.repeat(64))
    }
  })

  test('replays a recorded HTTP body without opening a socket', async () => {
    const source = createFileFixtureSource(FIXTURE_ROOT)
    const transport = createFixtureHttpTransport(source, () => 'serpapi/account-ok.json')
    const response = await transport.request({
      method: 'GET',
      url: 'https://serpapi.com/account.json',
      timeoutMs: 1_000
    })
    expect(response.status).toBe(200)
    expect(response.body).toContain('"plan_name":"Developer"')
    expect(response.body).toContain('a'.repeat(64))
  })

  test('rejects a fixture name that leaves the directory', () => {
    const source = createFileFixtureSource(FIXTURE_ROOT)
    expect(() => source.read('../package.json')).toThrow(ProviderError)
  })
})
