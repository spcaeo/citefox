import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  commitMessage,
  globToRegExp,
  lastSyncedCommit,
  licenseProblems,
  normaliseConfig,
  parseLsTree,
  planChanges,
  publicSubjects,
  selectFiles
} from './public-sync-core.mjs'
import { maskSecret, scanDiff, scanLine, scanText } from './secret-scan.mjs'

const realConfig = normaliseConfig(JSON.parse(readFileSync('public-sync.config.json', 'utf8')))

describe('globToRegExp', () => {
  test('** crosses folders, * stays in one', () => {
    expect(globToRegExp('src/**').test('src/main/a/b.ts')).toBe(true)
    expect(globToRegExp('src/*.ts').test('src/a.ts')).toBe(true)
    expect(globToRegExp('src/*.ts').test('src/main/a.ts')).toBe(false)
    expect(globToRegExp('**/CLAUDE.md').test('CLAUDE.md')).toBe(true)
    expect(globToRegExp('**/CLAUDE.md').test('a/b/CLAUDE.md')).toBe(true)
    expect(globToRegExp('tsconfig*.json').test('tsconfig.web.json')).toBe(true)
  })

  test('dots and brackets are literal', () => {
    expect(globToRegExp('a.md').test('aXmd')).toBe(false)
    expect(globToRegExp('Docs/A (b).md').test('Docs/A (b).md')).toBe(true)
  })
})

describe('selectFiles with the real config', () => {
  const paths = [
    'src/main/index.ts',
    'src/main/eval/run.ts',
    'tests/e2e/a.spec.ts',
    'Docs/help/summary.md',
    'Docs/ARCHITECTURE.md',
    'Docs/PUBLISHING.md',
    'Docs/PUBLISHING-AUDIT.md',
    'Docs/prompt-eval/grades/brex.com.md',
    'Docs/reference-reports/sample.pdf',
    'Docs/MILESTONES.md',
    'eval/prompts/a.json',
    '.claude/settings.json',
    'src/.claude/x.md',
    'CLAUDE.md',
    'packages/memory/notes.md',
    '.env',
    '.env.local',
    '.env.example',
    'build/AuthKey_ABC.p8',
    'build/cert.pfx',
    'data/app.sqlite',
    'public-sync.config.json',
    'LICENSE',
    'package.json',
    'Mockups/old.html',
    'site/index.html',
    'server/index.ts'
  ]
  const { kept, excluded, notAllowed } = selectFiles(paths, realConfig)

  test('exports the app, tests, user and dev docs, site and server', () => {
    expect(kept).toEqual(
      expect.arrayContaining([
        'src/main/index.ts',
        'src/main/eval/run.ts',
        'tests/e2e/a.spec.ts',
        'Docs/help/summary.md',
        'Docs/ARCHITECTURE.md',
        'Docs/PUBLISHING.md',
        '.env.example',
        'LICENSE',
        'package.json',
        'site/index.html',
        'server/index.ts'
      ])
    )
  })

  test('drops private material', () => {
    const dropped = excluded.map((e) => e.path)
    for (const path of [
      'Docs/PUBLISHING-AUDIT.md',
      'Docs/prompt-eval/grades/brex.com.md',
      'Docs/reference-reports/sample.pdf',
      'Docs/MILESTONES.md',
      '.claude/settings.json',
      'src/.claude/x.md',
      'CLAUDE.md',
      'packages/memory/notes.md',
      '.env',
      '.env.local',
      'build/AuthKey_ABC.p8',
      'build/cert.pfx',
      'data/app.sqlite',
      'public-sync.config.json'
    ]) {
      expect(dropped, path).toContain(path)
      expect(kept, path).not.toContain(path)
    }
    expect(excluded.find((e) => e.path === '.env')?.why).toBe('local secrets')
  })

  test('a folder outside the allow-list is not exported', () => {
    expect(notAllowed).toEqual(['Mockups/old.html'])
    expect(kept).not.toContain('eval/prompts/a.json')
  })
})

describe('selectFiles rules', () => {
  test('the last exclude wins and ! puts a path back', () => {
    const config = normaliseConfig({
      include: ['**'],
      exclude: ['docs/**', '!docs/public/**', 'docs/public/secret.md']
    })
    const { kept, excluded } = selectFiles(
      ['docs/a.md', 'docs/public/b.md', 'docs/public/secret.md'],
      config
    )
    expect(kept).toEqual(['docs/public/b.md'])
    expect(excluded.map((e) => e.path)).toEqual(['docs/a.md', 'docs/public/secret.md'])
  })

  test('an empty include list is refused', () => {
    expect(() => normaliseConfig({ include: [] })).toThrow(/include/)
  })
})

describe('planChanges and parseLsTree', () => {
  test('lists added, changed and deleted paths', () => {
    const tree = parseLsTree(
      [
        '100644 blob aaa\ta.ts',
        '100644 blob bbb\tb.ts',
        '160000 commit ccc\tsub',
        '100755 blob ddd\tx y.sh',
        ''
      ].join('\0')
    )
    expect([...tree.keys()]).toEqual(['a.ts', 'b.ts', 'x y.sh'])
    const current = new Map([
      ['a.ts', '100644 aaa'],
      ['b.ts', '100644 old'],
      ['gone.ts', '100644 eee']
    ])
    expect(planChanges(tree, current)).toEqual({
      added: ['x y.sh'],
      modified: ['b.ts'],
      deleted: ['gone.ts']
    })
  })

  test('a mode change counts as a change', () => {
    const plan = planChanges(new Map([['a', '100755 s']]), new Map([['a', '100644 s']]))
    expect(plan.modified).toEqual(['a'])
  })
})

describe('commit message', () => {
  const sha = '0123456789abcdef0123456789abcdef01234567'

  test('first sync', () => {
    const msg = commitMessage({ shortSha: '01234567', fullSha: sha, subjects: [], first: true })
    expect(msg.split('\n')[0]).toBe('Sync from private 01234567: First public snapshot')
    expect(lastSyncedCommit(msg)).toBe(sha)
  })

  test('later syncs list the subjects and keep the title short', () => {
    const subjects = Array.from(
      { length: 70 },
      (_, i) => `Change number ${i + 1} with a longer subject line`
    )
    const msg = commitMessage({ shortSha: '01234567', fullSha: sha, subjects, first: false })
    const [title] = msg.split('\n')
    expect(title.startsWith('Sync from private 01234567: Change number 1')).toBe(true)
    expect(title).toContain('(+69 more)')
    expect(title.length).toBeLessThanOrEqual(100)
    expect(msg).toContain('- Change number 60 with')
    expect(msg).toContain('- …and 10 more')
    expect(lastSyncedCommit(msg)).toBe(sha)
  })

  test('short lists fit in the title', () => {
    const msg = commitMessage({
      shortSha: 'abcd1234',
      fullSha: sha,
      subjects: ['Fix A', 'Fix B'],
      first: false
    })
    expect(msg.split('\n')[0]).toBe('Sync from private abcd1234: Fix A; Fix B')
  })

  test('subjects naming private words are hidden', () => {
    expect(publicSubjects(['Report like the Kissflow sample', 'Fix chart'], ['kissflow'])).toEqual([
      'Private change',
      'Fix chart'
    ])
  })
})

describe('licenseProblems', () => {
  const config = normaliseConfig({ include: ['**'], apacheAllowed: ['package-lock.json'] })
  const base = [
    { path: 'LICENSE', text: 'CiteFox Source-Available License 1.0' },
    { path: 'NOTICE', text: 'CiteFox' },
    { path: 'TRADEMARKS.md', text: 'CiteFox' },
    { path: 'package.json', text: JSON.stringify({ license: 'SEE LICENSE IN LICENSE' }) }
  ]

  test('a clean export passes', () => {
    expect(licenseProblems(base, config)).toEqual([])
  })

  test('missing files and Apache-2.0 claims fail', () => {
    const files = [
      ...base.filter((f) => f.path !== 'NOTICE'),
      { path: 'README.md', text: 'Licensed under Apache-2.0.' },
      { path: 'package-lock.json', text: '"license": "Apache-2.0"' },
      { path: 'logo.png', text: null }
    ]
    const problems = licenseProblems(files, config)
    expect(problems).toContain('NOTICE is missing')
    expect(problems.some((p) => p.startsWith('README.md:1'))).toBe(true)
    expect(problems.some((p) => p.startsWith('package-lock.json'))).toBe(false)
  })

  test('package.json must point at LICENSE', () => {
    const files = base.map((f) =>
      f.path === 'package.json' ? { ...f, text: JSON.stringify({ license: 'Apache-2.0' }) } : f
    )
    expect(licenseProblems(files, config)).toEqual([
      'package.json: license is "Apache-2.0", expected "SEE LICENSE IN LICENSE"'
    ])
  })
})

// Test keys are built from pieces so this file never holds a key-shaped string.
const rand = (n) => 'Q7mZ4pX9vR2kT8wB3nY6cL1dF5gH0jA'.repeat(4).slice(0, n)
const googleKey = 'AI' + 'za' + rand(35)
const openaiKey = 'sk-' + 'proj-' + rand(48)
const githubToken = 'gh' + 'p_' + rand(36)
const privateKey = '-----BEGIN ' + 'RSA PRIVATE KEY-----'
const serpKey = [
  '9f3c1e7a5b2d8f40',
  '6c1a9e3b7d5f2a8c',
  '4e0b6d2f8a1c7e39',
  '5b0d2f6a8c4e1b73'
].join('')

describe('built-in secret scan', () => {
  test('finds common key formats and masks them', () => {
    expect(scanLine(`const k = "${googleKey}"`)[0]).toEqual({
      rule: 'google-api-key',
      preview: maskSecret(googleKey)
    })
    expect(scanLine(`OPENAI=${openaiKey}`)[0]?.rule).toBe('openai-key')
    expect(scanLine(`token: '${githubToken}'`)[0]?.rule).toBe('github-token')
    expect(scanLine(privateKey)[0]?.rule).toBe('private-key')
    expect(scanLine(`SERPAPI_API_KEY=${serpKey}`)[0]?.rule).toBe('high-entropy-assignment')
    expect(scanLine(`const apiKey = '${serpKey}'`)[0]?.rule).toBe('high-entropy-assignment')
    expect(maskSecret(googleKey)).toBe('AIza… (39 chars)')
  })

  test('never returns the whole value', () => {
    const text = scanText(`a\nconst secret = "${serpKey}"\n`)
    expect(text).toHaveLength(1)
    expect(text[0]?.line).toBe(2)
    expect(JSON.stringify(text)).not.toContain(serpKey.slice(4))
  })

  test('leaves fake values, keychain names and ids alone', () => {
    for (const line of [
      "keychainRef: 'citefox.serpapi.key-1'",
      "const SECRET = 'sk-test-secret-value-1234'",
      "const CLIENT_KEY = 'sk-ant-client-secret-0001'",
      "detail: 'failed with sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789'",
      "occurrenceKey: 'report:sched-weekly:weekly:2026-02-02'",
      "const KEY = 'citefox.sidebarGroups.'",
      'SERPAPI_API_KEY=',
      'const apiKey = process.env.SERPAPI_API_KEY',
      `const k = "${googleKey}" // gitleaks:allow`
    ]) {
      expect(scanLine(line), line).toEqual([])
    }
  })

  test('reads only added lines of a staged diff', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -10,2 +10,3 @@',
      `-const old = "${googleKey}"`,
      ' unchanged',
      `+const key = "${googleKey}"`,
      '+const ok = 1'
    ].join('\n')
    expect(scanDiff(diff)).toEqual([
      { file: 'src/a.ts', line: 11, rule: 'google-api-key', preview: maskSecret(googleKey) }
    ])
  })
})
