import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve('src/renderer/src/visibility')
const STARTS = ['source.ts', 'CitationsScreen.tsx', 'ScoresScreen.tsx']
const FORBIDDEN = new Set([
  'mocks.ts',
  'progress.sample.ts',
  'chart.sample.ts',
  'ProgressSample.tsx',
  'fixtures.ts'
])

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(from), spec)
  const candidates = [`${base}.ts`, `${base}.tsx`, base, `${base}/index.ts`, `${base}/index.tsx`]
  for (const candidate of candidates) {
    try {
      readFileSync(candidate, 'utf8')
      return candidate
    } catch {
      continue
    }
  }
  return null
}

function closure(start: string): string[] {
  const seen = new Set<string>()
  const queue = [start]
  while (queue.length > 0) {
    const file = queue.pop()
    if (!file || seen.has(file)) continue
    seen.add(file)
    const text = readFileSync(file, 'utf8')
    const pattern = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g
    for (const match of text.matchAll(pattern)) {
      const spec = match[1]
      if (!spec) continue
      const next = resolveImport(file, spec)
      if (next) queue.push(next)
    }
  }
  return [...seen]
}

describe('production visibility adapter', () => {
  it('does not import the fixtures', () => {
    const files = STARTS.flatMap((name) => closure(resolve(ROOT, name)))
    const leaked = files.filter((file) => FORBIDDEN.has(file.slice(file.lastIndexOf('/') + 1)))
    expect(leaked).toEqual([])
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toContain('Added 5 FAQs')
      expect(text, file).not.toContain('simpletexting.com, clicksend.com')
    }
    const adapter = readFileSync(resolve(ROOT, 'source.ts'), 'utf8')
    expect(adapter).not.toContain('mockVisibilitySource')
    expect(adapter).not.toContain('progressDetail')
    expect(adapter).not.toContain('markersFor')
    expect(adapter).toContain("requireApi()['results:get']")
    expect(adapter).toContain("requireApi()['results:history']")
    expect(adapter).toContain("requireApi()['scores:listProjects']")
    expect(adapter).toContain("requireApi()['scores:listPages']")
    const shell = readFileSync(resolve('src/renderer/src/shell/AppShell.tsx'), 'utf8')
    expect(shell).not.toContain('progress.sample')
    expect(shell).not.toContain('chart.sample')
    expect(shell).not.toContain('visibility/mocks')
  })
})
