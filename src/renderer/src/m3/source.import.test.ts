import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve('src/renderer/src/m3')
const STARTS = ['source.ts', 'RunningPage.tsx', 'ResultsPanel.tsx']
const FORBIDDEN = new Set(['fixtures.ts', 'mocks.ts', 'preview.tsx', 'shellHarness.tsx'])

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

describe('production check and results adapter', () => {
  it('does not import fixtures or the harness', () => {
    const files = STARTS.flatMap((name) => closure(resolve(ROOT, name)))
    const leaked = files.filter((file) => FORBIDDEN.has(file.slice(file.lastIndexOf('/') + 1)))
    expect(leaked).toEqual([])
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toContain('Timed out once, retried')
      expect(text, file).not.toContain('textboltJob')
      expect(text, file).not.toContain('textboltResults')
    }
    const adapter = readFileSync(resolve(ROOT, 'source.ts'), 'utf8')
    expect(adapter).toContain("requireApi()['checks:start']")
    expect(adapter).toContain("requireApi()['prompts:list']")
    expect(adapter).toContain("requireApi()['checks:listActive']")
    expect(adapter).toContain("requireApi()['checks:get']")
    expect(adapter).toContain("requireApi()['checks:cancel']")
    expect(adapter).toContain("requireApi()['results:get']")
    const shell = readFileSync(resolve('src/renderer/src/shell/AppShell.tsx'), 'utf8')
    expect(shell).toContain("import('../m3/RunningPage')")
    const tabs = readFileSync(resolve('src/renderer/src/shell/PageTabBody.tsx'), 'utf8')
    expect(tabs).toContain("import('../m3/ResultsPanel')")
    expect(tabs).not.toContain('m3/fixtures')
    expect(shell).not.toContain('m3/fixtures')
    expect(shell).not.toContain('textboltJob')
    expect(shell).not.toContain('textboltResults')
  })
})
