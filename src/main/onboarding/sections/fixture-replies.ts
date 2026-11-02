import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Test-only: the recorded onboarding v2 section replies, read the same way as the e2e
 * Claude stand-in (`tests/e2e/claude-shim.mjs`). A run prompt starts with
 * `Assist: setup.<section>`; a ✦ Find more prompt ("Already listed, don't repeat")
 * reads `setup.<section>.more.json` first. Each file holds the reply as a JSON string.
 */

export const SECTION_FIXTURES = join(process.cwd(), 'src/main/assist/fixtures')

export function sectionFixtureReply(prompt: string, directory = SECTION_FIXTURES): string | null {
  const id = /^Assist: (setup\.[A-Za-z]+)$/u.exec(prompt.split('\n')[0] ?? '')?.[1]
  if (id === undefined) return null
  const names = prompt.includes("Already listed, don't repeat")
    ? [`${id}.more.json`, `${id}.json`]
    : [`${id}.json`]
  for (const name of names) {
    try {
      const value = JSON.parse(readFileSync(join(directory, name), 'utf8')) as unknown
      if (typeof value === 'string') return value
    } catch {
      // Try the next name.
    }
  }
  return null
}
