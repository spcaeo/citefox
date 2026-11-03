import { describe, expect, it } from 'vitest'
import {
  escapeCmdArgument,
  escapeCmdCommand,
  isWindowsBatch,
  npmShimTarget,
  windowsBatchSpawn
} from './windows-cmd'

describe('Windows batch files (claude.cmd, codex.cmd)', () => {
  it('is only used for .cmd and .bat on Windows', () => {
    expect(isWindowsBatch('C:\\Users\\a\\AppData\\Roaming\\npm\\claude.cmd', 'win32')).toBe(true)
    expect(isWindowsBatch('C:\\tools\\codex.BAT', 'win32')).toBe(true)
    expect(isWindowsBatch('C:\\Program Files\\Claude\\claude.exe', 'win32')).toBe(false)
    expect(isWindowsBatch('/usr/local/bin/claude.cmd', 'darwin')).toBe(false)
  })

  it('quotes every argument and escapes cmd.exe metacharacters twice', () => {
    expect(escapeCmdArgument('-p')).toBe('^^^"-p^^^"')
    expect(escapeCmdArgument('a & calc')).toBe('^^^"a^^^ ^^^&^^^ calc^^^"')
    expect(escapeCmdArgument('50%')).toBe('^^^"50^^^%^^^"')
    expect(escapeCmdArgument('say "hi"')).toBe('^^^"say^^^ \\^^^"hi\\^^^"^^^"')
    expect(escapeCmdArgument('C:\\dir\\')).toBe('^^^"C:\\dir\\\\^^^"')
  })

  it('escapes the command path, spaces included', () => {
    expect(escapeCmdCommand('C:\\Program Files\\npm\\claude.cmd')).toBe(
      'C:\\Program^ Files\\npm\\claude.cmd'
    )
  })

  it('runs cmd.exe /d /s /c with the whole line quoted, verbatim, never a shell option', () => {
    const run = windowsBatchSpawn('C:\\npm\\claude.cmd', ['--model', 'x|y'], 'C:\\Windows\\cmd.exe')
    expect(run.file).toBe('C:\\Windows\\cmd.exe')
    expect(run.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(run.args[3]).toBe('"C:\\npm\\claude.cmd ^^^"--model^^^" ^^^"x^^^|y^^^""')
    expect(run.windowsVerbatimArguments).toBe(true)
  })
})

describe('npm launchers run node on their script directly', () => {
  const SHIM = [
    '@ECHO off',
    'GOTO start',
    ':find_dp0',
    'SET dp0=%~dp0',
    'EXIT /b',
    ':start',
    'SETLOCAL',
    'CALL :find_dp0',
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ') ELSE (',
    '  SET "_prog=node"',
    ')',
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*'
  ].join('\r\n')
  const CMD = 'C:\\Users\\a\\AppData\\Roaming\\npm\\claude.cmd'
  const SCRIPT =
    'C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js'

  it('finds the script next to the launcher and uses node from PATH', () => {
    expect(npmShimTarget(CMD, SHIM, (p) => p === SCRIPT)).toEqual({
      file: 'node',
      prefix: [SCRIPT]
    })
  })

  it('prefers a node.exe that sits beside the launcher', () => {
    const node = 'C:\\Users\\a\\AppData\\Roaming\\npm\\node.exe'
    expect(npmShimTarget(CMD, SHIM, (p) => p === SCRIPT || p === node)?.file).toBe(node)
  })

  it('returns null for other batch files or a missing script', () => {
    expect(npmShimTarget(CMD, '@echo off\r\nstart something.exe %*', () => true)).toBeNull()
    expect(npmShimTarget(CMD, SHIM, () => false)).toBeNull()
  })
})

describe('spawnTarget', () => {
  it('leaves an .exe or a POSIX path alone', async () => {
    const { spawnTarget } = await import('./command')
    expect(spawnTarget('/usr/local/bin/claude', ['-p'], 'linux')).toEqual({
      file: '/usr/local/bin/claude',
      args: ['-p'],
      verbatim: false
    })
    expect(spawnTarget('C:\\x\\claude.exe', ['-p'], 'win32').file).toBe('C:\\x\\claude.exe')
  })

  it('runs an npm claude.cmd as node + script, and any other .cmd through cmd.exe', async () => {
    const { spawnTarget } = await import('./command')
    const cmd = 'C:\\npm\\claude.cmd'
    const script = 'C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js'
    const shim = '"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*'
    expect(
      spawnTarget(
        cmd,
        ['-p'],
        'win32',
        () => shim,
        (p) => p === script
      )
    ).toEqual({ file: 'node', args: [script, '-p'], verbatim: false })
    const other = spawnTarget(
      cmd,
      ['-p'],
      'win32',
      () => '@echo off',
      () => false
    )
    expect(other.verbatim).toBe(true)
    expect(other.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
  })
})
