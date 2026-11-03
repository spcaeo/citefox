import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import {
  TEXTBOLT_PROMPTS_EN,
  textboltGapReply,
  textboltJinaBody
} from '../pipeline/textbolt-fixture'
import type { PromptDraft } from '../pipeline/validate'
import { createSpawnCommandTransport } from '../providers/command'
import type { CommandRequest, CommandResult, CommandTransport } from '../providers/command'
import type { HttpRequest, HttpResponse, HttpTransport } from '../providers/http'
import type { BinaryProbe } from '../providers/claude/binary'
import { openAppDatabase } from '../storage/app-database'
import { closeDatabase } from '../storage/database'
import { listApiKeys } from '../storage/records'
import { formatKeyStatus, parseEnvText } from './env-file'
import { runSmokeCli } from './cli'
import { assistPackage } from './assist'
import { DEFAULT_SMOKE_URL, SmokeError, parseSmokeArgs, runSmokeLive } from './live'
import type { SmokeIo, SmokeReport } from './live'

/**
 * The stand-in Claude Code: only the probe knows it, nothing is on disk. A fixed macOS path
 * (the runs pass platform 'darwin'), so it stays valid when the temp folder is a Windows one.
 */
const FAKE_CLAUDE = '/Users/me/Application Support/claude'

const PRIMARY = 'smoke-fake-serpapi-primary'
const SECOND = 'smoke-fake-serpapi-second'
const THIRD = 'smoke-fake-serpapi-third'
const ANTHROPIC = 'sk-ant-smoke-fake-anthropic-value'
const JINA = 'smoke-fake-jina-value'
const YOUTUBE = 'smoke-fake-youtube-value'
const SLACK = 'https://hooks.slack.com/services/TFAKE/BFAKE/smoke-fake-slack'
const SMTP_HOST = 'smtp.smoke-fake.example'
const SMTP_PASSWORD = 'smoke-fake-smtp-password'
const PAGE_TOKEN = 'textbolt-p1-token'
const FIXTURES = fileURLToPath(new URL('../providers/fixtures/textbolt/', import.meta.url))
const WATCHED = [
  'SERPAPI_API_KEY',
  'SERPAPI_API_KEY_2',
  'SERPAPI_API_KEY_3',
  'JINA_API_KEY',
  'ANTHROPIC_API_KEY',
  'YOUTUBE_API_KEY',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_PASSWORD',
  'SLACK_WEBHOOK_URL',
  'CITEFOX_SMOKE_LIVE'
] as const

const FAKE_VALUES = [
  PRIMARY,
  SECOND,
  THIRD,
  ANTHROPIC,
  JINA,
  YOUTUBE,
  SLACK,
  SMTP_HOST,
  SMTP_PASSWORD
]

const ENV_TEXT = [
  `SERPAPI_API_KEY=${PRIMARY}`,
  `SERPAPI_API_KEY_2=${SECOND}`,
  `SERPAPI_API_KEY_3=${THIRD}`,
  'JINA_API_KEY=',
  `ANTHROPIC_API_KEY=${ANTHROPIC}`,
  `YOUTUBE_API_KEY=${YOUTUBE}`,
  `SMTP_HOST=${SMTP_HOST}`,
  'SMTP_PORT=',
  `SMTP_PASSWORD=${SMTP_PASSWORD}`,
  `SLACK_WEBHOOK_URL=${SLACK}`,
  ''
].join('\n')

const STATUS_LINES = [
  'SERPAPI_API_KEY: set',
  'SERPAPI_API_KEY_2: set',
  'SERPAPI_API_KEY_3: set',
  'JINA_API_KEY: missing',
  'ANTHROPIC_API_KEY: set',
  'YOUTUBE_API_KEY: set',
  'SLACK_WEBHOOK_URL: set',
  'SMTP_HOST: set',
  'SMTP_PASSWORD: set',
  'SMTP_PORT: missing',
  'SMTP_*: 2 set, 1 missing'
]

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('formatKeyStatus', () => {
  test('prints set or missing and never a value', () => {
    const lines = formatKeyStatus(parseEnvText(ENV_TEXT))
    expect(lines).toEqual(STATUS_LINES)
    const joined = lines.join('\n')
    expect(secretFree(joined)).toBe(true)
    expect(joined).not.toContain(String(PRIMARY.length))
    expect(joined).not.toContain(PRIMARY.slice(0, 8))
  })

  test('summarises an empty SMTP group', () => {
    expect(formatKeyStatus({})).toContain('SMTP_*: none')
  })

  test('does not read or write the process environment', () => {
    const before = snapshotEnv()
    const parsed = parseEnvText('SERPAPI_API_KEY=$SERPAPI_API_KEY\nANTHROPIC_API_KEY="quoted"\n')
    expect(parsed.SERPAPI_API_KEY).toBe('$SERPAPI_API_KEY')
    expect(parsed.ANTHROPIC_API_KEY).toBe('quoted')
    expect(process.env.SERPAPI_API_KEY).toBe(before.SERPAPI_API_KEY)
  })
})

describe('parseSmokeArgs', () => {
  test('defaults the page, market, and prompt count, and keeps spaces in --env', () => {
    const args = parseSmokeArgs(['--env', 'parent folder/owner.env'], '/work/My Project')
    expect(args.url).toBe(DEFAULT_SMOKE_URL)
    expect(args.market).toEqual({ country: 'US', language: 'en', device: 'desktop' })
    expect(args.promptCount).toBe(1)
    expect(args.envPath).toBe(resolve('/work/My Project', 'parent folder/owner.env'))
  })

  test('accepts --query as an alias and rejects a mismatch', () => {
    expect(parseSmokeArgs(['--env', 'a.env', '--query', '2'], '/work').promptCount).toBe(2)
    expect(() =>
      parseSmokeArgs(['--env', 'a.env', '--prompts', '1', '--query', '2'], '/work')
    ).toThrow(/same number/)
  })

  test('rejects a bad market, a bad count, and an unknown flag', () => {
    expect(() => parseSmokeArgs(['--env', 'a.env', '--market', 'NOPE'], '/work')).toThrow(/market/)
    expect(() => parseSmokeArgs(['--env', 'a.env', '--prompts', '0'], '/work')).toThrow(/1 to/)
    expect(() => parseSmokeArgs(['--env', 'a.env', '--prompts', '1001'], '/work')).toThrow(/1 to/)
    expect(() => parseSmokeArgs(['--env', 'a.env', '--nope', '1'], '/work')).toThrow(/Unknown flag/)
  })

  test('reads the prompt-audit hook flags; switches take no value', () => {
    const plain = parseSmokeArgs(['--env', 'a.env'], '/work')
    expect([plain.gaps, plain.assist, plain.sentiment, plain.reports, plain.competitor]).toEqual([
      false,
      null,
      false,
      false,
      null
    ])
    const page = parseSmokeArgs(
      ['--env', 'a.env', '--gaps', '--reports', '--assist', 'audience.triggers', '--sentiment'],
      '/work'
    )
    expect(page).toMatchObject({
      gaps: true,
      reports: true,
      sentiment: true,
      assist: 'audience.triggers',
      competitor: null,
      promptCount: 1
    })
    const topic = parseSmokeArgs(
      ['--env', 'a.env', '--topic', '--competitor', 'https://www.simpletexting.com/'],
      '/work'
    )
    expect(topic.topic).not.toBeNull()
    expect(topic.competitor).toBe('https://www.simpletexting.com/')
    expect(plain.classify).toBe(false)
    expect(
      parseSmokeArgs(['--env', 'a.env', '--classify', '--prompts', '2'], '/work')
    ).toMatchObject({ classify: true, promptCount: 2 })
  })

  test('rejects hook flags in the wrong mode or with a bad value', () => {
    expect(() => parseSmokeArgs(['--env', 'a.env', '--topic', '--gaps'], '/work')).toThrow(
      /--gaps runs after the page smoke/
    )
    expect(() =>
      parseSmokeArgs(['--env', 'a.env', '--fill', 'textbolt.com', '--assist', 'ask'], '/work')
    ).toThrow(/--assist runs after the page smoke/)
    expect(() =>
      parseSmokeArgs(['--env', 'a.env', '--competitor', 'https://www.simpletexting.com/'], '/work')
    ).toThrow(/--competitor runs with --topic/)
    expect(() =>
      parseSmokeArgs(['--env', 'a.env', '--topic', '--competitor', 'ftp://x.example/'], '/work')
    ).toThrow(/http/)
    expect(() => parseSmokeArgs(['--env', 'a.env', '--assist', 'bad id!'], '/work')).toThrow(
      /assist id/
    )
    expect(() => parseSmokeArgs(['--env', 'a.env', '--assist'], '/work')).toThrow(/Missing value/)
  })
})

describe('assistPackage', () => {
  test('routes each assist id to the package that fills its smoke', () => {
    expect(assistPackage('ask')).toBe('P8')
    expect(assistPackage('structure.import')).toBe('P8')
    expect(assistPackage('results.whyNotFirst')).toBe('P5')
    expect(assistPackage('audience.triggers')).toBe('P7')
  })
})

describe('runSmokeLive guards', () => {
  test('help is allowed without the opt-in flag', async () => {
    const captured = capture()
    const code = await runSmokeCli(['--help'], { env: {}, io: captured.io, cwd: tmpdir() })
    expect(code).toBe(0)
    expect(captured.stdout.join('\n')).toContain('--env')
    expect(captured.stderr).toEqual([])
  })

  test.each([undefined, 'true', '1 '])(
    'refuses env flag %j before it looks for a file',
    async (envFlag) => {
      const captured = capture()
      const root = makeRoot()
      await expect(
        runSmokeLive({
          argv: ['--env', 'parent folder/missing.env'],
          cwd: root,
          envFlag,
          parentEnv: {},
          io: captured.io
        })
      ).rejects.toBeInstanceOf(SmokeError)
      const stderr = captured.stderr.join('\n')
      expect(stderr).toContain('CITEFOX_SMOKE_LIVE')
      expect(stderr).not.toContain('not found')
    }
  )

  test('names a missing --env flag', async () => {
    const captured = capture()
    await expect(live(captured.io, [], makeRoot())).rejects.toThrow(/Missing --env/)
    expect(captured.stderr.join('\n')).toContain('Missing --env')
  })

  test('names a missing env file whose path contains a space', async () => {
    const captured = capture()
    const root = makeRoot()
    await expect(live(captured.io, ['--env', 'parent folder/owner.env'], root)).rejects.toThrow(
      /not found/
    )
    const stderr = captured.stderr.join('\n')
    expect(stderr).toContain('parent folder')
    expect(stderr).toContain('not found')
    expect(secretFree(stderr)).toBe(true)
  })

  test('stops when SERPAPI_API_KEY is missing and does not print the other value', async () => {
    const captured = capture()
    const root = makeRoot()
    const envPath = join(root, 'parent folder', 'owner.env')
    mkdirSync(join(root, 'parent folder'), { recursive: true })
    writeFileSync(envPath, `ANTHROPIC_API_KEY=${ANTHROPIC}\n`, 'utf8')
    const dataDir = join(root, 'app data')
    let probed = false
    await expect(
      runSmokeLive({
        argv: ['--env', 'parent folder/owner.env'],
        cwd: root,
        envFlag: '1',
        parentEnv: {},
        io: captured.io,
        dataDir,
        probe: {
          exists: () => {
            probed = true
            return false
          },
          searchPath: () => {
            probed = true
            return null
          }
        }
      })
    ).rejects.toThrow(/SERPAPI_API_KEY is missing/)
    expect(captured.stdout).toContain('SERPAPI_API_KEY: missing')
    expect(captured.stdout.join('\n')).not.toContain(ANTHROPIC)
    expect(captured.stderr.join('\n')).not.toContain(ANTHROPIC)
    expect(probed).toBe(false)
    expect(existsSync(dataDir)).toBe(false)
  })

  test('stops when claude is not on PATH and does not create a data dir', async () => {
    const captured = capture()
    const root = makeRoot()
    writeEnv(root)
    const dataDir = join(root, 'app data')
    let fetched = false
    await expect(
      runSmokeLive({
        argv: ['--env', 'parent folder/owner.env'],
        cwd: root,
        envFlag: '1',
        parentEnv: { PATH: '' },
        io: captured.io,
        dataDir,
        http: {
          request: () => {
            fetched = true
            return Promise.reject(new Error('http'))
          }
        },
        probe: { exists: () => false, searchPath: () => null }
      })
    ).rejects.toThrow(/PATH/)
    expect(captured.stderr.join('\n')).toContain('PATH')
    expect(fetched).toBe(false)
    expect(existsSync(dataDir)).toBe(false)
    expect(secretFree(captured.stdout.join('\n') + captured.stderr.join('\n'))).toBe(true)
  })
})

describe('runSmokeLive offline', () => {
  test('checks one prompt from an --env path that contains a space', async () => {
    const before = snapshotEnv()
    const fetchImpl = globalThis.fetch
    globalThis.fetch = () => {
      throw new Error('live network is disabled')
    }
    const captured = capture()
    const root = makeRoot()
    writeEnv(root)
    const dataDir = join(root, 'app data')
    const binary = FAKE_CLAUDE
    const home = join(root, 'home folder')
    const commands: CommandRequest[] = []
    const serp: string[] = []
    const http = stubHttp(serp)
    try {
      const report = await runSmokeLive({
        argv: ['--env', 'parent folder/owner.env'],
        cwd: root,
        envFlag: '1',
        parentEnv: parentWithSecrets(home),
        io: captured.io,
        dataDir,
        home,
        platform: 'darwin',
        http,
        command: stubClaude(commands),
        probe: probeFor(binary)
      })
      expect(report.ok).toBe(true)
      expect(report.classification).toBe('page_cited')
      expect(report.score).toBe(100)
      expect(report.searches).toBe(2)
      expect(report.followUpSameKey).toBe(true)
      expect(report.generatedPrompts).toBe(3)
      expect(report.searchedPrompts).toBe(1)
      expect(report.serpKeys).toBe(3)
      const stored = openAppDatabase(join(dataDir, 'app.sqlite'))
      try {
        const serpRows = listApiKeys(stored).filter((key) => key.provider === 'serpapi')
        expect(serpRows.map((key) => [key.rotationOrder, key.id, key.keychainRef])).toEqual([
          [0, 'serp-1', 'citefox.serpapi.serp-1'],
          [1, 'serp-2', 'citefox.serpapi.serp-2'],
          [2, 'serp-3', 'citefox.serpapi.serp-3']
        ])
        const dumped = JSON.stringify(stored.prepare('SELECT * FROM api_keys').all())
        expect(dumped).not.toContain(PRIMARY)
        expect(dumped).not.toContain(SECOND)
        expect(dumped).not.toContain(THIRD)
      } finally {
        closeDatabase(stored)
      }
      const stdout = captured.stdout.join('\n')
      expect(captured.stdout.slice(0, STATUS_LINES.length)).toEqual(STATUS_LINES)
      expect(stdout).toContain('page-read ok')
      expect(stdout).toContain('jina keyless')
      expect(stdout).toContain('prompts ok')
      expect(stdout).toContain('generated=3 searched=1')
      expect(stdout).toContain('search ok')
      expect(stdout).toContain('follow-up=same-key')
      expect(stdout).toContain('classify ok')
      expect(stdout).toContain('page_cited')
      expect(stdout).toContain('score ok')
      expect(stdout).toContain('classification page_cited')
      expect(stdout).toContain('score 100')
      expect(stdout).toContain('searches 2')
      expect(stdout).toContain(`data ${dataDir}`)
      expect(stdout).not.toContain('skipped')
      expect(stdout).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
      expect(stdout).not.toContain('UTC')
      expect(stdout).not.toContain(PAGE_TOKEN)
      expect(secretFree(stdout)).toBe(true)
      expect(secretFree(captured.stderr.join('\n'))).toBe(true)
      expect(existsSync(join(dataDir, 'app.sqlite'))).toBe(true)
      const reportText = readFileSync(report.reportPath ?? '', 'utf8')
      expect(secretFree(reportText)).toBe(true)
      expect(reportText).not.toContain(PAGE_TOKEN)
      expect(reportText).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
      const printedReport = captured.stdout.find((line) => line.startsWith('report '))
      const expectedReportPath = join(dataDir, 'smoke-report.json')
      expect(expectedReportPath).toContain(' ')
      expect(printedReport).toBe(`report ${expectedReportPath}`)
      expect(report.reportPath).toBe(expectedReportPath)
      const saved = JSON.parse(reportText) as { reportPath: string | null }
      expect(saved.reportPath).toBe(expectedReportPath)
      expect(commands.length).toBeGreaterThan(0)
      for (const request of commands) {
        expect(request.command).toBe(binary)
        expect(Array.isArray(request.args)).toBe(true)
        expect(request.args[0]).toBe('-p')
        expect(typeof request.stdin).toBe('string')
        expect(request.stdin).toContain(' ')
        expect(request.env?.SMTP_PORT).toBeUndefined()
        expect(request.env?.HOME).toBe(home)
        const envText = JSON.stringify(request.env ?? {})
        for (const name of Object.keys(parseEnvText(ENV_TEXT))) {
          expect(request.env?.[name]).toBeUndefined()
        }
        expect(secretFree(envText)).toBe(true)
      }
      expect(serp).toHaveLength(2)
      const first = new URL(serp[0] ?? '')
      const follow = new URL(serp[1] ?? '')
      expect(first.searchParams.get('engine')).toBe('google')
      expect(first.searchParams.get('q')).toBe(TEXTBOLT_PROMPTS_EN.prompts[0]?.text)
      expect(first.searchParams.get('gl')).toBe('us')
      expect(first.searchParams.get('hl')).toBe('en')
      expect(first.searchParams.get('device')).toBe('desktop')
      expect(first.searchParams.get('no_cache')).toBe('true')
      expect(first.searchParams.get('api_key')).toBe(PRIMARY)
      expect(follow.searchParams.get('engine')).toBe('google_ai_overview')
      expect(follow.searchParams.get('page_token')).toBe(PAGE_TOKEN)
      expect(follow.searchParams.get('api_key')).toBe(PRIMARY)
      expect(follow.searchParams.get('api_key')).not.toBe(SECOND)
      expect(follow.searchParams.get('api_key')).not.toBe(THIRD)
      expect(snapshotEnv()).toEqual(before)
    } finally {
      globalThis.fetch = fetchImpl
    }
  })

  test('runs the requested hooks after the score', async () => {
    const captured = capture()
    const root = makeRoot()
    writeEnv(root)
    const serp: string[] = []
    const report = await runSmokeLive({
      argv: ['--env', 'parent folder/owner.env', '--gaps'],
      cwd: root,
      envFlag: '1',
      parentEnv: parentWithSecrets(join(root, 'home folder')),
      io: captured.io,
      dataDir: join(root, 'app data'),
      home: join(root, 'home folder'),
      platform: 'darwin',
      http: stubHttp(serp),
      command: stubClaude([]),
      probe: probeFor(FAKE_CLAUDE)
    })
    expect(report.ok).toBe(true)
    expect(serp).toHaveLength(2)
    const lines = captured.stdout
    // Every hook is written now, so none prints skipped.
    expect(lines.filter((line) => line.includes(' skipped: '))).toEqual([])
    const score = lines.findIndex((line) => line.startsWith('score ok'))
    expect(lines.findIndex((line) => line.startsWith('gaps-coverage ok'))).toBeGreaterThan(score)
    // The gaps hook (P1) runs the three content-gap steps; the rerun reuses the audit.
    expect(lines.some((line) => line.startsWith('gaps-coverage ok'))).toBe(true)
    expect(lines.find((line) => line.startsWith('gaps-coverage-again ok'))).toContain(
      'page_audit=0'
    )
    expect(secretFree(lines.join('\n'))).toBe(true)
  })

  test('redacts a provider error that repeats every env value', async () => {
    const captured = capture()
    const root = makeRoot()
    writeEnv(root)
    const dataDir = join(root, 'app data')
    const binary = FAKE_CLAUDE
    const fileSecrets = FAKE_VALUES.filter((value) => value !== JINA)
    const command: CommandTransport = {
      run: () => Promise.reject(new Error(`provider failed ${fileSecrets.join(' ')}`))
    }
    try {
      await runSmokeLive({
        argv: ['--env', 'parent folder/owner.env'],
        cwd: root,
        envFlag: '1',
        parentEnv: parentWithSecrets(join(root, 'home folder')),
        io: captured.io,
        dataDir,
        home: join(root, 'home folder'),
        platform: 'darwin',
        http: stubHttp([]),
        command,
        probe: probeFor(binary)
      })
    } catch (error) {
      expect(error).toBeInstanceOf(SmokeError)
      expect((error as SmokeError).reported).toBe(true)
    }
    const stdout = captured.stdout.join('\n')
    const stderr = captured.stderr.join('\n')
    expect(stdout).toContain('page-read ok')
    expect(stdout).toContain('buyer-profile fail')
    expect(secretFree(stdout)).toBe(true)
    expect(secretFree(stderr)).toBe(true)
    expect(stderr).toContain('[REDACTED]')
    const report = readReport(dataDir)
    expect(report).not.toBeNull()
    expect(secretFree(JSON.stringify(report))).toBe(true)
    expect(secretFree(readFileSync(join(dataDir, 'smoke-report.json'), 'utf8'))).toBe(true)
  })
})

describe('createSpawnCommandTransport', () => {
  test('spawns a script path that contains spaces with an args array', async () => {
    const root = makeRoot()
    const dir = join(root, 'bin folder')
    mkdirSync(dir)
    const script = join(dir, 'show arg.mjs')
    writeFileSync(script, 'process.stdout.write(process.argv[2] ?? "")\n', 'utf8')
    const result = await createSpawnCommandTransport().run({
      command: process.execPath,
      args: [script, 'page token follow up'],
      stdin: null,
      timeoutMs: 10_000
    })
    expect(result.exitCode).toBe(0)
    expect(result.spawnError).toBeNull()
    expect(result.stdout).toBe('page token follow up')
  })
})

describe('package scripts', () => {
  test('keeps smoke:live out of the test scripts', () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8')
    ) as { scripts: Record<string, string> }
    expect(pkg.scripts['smoke:live']).toContain('CITEFOX_SMOKE_LIVE=1')
    expect(pkg.scripts.test).not.toContain('smoke:live')
    expect(pkg.scripts['test:unit']).not.toContain('smoke:live')
    expect(pkg.scripts['test:e2e']).not.toContain('smoke:live')
  })
})

function live(io: SmokeIo, argv: readonly string[], cwd: string): Promise<SmokeReport> {
  return runSmokeLive({
    argv,
    cwd,
    envFlag: '1',
    parentEnv: {},
    io
  })
}

function capture(): { io: SmokeIo; stdout: string[]; stderr: string[] } {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    stdout,
    stderr,
    io: {
      stdout: (line) => {
        stdout.push(line)
      },
      stderr: (line) => {
        stderr.push(line)
      }
    }
  }
}

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'citefox smoke-'))
  roots.push(root)
  return root
}

function writeEnv(root: string): void {
  const dir = join(root, 'parent folder')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'owner.env'), ENV_TEXT, 'utf8')
}

function parentWithSecrets(home: string): NodeJS.ProcessEnv {
  return {
    HOME: home,
    PATH: process.env.PATH,
    SERPAPI_API_KEY: PRIMARY,
    SERPAPI_API_KEY_2: SECOND,
    SERPAPI_API_KEY_3: THIRD,
    JINA_API_KEY: JINA,
    ANTHROPIC_API_KEY: ANTHROPIC,
    YOUTUBE_API_KEY: YOUTUBE,
    SMTP_HOST: SMTP_HOST,
    SMTP_PORT: '2525',
    SMTP_PASSWORD: SMTP_PASSWORD,
    SLACK_WEBHOOK_URL: SLACK
  }
}

function probeFor(binary: string): BinaryProbe {
  return {
    exists: (filePath) => filePath === binary,
    searchPath: () => binary
  }
}

function stubClaude(commands: CommandRequest[]): CommandTransport {
  return {
    async run(request) {
      commands.push(request)
      const prompt = request.stdin ?? ''
      if (prompt.includes('Write six parts')) return claudeResult(profileJson())
      if (prompt.includes('You are writing buyer prompts')) {
        const count = Number(/Write (?:exactly )?(\d+) prompts/.exec(prompt)?.[1] ?? '0')
        return claudeResult({ prompts: promptsFor(count) })
      }
      const gap = textboltGapReply(prompt)
      if (gap !== null) return claudeResult(gap)
      throw new Error('unexpected claude prompt')
    }
  }
}

function stubHttp(serp: string[]): HttpTransport {
  return {
    async request(request: HttpRequest): Promise<HttpResponse> {
      if (request.url.startsWith('https://r.jina.ai/')) {
        const headers = request.headers ?? {}
        for (const [name, value] of Object.entries(headers)) {
          expect(name.toLowerCase()).not.toBe('authorization')
          expect(value).not.toContain(JINA)
        }
        return { status: 200, body: textboltJinaBody() }
      }
      const url = new URL(request.url)
      if (url.hostname === 'serpapi.com') {
        serp.push(request.url)
        if (url.searchParams.get('engine') === 'google_ai_overview') {
          return { status: 200, body: fixtureBody('serp-01-aio.json') }
        }
        if (url.searchParams.get('q') === TEXTBOLT_PROMPTS_EN.prompts[0]?.text) {
          return { status: 200, body: fixtureBody('serp-01-token.json') }
        }
      }
      throw new Error(`unexpected http ${request.url}`)
    }
  }
}

function fixtureBody(name: string): string {
  const envelope = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as { body: unknown }
  return JSON.stringify(envelope.body)
}

function profileJson(): unknown {
  return JSON.parse(messageText('claude-profile.json'))
}

function promptsFor(count: number): PromptDraft[] {
  const parsed = JSON.parse(messageText('claude-prompts.json')) as { prompts: PromptDraft[] }
  const picked: PromptDraft[] = []
  for (const source of ['title_meta_h1', 'trigger_event', 'objection']) {
    const found = parsed.prompts.find((prompt) => prompt.source === source)
    if (found !== undefined) picked.push(found)
  }
  for (const prompt of parsed.prompts) {
    if (picked.length >= count) break
    if (!picked.includes(prompt)) picked.push(prompt)
  }
  return picked.slice(0, count)
}

function messageText(name: string): string {
  const envelope = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as {
    body: { content: { text: string }[] }
  }
  return envelope.body.content[0]?.text ?? ''
}

function claudeResult(json: unknown): CommandResult {
  return {
    exitCode: 0,
    stdout: JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: JSON.stringify(json),
      structured_output: json,
      usage: {
        input_tokens: 12,
        output_tokens: 4,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0
      },
      modelUsage: {
        'claude-sonnet-5-5': {
          inputTokens: 12,
          outputTokens: 4,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          costUSD: 0
        }
      }
    }),
    stderr: '',
    timedOut: false,
    spawnError: null
  }
}

function readReport(dataDir: string): SmokeReport | null {
  const path = join(dataDir, 'smoke-report.json')
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as SmokeReport
}

function snapshotEnv(): Record<string, string | undefined> {
  const shot: Record<string, string | undefined> = {}
  for (const key of WATCHED) shot[key] = process.env[key]
  return shot
}

function secretFree(text: string): boolean {
  return FAKE_VALUES.every((value) => value.length === 0 || !text.includes(value))
}
