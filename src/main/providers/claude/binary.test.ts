import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  claudeBinaryPathProblem,
  createFsBinaryProbe,
  fakeAiOnlyRoots,
  isClaudeInstallTarget,
  locateClaudeBinary,
  type BinaryProbe
} from './binary'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'citefox-binary-'))
  dirs.push(dir)
  return dir
}

function executable(filePath: string): string {
  writeFileSync(filePath, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  return filePath
}

const context = { home: '/home/tester', platform: 'linux' as const, pathEnv: '' }

describe('Claude binary path rules', () => {
  test.each([
    ['/usr/local/bin/claude', 'linux'],
    ['/Users/me/.local/bin/claude', 'darwin'],
    ['C:\\Users\\me\\.local\\bin\\claude.exe', 'win32'],
    ['C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd', 'win32']
  ] as const)('accepts %s on %s', (filePath, platform) => {
    expect(claudeBinaryPathProblem(filePath, platform)).toBeNull()
  })

  test.each([
    ['claude', 'linux'],
    ['./claude', 'linux'],
    ['/bin/sh', 'linux'],
    ['/usr/bin/python3', 'darwin'],
    ['/tmp/claude.sh', 'linux'],
    ['/usr/local/bin/claude.cmd', 'linux'],
    ['C:\\Windows\\System32\\cmd.exe', 'win32'],
    ['claude.exe', 'win32']
  ] as const)('rejects %s on %s', (filePath, platform) => {
    expect(claudeBinaryPathProblem(filePath, platform)).toMatch(/claude/)
  })

  test('a resolved target must be named claude or live in a Claude Code install', () => {
    expect(isClaudeInstallTarget('/opt/homebrew/Caskroom/claude-code/2.1.3/claude', 'darwin')).toBe(
      true
    )
    expect(isClaudeInstallTarget('/Users/me/.local/share/claude/versions/2.1.305', 'darwin')).toBe(
      true
    )
    expect(
      isClaudeInstallTarget('/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js', 'linux')
    ).toBe(true)
    expect(isClaudeInstallTarget('/bin/bash', 'linux')).toBe(false)
    expect(isClaudeInstallTarget('/usr/bin/python3', 'linux')).toBe(false)
  })

  test('an override must pass the name rule before it is probed', () => {
    const probed: string[] = []
    const probe: BinaryProbe = {
      exists: (filePath) => {
        probed.push(filePath)
        return true
      },
      searchPath: () => null
    }
    expect(locateClaudeBinary('/bin/sh', probe, context)).toEqual({
      path: null,
      source: 'override'
    })
    expect(probed).toEqual([])
  })

  test.skipIf(process.platform === 'win32')(
    'follows symlinks: a claude link to a shell is rejected, a versioned install is kept',
    () => {
      const dir = tempDir()
      const bin = join(dir, 'bin')
      mkdirSync(bin)
      symlinkSync('/bin/sh', join(bin, 'claude'))
      const probe = createFsBinaryProbe()
      expect(locateClaudeBinary(join(bin, 'claude'), probe, context)).toEqual({
        path: null,
        source: 'override'
      })

      const versions = join(dir, 'share', 'claude', 'versions')
      mkdirSync(versions, { recursive: true })
      const real = executable(join(versions, '2.1.305'))
      const other = join(dir, 'other')
      mkdirSync(other)
      symlinkSync(real, join(other, 'claude'))
      expect(locateClaudeBinary(join(other, 'claude'), probe, context)).toEqual({
        path: join(other, 'claude'),
        source: 'override'
      })
    }
  )
})

describe('e2e runs find only fake AI programs', () => {
  test('the limit applies only to unpackaged builds with CITEFOX_E2E_FAKE_AI_ONLY=1', () => {
    expect(fakeAiOnlyRoots(false, ['/tmp'], { CITEFOX_E2E_FAKE_AI_ONLY: '1' })).toEqual(['/tmp'])
    expect(fakeAiOnlyRoots(true, ['/tmp'], { CITEFOX_E2E_FAKE_AI_ONLY: '1' })).toBeNull()
    expect(fakeAiOnlyRoots(false, ['/tmp'], {})).toBeNull()
  })

  test.skipIf(process.platform === 'win32')(
    'a limited probe sees programs inside its folders only, on PATH or by name',
    () => {
      const shims = tempDir()
      const real = tempDir()
      executable(join(shims, 'claude'))
      executable(join(real, 'codex'))
      const probe = createFsBinaryProbe([shims])
      expect(probe.exists(join(shims, 'claude'))).toBe(true)
      expect(probe.exists(join(real, 'codex'))).toBe(false)
      expect(probe.searchPath('codex', real)).toBeNull()
      expect(probe.searchPath('claude', `${real}:${shims}`)).toBe(join(shims, 'claude'))
      expect(createFsBinaryProbe().exists(join(real, 'codex'))).toBe(true)
    }
  )
})
