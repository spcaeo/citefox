import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { gitCommitCount, nextBuildNumber } from '../../scripts/build-number'

const dirs: string[] = []
function counterFile(content?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'citefox-build-'))
  dirs.push(dir)
  const file = join(dir, '.build-number')
  if (content !== undefined) writeFileSync(file, content)
  return file
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('build number', () => {
  it('is the git commit count in this checkout', () => {
    const count = gitCommitCount()
    expect(count).toBeGreaterThan(0)
    expect(nextBuildNumber({ file: counterFile() })).toBe(count)
  })

  it('outside git, bumps the stored counter', () => {
    const file = counterFile('41\n')
    expect(nextBuildNumber({ count: () => null, file })).toBe(42)
    expect(nextBuildNumber({ count: () => null, file })).toBe(43)
    expect(readFileSync(file, 'utf8').trim()).toBe('43')
  })

  it('never goes down', () => {
    const file = counterFile('500')
    expect(nextBuildNumber({ count: () => 120, file })).toBe(500)
    expect(nextBuildNumber({ count: () => 700, file })).toBe(700)
  })
})
