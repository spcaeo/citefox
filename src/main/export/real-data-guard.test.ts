import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOTS = [
  'src/main/scheduler',
  'src/main/queue',
  'src/main/headless',
  'src/main/tray',
  'src/main/email',
  'src/main/export'
]
const HARNESS = resolve('src/main/email/harness.ts')
const KINDS = new Set([
  'fixture',
  'fixtures',
  'mock',
  'mocks',
  'sample',
  'samples',
  'demo',
  'demos',
  'seed',
  'seeds',
  'harness'
])

function isTestFile(file: string): boolean {
  const name = basename(file)
  return name.includes('.test.') || name.includes('.spec.') || name.includes('.test-helper.')
}

function walk(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory)) {
    const file = join(directory, entry)
    if (statSync(file).isDirectory()) files.push(...walk(file))
    else files.push(file)
  }
  return files
}

function sourceFiles(directory: string): string[] {
  return walk(resolve(directory)).filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'))
}

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(from), spec)
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    base,
    `${base}/index.ts`,
    `${base}/index.tsx`
  ]
  for (const candidate of candidates) {
    if (!existsSync(candidate) || statSync(candidate).isDirectory()) continue
    return candidate
  }
  return null
}

function importedFiles(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  const pattern = /(?:from|import|require)\s*\(?\s*['"](\.[^'"]+)['"]/g
  const files: string[] = []
  for (const match of text.matchAll(pattern)) {
    const spec = match[1]
    if (!spec) continue
    const next = resolveImport(file, spec)
    if (next) files.push(next)
  }
  return files
}

function closure(start: string): string[] {
  const seen = new Set<string>()
  const queue = [start]
  while (queue.length > 0) {
    const file = queue.pop()
    if (!file || seen.has(file)) continue
    seen.add(file)
    for (const next of importedFiles(file)) queue.push(next)
  }
  return [...seen]
}

function forbiddenModule(file: string): boolean {
  return file
    .split(/[/\\]/)
    .some((part) => part.split(/[.-]/).some((token) => KINDS.has(token.toLowerCase())))
}

function harnessPassword(): string {
  const source = readFileSync(HARNESS, 'utf8')
  const match = source.match(/export const PASSWORD = '([^']*)'/)
  const value = match?.[1]
  if (value === undefined || value.length === 0) {
    throw new Error('Could not read the harness password export')
  }
  return value
}

describe('real data stays out of production imports', () => {
  test('non-test files under the six folders do not import fixture, mock, sample, demo, seed, or harness modules', () => {
    const leaked: string[] = []
    for (const root of ROOTS) {
      for (const file of sourceFiles(root)) {
        if (isTestFile(file)) continue
        for (const imported of closure(file)) {
          if (imported === file) continue
          if (forbiddenModule(imported)) leaked.push(`${file} -> ${imported}`)
        }
      }
    }
    expect(leaked).toEqual([])
  })

  test('only test files import the email harness', () => {
    const leaked: string[] = []
    for (const file of sourceFiles('src')) {
      if (isTestFile(file)) continue
      if (importedFiles(file).includes(HARNESS)) leaked.push(file)
    }
    expect(leaked).toEqual([])
    const importers = sourceFiles('src').filter((file) => importedFiles(file).includes(HARNESS))
    expect(importers.length).toBeGreaterThan(0)
    expect(importers.every((file) => isTestFile(file))).toBe(true)
  })

  test('the built main bundle does not contain the email harness or its sample password', () => {
    const bundleDir = resolve('out/main')
    expect(existsSync(bundleDir), 'out/main is absent. Run npm run build before this check.').toBe(
      true
    )
    const password = harnessPassword()
    let leaked = false
    let harnessModule = false
    const files = walk(bundleDir)
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const bytes = readFileSync(file)
      if (bytes.includes(password)) leaked = true
      const text = bytes.toString('utf8')
      if (
        text.includes('email/harness') ||
        text.includes('emailHarness') ||
        text.includes('harness.ts')
      ) {
        harnessModule = true
      }
    }
    expect(leaked).toBe(false)
    expect(harnessModule).toBe(false)
  })
})
