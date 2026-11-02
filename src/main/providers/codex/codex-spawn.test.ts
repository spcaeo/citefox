import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createSpawnCommandTransport } from '../command'
import { captureLogger, probeFor } from '../claude/claude-test-fakes.test-helper'
import { createCodexProvider, resetCodexFlagSupportForTests } from './codex'

/**
 * A stand-in `codex` program run through the real spawn transport: it records what
 * CiteFox gave it (arguments, stdin, the schema file, its folder and environment)
 * and answers the way codex-cli 0.149 does.
 */
const FAKE_CODEX = `#!${process.execPath}
const fs = require('node:fs')
const args = process.argv.slice(2)
if (args[0] === '--version') { console.log('codex-cli 0.149.0'); process.exit(0) }
if (args[0] === 'login') { console.error('Logged in using ChatGPT'); process.exit(0) }
let stdin = ''
process.stdin.on('data', (chunk) => { stdin += chunk })
process.stdin.on('end', () => {
  const at = args.indexOf('--output-schema')
  const schema = at < 0 ? null : JSON.parse(fs.readFileSync(args[at + 1], 'utf8'))
  fs.writeFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify({
    args, stdin, schema, cwd: process.cwd(), cwdFiles: fs.readdirSync(process.cwd()),
    openAiKey: process.env.OPENAI_API_KEY ?? null
  }))
  const text = schema === null ? 'pong' : JSON.stringify({ ok: true, note: null })
  const events = [
    { type: 'thread.started', thread_id: '00000000-0000-7000-8000-000000000000' },
    { type: 'turn.started' },
    { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text } },
    { type: 'turn.completed', usage: { input_tokens: 42, cached_input_tokens: 0, output_tokens: 7 } }
  ]
  for (const event of events) process.stdout.write(JSON.stringify(event) + '\\n')
})
`

const folders: string[] = []

afterEach(() => {
  resetCodexFlagSupportForTests()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function installFakeCodex(): { binary: string; log: string } {
  const folder = mkdtempSync(join(tmpdir(), 'citefox-fake-codex-'))
  folders.push(folder)
  const binary = join(folder, 'codex')
  writeFileSync(binary, FAKE_CODEX)
  chmodSync(binary, 0o755)
  return { binary, log: join(folder, 'seen.json') }
}

describe.skipIf(process.platform === 'win32')('Codex through a real process', () => {
  test('runs a locked-down exec in an empty folder and reads its reply', async () => {
    const { binary, log } = installFakeCodex()
    const provider = createCodexProvider({
      command: createSpawnCommandTransport(),
      probe: probeFor([binary]),
      logger: captureLogger().logger,
      savedBinaryPath: binary,
      pathEnv: '',
      baseEnv: {
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        FAKE_CODEX_LOG: log,
        OPENAI_API_KEY: 'sk-proj-FAKE'
      }
    })

    expect(await provider.readVersion(binary)).toEqual({ ok: true, version: '0.149.0' })
    expect((await provider.readLogin(binary)).status).toBe('logged_in')

    const schema = {
      type: 'object',
      properties: { ok: { type: 'boolean' }, note: { type: 'string' } },
      required: ['ok']
    }
    const completion = await provider.complete({ prompt: 'Is this a test?', schema })
    expect(completion).toMatchObject({ provider: 'codex', json: { ok: true }, inputTokens: 42 })

    const seen = JSON.parse(readFileSync(log, 'utf8')) as {
      args: string[]
      stdin: string
      schema: { required: string[]; additionalProperties: boolean }
      cwd: string
      cwdFiles: string[]
      openAiKey: string | null
    }
    expect(seen.stdin).toBe('Is this a test?')
    expect(seen.args).toEqual(expect.arrayContaining(['--sandbox', 'read-only', '--ephemeral']))
    expect(seen.schema).toMatchObject({ required: ['ok', 'note'], additionalProperties: false })
    expect(seen.cwdFiles).toEqual([])
    expect(seen.cwd).not.toBe(process.cwd())
    expect(seen.openAiKey).toBeNull()
  })
})
