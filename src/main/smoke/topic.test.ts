import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import { textboltJinaBody } from '../pipeline/textbolt-fixture'
import type { CommandRequest, CommandResult, CommandTransport } from '../providers/command'
import type { HttpRequest, HttpResponse, HttpTransport } from '../providers/http'
import type { BinaryProbe } from '../providers/claude/binary'
import { kindOfPrompt, topicFixtureReply } from '../topics/fixture-replies'
import { parseSmokeArgs, runSmokeLive, SmokeError, watchSerp } from './live'
import type { SmokeIo } from './live'
import { DEFAULT_TOPIC_SEED, namesBrand, pickAcrossStages, TOPIC_SEARCH_BUDGET } from './topic-args'
import { whyRow } from './topic'

/**
 * The stand-in Claude Code: only the probe knows it, nothing is on disk. A fixed macOS path
 * (the runs pass platform 'darwin'), so it stays valid when the temp folder is a Windows one.
 */
const FAKE_CLAUDE = '/Users/me/Application Support/claude'

const PRIMARY = 'topic-smoke-fake-serpapi-primary'
const SECOND = 'topic-smoke-fake-serpapi-second'
const ANTHROPIC = 'sk-ant-topic-smoke-fake-value'
const FAKE_VALUES = [PRIMARY, SECOND, ANTHROPIC]
const ENV_TEXT = [
  `SERPAPI_API_KEY=${PRIMARY}`,
  `SERPAPI_API_KEY_2=${SECOND}`,
  `ANTHROPIC_API_KEY=${ANTHROPIC}`,
  ''
].join('\n')
const PRODUCT_COMPETITORS = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../assist/fixtures/project.productCompetitors.json', import.meta.url)),
    'utf8'
  )
) as unknown
const SERP_FIXTURES = fileURLToPath(new URL('../providers/fixtures/textbolt/', import.meta.url))
const ACCOUNT_FIXTURE = fileURLToPath(
  new URL('../providers/fixtures/serpapi/account-ok.json', import.meta.url)
)

/** Their page for `--competitor`: the headings the fixture questions and claims cite. */
const COMPETITOR_JINA_BODY = JSON.stringify({
  code: 200,
  data: {
    title: 'Business SMS alerts: send urgent texts to staff and customers | SimpleTexting',
    description: 'Send urgent alerts to staff and customers by text.',
    content:
      '# Send SMS alerts your team actually reads\n## What are SMS alerts?\n## Types of business alerts you can send\n## Send alerts from email and other tools\n## Delivery reports\n## Integrations\nSend urgent alerts to staff and customers by text with SimpleTexting.'
  }
})

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('parseSmokeArgs topic mode', () => {
  test('--topic alone uses the default seed and checks 3 questions', () => {
    const args = parseSmokeArgs(['--env', 'a.env', '--topic'], '/work')
    expect(args.topic).toBe(DEFAULT_TOPIC_SEED)
    expect(args.promptCount).toBe(3)
    expect(args.market).toEqual({ country: 'US', language: 'en', device: 'desktop' })
  })

  test('--topic before another flag still takes the default seed', () => {
    const args = parseSmokeArgs(['--env', 'a.env', '--topic', '--prompts', '2'], '/work')
    expect(args.topic).toBe(DEFAULT_TOPIC_SEED)
    expect(args.promptCount).toBe(2)
  })

  test('keeps a quoted seed and caps --prompts at 5', () => {
    const args = parseSmokeArgs(
      ['--env', 'a.env', '--topic', '  SMS  alerts for clinics ', '--prompts', '5'],
      '/work'
    )
    expect(args.topic).toBe('SMS alerts for clinics')
    expect(args.promptCount).toBe(5)
    expect(() =>
      parseSmokeArgs(['--env', 'a.env', '--topic', 'x', '--prompts', '6'], '/work')
    ).toThrow(/1 to 5/)
  })

  test('rejects --url in topic mode and leaves the page smoke unchanged', () => {
    expect(() =>
      parseSmokeArgs(['--env', 'a.env', '--topic', 'x', '--url', 'https://textbolt.com/'], '/work')
    ).toThrow(/--url/)
    const page = parseSmokeArgs(['--env', 'a.env'], '/work')
    expect(page.topic).toBeNull()
    expect(page.promptCount).toBe(1)
    expect(parseSmokeArgs(['--env', 'a.env', '--prompts', '6'], '/work').promptCount).toBe(6)
  })
})

describe('topic smoke helpers', () => {
  test('namesBrand ignores case, spaces and punctuation', () => {
    expect(namesBrand('Does text bolt work with Gmail?', ['TextBolt'])).toBe(true)
    expect(namesBrand('Is Text-Bolt cheaper?', ['TextBolt', 'Text Bolt'])).toBe(true)
    expect(namesBrand('How do I text my crew from Outlook?', ['TextBolt'])).toBe(false)
  })

  test('pickAcrossStages takes one per stage before a second from any stage', () => {
    const items = [
      { id: 'a', stage: 'problem' },
      { id: 'b', stage: 'problem' },
      { id: 'c', stage: 'options' },
      { id: 'd', stage: 'decide' }
    ]
    expect(
      pickAcrossStages(items, ['problem', 'options', 'decide'], 3).map((item) => item.id)
    ).toEqual(['a', 'c', 'd'])
    expect(pickAcrossStages(items, ['problem', 'options'], 4).map((item) => item.id)).toEqual([
      'a',
      'c',
      'd',
      'b'
    ])
  })

  test('watchSerp refuses a search past the budget and counts Jina apart', async () => {
    const sent: string[] = []
    const watch = watchSerp(
      {
        request: (request) => {
          sent.push(request.url)
          return Promise.resolve({ status: 200, body: '{}' })
        }
      },
      2
    )
    const get = (url: string): Promise<HttpResponse> =>
      watch.transport.request({ method: 'GET', url, timeoutMs: 1000 })
    await get('https://serpapi.com/account.json?api_key=k')
    await get('https://r.jina.ai/https://textbolt.com/')
    await get('https://serpapi.com/search.json?engine=google&api_key=k')
    await get('https://serpapi.com/search.json?engine=google_ai_overview&api_key=k')
    await expect(get('https://serpapi.com/search.json?engine=google&api_key=k')).rejects.toThrow(
      /budget of 2/
    )
    expect(watch.searches()).toBe(2)
    expect(watch.jinaReads()).toBe(1)
    expect(sent).toHaveLength(4)
  })

  test('whyRow prefers an uncited row with an overview and skips rows without one', () => {
    const row = (number: number, state: string, cited: string | null): never =>
      ({ number, state, citedOwnUrl: cited, promptId: `p${number}` }) as never
    expect(
      whyRow([
        row(1, 'no_aio', null),
        row(2, 'page_cited', 'https://x/'),
        row(3, 'not_cited', null)
      ])?.number
    ).toBe(3)
    expect(whyRow([row(1, 'no_aio', null), row(2, 'failed', null)])).toBeNull()
  })
})

describe('runSmokeLive --topic offline', () => {
  test('runs the topic handlers end to end with fakes and stays under the budget', async () => {
    const fetchImpl = globalThis.fetch
    globalThis.fetch = () => {
      throw new Error('live network is disabled')
    }
    const captured = capture()
    const root = makeRoot()
    const commands: CommandRequest[] = []
    const serp: string[] = []
    try {
      const report = await runSmokeLive({
        argv: ['--env', 'parent folder/owner.env', '--topic', '--prompts', '2'],
        cwd: root,
        envFlag: '1',
        parentEnv: { HOME: join(root, 'home'), PATH: process.env.PATH },
        io: captured.io,
        dataDir: join(root, 'app data'),
        home: join(root, 'home'),
        platform: 'darwin',
        http: stubHttp(serp, ACCOUNT_BODY()),
        command: stubClaude(commands),
        probe: probeFor(FAKE_CLAUDE)
      })
      const stdout = captured.stdout.join('\n')
      expect(captured.stderr).toEqual([])
      expect(report.ok).toBe(true)
      const topic = report.topic
      if (topic === null) throw new Error('no topic summary')
      expect(topic.seed).toBe(DEFAULT_TOPIC_SEED)
      expect(topic.searchesLeftBefore).toBe(424)
      expect(topic.questions).toBeGreaterThan(0)
      expect(topic.sampleQuestions).toHaveLength(3)
      expect(topic.sampleQuestions.some((text) => namesBrand(text, ['TextBolt']))).toBe(false)
      expect(topic.keywords).toBeLessThanOrEqual(10)
      expect(topic.checkedQuestions).toHaveLength(2)
      expect(topic.jobStatus).toBe('finished')
      expect(Object.values(topic.rowStates).reduce((a, b) => a + b, 0)).toBe(2)
      expect(topic.goal?.checked).toBe(2)
      expect(topic.winOdds).toHaveLength(2)
      expect(topic.summaryLine).not.toBeNull()
      expect(topic.whyNotCited).not.toBeNull()
      expect(topic.llmCalls).toBe(commands.length)
      // Two prompts: a search plus a page_token follow-up each.
      const searches = serp.filter((url) => !url.includes('/account.json'))
      expect(searches).toHaveLength(4)
      expect(topic.searches).toBe(4)
      expect(topic.searches).toBeLessThanOrEqual(TOPIC_SEARCH_BUDGET)
      expect(serp.filter((url) => url.includes('/account.json'))).toHaveLength(2)
      // Every Claude call was a topic template through the CLI login, plus the topic's
      // competitor question (batch 2 row 5), the only call with web search on.
      expect(commands.every((request) => request.args[0] === '-p')).toBe(true)
      const isSearch = (request: CommandRequest): boolean =>
        (request.stdin ?? '').startsWith('Assist: project.productCompetitors')
      expect(commands.filter(isSearch)).toHaveLength(1)
      for (const request of commands) {
        const tools = request.args[request.args.indexOf('--tools') + 1]
        expect(tools).toBe(isSearch(request) ? 'WebSearch,WebFetch' : '')
      }
      expect(
        commands
          .filter((request) => !isSearch(request))
          .every((request) => kindOfPrompt(request.stdin ?? '')?.startsWith('topic_'))
      ).toBe(true)
      for (const request of commands) {
        expect(request.env?.ANTHROPIC_API_KEY).toBeUndefined()
        expect(request.env?.SERPAPI_API_KEY).toBeUndefined()
      }
      for (const stage of [
        'quota ok',
        'discover ok',
        'profile ok',
        'questions ok',
        'keywords ok',
        'pages ok',
        'estimate ok',
        'check ok',
        'results ok',
        'topic-summary ok',
        'why-not-cited ok'
      ]) {
        expect(stdout).toContain(stage)
      }
      expect(stdout).toContain('sample 1: ')
      expect(stdout).toContain('match states ')
      expect(stdout).toContain('goal ')
      expect(stdout).toContain('win odds Q')
      expect(stdout).toContain(`llm_calls ${commands.length}`)
      expect(stdout).toContain('searches 4 of 10')
      // The P4 and P5 hooks run at the end and print nothing until they are filled.
      expect(stdout).not.toContain('skipped')
      expect(secretFree(stdout)).toBe(true)
      expect(secretFree(readFileSync(report.reportPath ?? '', 'utf8'))).toBe(true)
    } finally {
      globalThis.fetch = fetchImpl
    }
  })

  test('--competitor reads their page and writes its questions and claims (P4)', async () => {
    const captured = capture()
    const root = makeRoot()
    const commands: CommandRequest[] = []
    const serp: string[] = []
    const report = await runSmokeLive({
      argv: [
        '--env',
        'parent folder/owner.env',
        '--topic',
        '--prompts',
        '1',
        '--competitor',
        'https://www.simpletexting.com/'
      ],
      cwd: root,
      envFlag: '1',
      parentEnv: { HOME: join(root, 'home'), PATH: process.env.PATH },
      io: captured.io,
      dataDir: join(root, 'app data'),
      home: join(root, 'home'),
      platform: 'darwin',
      http: stubHttp(serp, ACCOUNT_BODY()),
      command: stubClaude(commands),
      probe: probeFor(FAKE_CLAUDE)
    })
    expect(report.ok).toBe(true)
    const lines = captured.stdout
    expect(lines.filter((line) => line.includes('skipped'))).toEqual([])
    const why = lines.findIndex((line) => line.startsWith('why-not-cited '))
    const groups = lines.findIndex((line) => line.startsWith('keyword-groups ok'))
    const competitor = lines.findIndex((line) => line.startsWith('competitor ok'))
    expect(groups).toBeGreaterThan(why)
    expect(competitor).toBeGreaterThan(groups)
    expect(lines[competitor]).toContain('name="SimpleTexting"')
    expect(lines[competitor]).toContain('set-aside=0')
    expect(lines.some((line) => line.startsWith('competitor question 1 [problem]: '))).toBe(true)
    expect(lines.some((line) => line.startsWith('competitor claim 1 (no): '))).toBe(true)
    // Questions and claims are two calls, run at the end, after the topic summary.
    const kinds = commands.map((request) => kindOfPrompt(request.stdin ?? ''))
    expect(kinds).toContain('competitor_page_questions_v2')
    expect(kinds).toContain('competitor_page_claims')
    expect(kinds).not.toContain('competitor_page_questions')
    expect(report.topic?.llmCalls).toBe(commands.length)
  })

  test('stops before Claude and any search when fewer than 20 searches are left', async () => {
    const captured = capture()
    const root = makeRoot()
    const commands: CommandRequest[] = []
    const serp: string[] = []
    const low = JSON.stringify({
      ...JSON.parse(ACCOUNT_BODY()),
      this_month_usage: 245,
      plan_searches_left: 5,
      total_searches_left: 5
    })
    await expect(
      runSmokeLive({
        argv: ['--env', 'parent folder/owner.env', '--topic', 'SMS alerts'],
        cwd: root,
        envFlag: '1',
        parentEnv: { HOME: join(root, 'home'), PATH: process.env.PATH },
        io: captured.io,
        dataDir: join(root, 'app data'),
        home: join(root, 'home'),
        platform: 'darwin',
        http: stubHttp(serp, low),
        command: stubClaude(commands),
        probe: probeFor(FAKE_CLAUDE)
      })
    ).rejects.toBeInstanceOf(SmokeError)
    const stderr = captured.stderr.join('\n')
    expect(stderr).toContain('failed at quota')
    expect(stderr).toContain('10 searches left')
    expect(captured.stdout.join('\n')).toContain('quota fail')
    expect(commands).toHaveLength(0)
    expect(serp.every((url) => url.includes('/account.json'))).toBe(true)
    expect(secretFree(stderr + captured.stdout.join('\n'))).toBe(true)
  })

  test('fails at results when every checked question came back failed', async () => {
    const captured = capture()
    const root = makeRoot()
    const commands: CommandRequest[] = []
    const serp: string[] = []
    // What SerpApi returned live when the page_token follow-up found no overview.
    const empty = JSON.stringify({
      search_metadata: { status: 'Success' },
      error: "Google hasn't returned any results for this query."
    })
    await expect(
      runSmokeLive({
        argv: ['--env', 'parent folder/owner.env', '--topic', '--prompts', '1'],
        cwd: root,
        envFlag: '1',
        parentEnv: { HOME: join(root, 'home'), PATH: process.env.PATH },
        io: captured.io,
        dataDir: join(root, 'app data'),
        home: join(root, 'home'),
        platform: 'darwin',
        http: stubHttp(serp, ACCOUNT_BODY(), empty),
        command: stubClaude(commands),
        probe: probeFor(FAKE_CLAUDE)
      })
    ).rejects.toBeInstanceOf(SmokeError)
    const stderr = captured.stderr.join('\n')
    expect(captured.stdout.join('\n')).toContain('check ok')
    expect(captured.stdout.join('\n')).toContain('results fail')
    expect(stderr).toContain('failed at results')
    expect(stderr).toContain('Every checked question came back failed')
    expect(stderr).toContain('searches 2 of 10')
  })
})

function ACCOUNT_BODY(): string {
  const envelope = JSON.parse(readFileSync(ACCOUNT_FIXTURE, 'utf8')) as { body: unknown }
  return JSON.stringify(envelope.body)
}

function stubHttp(
  serp: string[],
  accountBody: string,
  aioBody: string = serpBody('serp-01-aio.json')
): HttpTransport {
  return {
    async request(request: HttpRequest): Promise<HttpResponse> {
      if (request.url.startsWith('https://r.jina.ai/https://textbolt.com')) {
        return { status: 200, body: textboltJinaBody() }
      }
      if (request.url.startsWith('https://r.jina.ai/https://www.simpletexting.com/')) {
        return { status: 200, body: COMPETITOR_JINA_BODY }
      }
      const url = new URL(request.url)
      if (url.hostname === 'serpapi.com') {
        serp.push(request.url)
        if (url.pathname === '/account.json') return { status: 200, body: accountBody }
        if (url.searchParams.get('engine') === 'google_ai_overview') {
          return { status: 200, body: aioBody }
        }
        if (url.searchParams.get('engine') === 'google') {
          return { status: 200, body: serpBody('serp-01-token.json') }
        }
      }
      throw new Error(`unexpected http ${url.hostname}${url.pathname}`)
    }
  }
}

function serpBody(name: string): string {
  const envelope = JSON.parse(readFileSync(join(SERP_FIXTURES, name), 'utf8')) as { body: unknown }
  return JSON.stringify(envelope.body)
}

function stubClaude(commands: CommandRequest[]): CommandTransport {
  return {
    async run(request) {
      commands.push(request)
      const reply = (request.stdin ?? '').startsWith('Assist: project.productCompetitors')
        ? PRODUCT_COMPETITORS
        : topicFixtureReply(request.stdin ?? '')
      if (reply === null) throw new Error('unexpected claude prompt')
      return claudeResult(reply)
    }
  }
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

function probeFor(binary: string): BinaryProbe {
  return { exists: (filePath) => filePath === binary, searchPath: () => binary }
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
  const root = mkdtempSync(join(tmpdir(), 'citefox topic smoke-'))
  roots.push(root)
  const dir = join(root, 'parent folder')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'owner.env'), ENV_TEXT, 'utf8')
  return root
}

function secretFree(text: string): boolean {
  return FAKE_VALUES.every((value) => !text.includes(value))
}
