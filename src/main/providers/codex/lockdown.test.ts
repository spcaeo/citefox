import { describe, expect, test } from 'vitest'
import { ProviderError } from '../errors'
import { commandResult } from '../claude/claude-test-fakes.test-helper'
import {
  CODE_MODE_HOST_FEATURE,
  OPTIONAL_DISABLED_FEATURES,
  assertNoCodexAccountChange,
  codexExecArgs,
  rejectedCodexArgument,
  rejectedCodexFeature
} from './args'
import { codexBinaryPathProblem, isCodexCredentialPath } from './binary'
import { scrubCodexEnv } from './env'
import { DEFAULT_CODEX_MODEL, DEFAULT_CODEX_QUICK_MODEL, resolveCodexModel } from './model'
import { strictCodexSchema, stripOptionalNulls } from './schema'

const CALL = { model: 'gpt-5.6-luna', effort: 'low', schemaPath: null, webSearch: false }

function flagValues(args: readonly string[], flag: string): string[] {
  return args.flatMap((arg, index) => (arg === flag ? [args[index + 1] ?? ''] : []))
}

describe('codex exec arguments', () => {
  test('lock the run down', () => {
    const args = codexExecArgs(CALL)
    expect(args.slice(0, 2)).toEqual(['exec', '--json'])
    for (const flag of ['--ephemeral', '--ignore-user-config', '--ignore-rules']) {
      expect(args).toContain(flag)
    }
    expect(flagValues(args, '--sandbox')).toEqual(['read-only'])
    const config = flagValues(args, '-c')
    expect(config).toContain('approval_policy="never"')
    expect(config).toContain('web_search="disabled"')
    expect(config).toContain('mcp_servers={}')
    expect(config).toContain('project_doc_max_bytes=0')
    const disabled = flagValues(args, '--disable')
    expect(disabled).toEqual(
      expect.arrayContaining(['shell_tool', 'unified_exec', CODE_MODE_HOST_FEATURE])
    )
    expect(disabled).toEqual(expect.arrayContaining([...OPTIONAL_DISABLED_FEATURES]))
    expect(args[args.length - 1]).toBe('-')
    expect(args).not.toContain('--output-schema')
  })

  test('web search turns search on and keeps the code-mode host it runs through', () => {
    const args = codexExecArgs({ ...CALL, webSearch: true })
    expect(flagValues(args, '-c')).toContain('web_search="live"')
    expect(flagValues(args, '--disable')).not.toContain(CODE_MODE_HOST_FEATURE)
    expect(flagValues(args, '--disable')).toContain('shell_tool')
  })

  test('passes the schema file and leaves out features this Codex does not know', () => {
    const args = codexExecArgs({ ...CALL, schemaPath: '/tmp/x/schema.json' }, new Set(['goals']))
    expect(flagValues(args, '--output-schema')).toEqual(['/tmp/x/schema.json'])
    expect(flagValues(args, '--disable')).not.toContain('goals')
  })

  test('spots a refused feature or flag before any event', () => {
    expect(
      rejectedCodexFeature(
        commandResult({ exitCode: 2, stderr: 'Error: Unknown feature flag: goals' })
      )
    ).toBe('goals')
    expect(
      rejectedCodexArgument(
        commandResult({ exitCode: 2, stderr: "error: unexpected argument '--ignore-rules' found" })
      )
    ).toBe('--ignore-rules')
    const started = commandResult({
      exitCode: 1,
      stdout: '{"type":"thread.started"}',
      stderr: 'Unknown feature flag: goals'
    })
    expect(rejectedCodexFeature(started)).toBeNull()
  })

  test('never changes the Codex sign-in', () => {
    expect(() => assertNoCodexAccountChange(['login', 'status'])).not.toThrow()
    for (const args of [['login'], ['logout'], ['login', '--with-api-key']]) {
      expect(() => assertNoCodexAccountChange(args)).toThrow(ProviderError)
    }
  })
})

describe('codex environment and path', () => {
  test('drops API keys and tokens but keeps CODEX_HOME', () => {
    const env = scrubCodexEnv({
      PATH: '/usr/bin',
      HOME: '/Users/me',
      CODEX_HOME: '/Users/me/.codex',
      OPENAI_API_KEY: 'sk-x',
      CODEX_API_KEY: 'x',
      OPENAI_BASE_URL: 'https://example.invalid',
      MY_OPENAI_TOKEN: 'x',
      ANTHROPIC_API_KEY: 'sk-ant-x'
    })
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/me',
      CODEX_HOME: '/Users/me/.codex',
      NO_COLOR: '1'
    })
  })

  test('accepts only an absolute path to the codex program', () => {
    expect(codexBinaryPathProblem('/usr/local/bin/codex', 'darwin')).toBeNull()
    expect(codexBinaryPathProblem('codex', 'darwin')).toMatch(/full path/)
    expect(codexBinaryPathProblem('/bin/sh', 'darwin')).toMatch(/codex/)
    expect(codexBinaryPathProblem('C:\\tools\\codex.exe', 'win32')).toBeNull()
    expect(isCodexCredentialPath('/Users/me/.codex/auth.json')).toBe(true)
  })
})

describe('codex models', () => {
  test('quick and heavy jobs get their own default and effort', () => {
    expect(resolveCodexModel({ prompt: 'hi' }, {})).toEqual({
      model: DEFAULT_CODEX_QUICK_MODEL,
      size: 'quick'
    })
    expect(resolveCodexModel({ prompt: 'hi', webSearch: true }, {})).toEqual({
      model: DEFAULT_CODEX_MODEL,
      size: 'heavy'
    })
    expect(resolveCodexModel({ prompt: 'x'.repeat(9000) }, {}).size).toBe('heavy')
  })

  test('Settings apply, and a Claude model on the request is ignored', () => {
    expect(resolveCodexModel({ prompt: 'hi' }, { quickModel: 'gpt-mini' }).model).toBe('gpt-mini')
    expect(resolveCodexModel({ prompt: 'hi', webSearch: true }, { model: ' gpt-big ' }).model).toBe(
      'gpt-big'
    )
    expect(
      resolveCodexModel({ prompt: 'hi', model: 'claude-sonnet-5-5' }, { quickModel: null }).model
    ).toBe(DEFAULT_CODEX_QUICK_MODEL)
    expect(resolveCodexModel({ prompt: 'hi', model: 'gpt-5.6-x' }, {}).model).toBe('gpt-5.6-x')
  })
})

describe('strict schemas', () => {
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1 },
      note: { type: 'string' },
      tags: {
        type: 'array',
        items: {
          type: 'object',
          properties: { label: { type: 'string' }, kind: { enum: ['a', 'b'] } },
          required: ['label']
        }
      }
    },
    required: ['name', 'tags']
  }

  test('every object is closed and every field required, optional ones nullable', () => {
    const strict = strictCodexSchema(schema)
    expect(strict).toMatchObject({
      additionalProperties: false,
      required: ['name', 'note', 'tags'],
      properties: {
        name: { type: 'string' },
        note: { type: ['string', 'null'] },
        tags: {
          type: 'array',
          items: {
            additionalProperties: false,
            required: ['label', 'kind'],
            properties: { kind: { enum: ['a', 'b', null] } }
          }
        }
      }
    })
    expect(JSON.stringify(strict)).not.toContain('minLength')
  })

  test('a schema that cannot be strict returns null', () => {
    expect(strictCodexSchema({ type: 'array', items: {} })).toBeNull()
    expect(
      strictCodexSchema({
        type: 'object',
        properties: { map: { type: 'object', additionalProperties: { type: 'string' } } }
      })
    ).toBeNull()
  })

  test('the forced nulls are dropped again, all the way down', () => {
    expect(
      stripOptionalNulls({ name: 'x', note: null, tags: [{ label: 'y', kind: null }] }, schema)
    ).toEqual({ name: 'x', tags: [{ label: 'y' }] })
  })
})
