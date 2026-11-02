import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

/**
 * The e2e Claude stand-in's routing (`tests/e2e/claude-shim.mjs`,
 * Docs/PROMPT-AUDIT.md section 3, rule 7). Spawned with plain Node: no app,
 * no window, no network.
 */

const SHIM = join(process.cwd(), 'tests/e2e/claude-shim.mjs')
const TOPIC_FIXTURES = join(process.cwd(), 'src/main/topics/fixtures')
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'citefox-shim-test-'))
  dirs.push(dir)
  return dir
}

function runShim(
  prompt: string,
  env: Record<string, string> = {}
): { status: number | null; json: unknown; log: string[] } {
  const dir = tempDir()
  const logPath = join(dir, 'shim.log')
  const result = spawnSync(process.execPath, [SHIM, '-p'], {
    input: prompt,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      CITEFOX_FIXTURE_DIR: dir,
      CITEFOX_SHIM_LOG: logPath,
      ...env
    }
  })
  let log: string[]
  try {
    log = readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
  } catch {
    log = []
  }
  const envelope =
    result.status === 0 ? (JSON.parse(result.stdout) as { structured_output: unknown }) : null
  return { status: result.status, json: envelope?.structured_output ?? null, log }
}

function fixtureFolder(files: Record<string, unknown>): string {
  const dir = tempDir()
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), JSON.stringify(body))
  }
  return dir
}

describe('claude shim routing', () => {
  test('Template: <kind>.md loads <kind>.json and logs topic-<kind>', () => {
    const result = runShim('Template: topic_summary.md\nYou are writing the summary line.')
    expect(result.status).toBe(0)
    expect(result.json).toEqual(
      JSON.parse(readFileSync(join(TOPIC_FIXTURES, 'topic_summary.json'), 'utf8'))
    )
    expect(result.log[0]).toBe('topic-topic_summary')
  })

  test('page match is built from the prompt lines', () => {
    const result = runShim(
      'Template: topic_page_match.md\nhttps://textbolt.com/a/ · A · H\ntq-1 · One\ntq-2 · Two'
    )
    expect(result.status).toBe(0)
    expect((result.json as { matches: { id: string }[] }).matches.map((m) => m.id)).toEqual([
      'tq-1',
      'tq-2'
    ])
  })

  test('Variant: <x> loads <kind>.<x>.json first, else <kind>.json', () => {
    const folder = fixtureFolder({
      'coverage_matrix.json': { rows: ['plain'] },
      'coverage_matrix.batch2.json': { rows: ['variant'] }
    })
    const env = { CITEFOX_TEMPLATE_FIXTURE_DIRS: folder }
    const withVariant = runShim('Template: coverage_matrix.md\nVariant: batch2\nRows:', env)
    expect(withVariant.json).toEqual({ rows: ['variant'] })
    expect(withVariant.log[0]).toBe('template-coverage_matrix.batch2')
    const missing = runShim('Template: coverage_matrix.md\nVariant: other\nRows:', env)
    expect(missing.json).toEqual({ rows: ['plain'] })
    expect(missing.log[0]).toBe('template-coverage_matrix')
    const topicStage = runShim('Template: topic_journey_questions.md\nVariant: compare\n', {
      CITEFOX_TEMPLATE_FIXTURE_DIRS: fixtureFolder({
        'topic_journey_questions.compare.json': { questions: [] }
      })
    })
    expect(topicStage.log[0]).toBe('topic-topic_journey_questions.compare')
  })

  test('folders are searched in order, and envelopes are unwrapped', () => {
    const first = fixtureFolder({
      'page_audit.json': { body: { content: [{ text: '{"findings":["first"]}' }] } }
    })
    const second = fixtureFolder({ 'page_audit.json': { findings: ['second'] } })
    const anthropic = runShim('Template: page_audit.md\n', {
      CITEFOX_TEMPLATE_FIXTURE_DIRS: [first, second].join(delimiter)
    })
    expect(anthropic.json).toEqual({ findings: ['first'] })
    const cli = runShim('Template: page_audit.md\n', {
      CITEFOX_TEMPLATE_FIXTURE_DIRS: fixtureFolder({
        'page_audit.json': { structured_output: { findings: ['cli'] } }
      })
    })
    expect(cli.json).toEqual({ findings: ['cli'] })
  })

  test('a non-topic kind with no fixture falls back to the older routes', () => {
    const result = runShim('Template: some_check.md\nReply with JSON only: {"ok": true}', {
      CITEFOX_TEMPLATE_FIXTURE_DIRS: tempDir()
    })
    expect(result.status).toBe(0)
    expect(result.log[0]).toBe('checkup')
  })

  test('a topic kind with no fixture fails loudly', () => {
    const result = runShim('Template: topic_next_actions.md\n', {
      CITEFOX_TEMPLATE_FIXTURE_DIRS: tempDir()
    })
    expect(result.status).toBe(1)
    expect(result.log[0]).toBe('no topic fixture for topic_next_actions')
  })

  test('Assist: <id> still loads the assist fixture', () => {
    const result = runShim('Assist: page.promises\nTask: list the promises.')
    expect(result.status).toBe(0)
    expect(result.log[0]).toBe('assist-page.promises')
  })
})
