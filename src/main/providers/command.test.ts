import { existsSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  createSpawnCommandTransport,
  providerCommandSpawnOptions,
  runCommandWithRetry,
  type CommandTransport
} from './command'

describe('spawn command transport', () => {
  test('passes args as an array and does not invoke a shell', async () => {
    const payload = 'hello; echo pwned'
    const transport = createSpawnCommandTransport()
    const result = await transport.run({
      command: process.execPath,
      args: [
        '-e',
        'let s="";process.stdin.on("data",(d)=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.stringify({argv:process.argv.slice(1),stdin:s})))',
        payload
      ],
      stdin: 'prompt-not-in-argv',
      timeoutMs: 5_000
    })
    expect(result.spawnError).toBeNull()
    expect(result.timedOut).toBe(false)
    expect(result.exitCode).toBe(0)
    const parsed: unknown = JSON.parse(result.stdout)
    if (typeof parsed !== 'object' || parsed === null) throw new Error('expected json')
    const record = parsed as { argv?: unknown; stdin?: unknown }
    expect(record.argv).toContain(payload)
    expect(record.stdin).toBe('prompt-not-in-argv')
  })

  test('kills a command that exceeds timeoutMs', async () => {
    const transport = createSpawnCommandTransport()
    const started = Date.now()
    const result = await transport.run({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 60000)'],
      timeoutMs: 300
    })
    expect(result.timedOut).toBe(true)
    expect(result.spawnError).toBeNull()
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  test('spawn options close stdin for claude -p and do not use a shell', async () => {
    const request = {
      command: 'claude',
      args: ['-p', 'query'],
      stdin: null,
      timeoutMs: 1_000
    }
    expect(providerCommandSpawnOptions(request, '/tmp/iso')).toEqual({
      shell: false,
      windowsHide: true,
      env: undefined,
      cwd: '/tmp/iso',
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    expect(providerCommandSpawnOptions({ ...request, stdin: 'prompt' }).stdio[0]).toBe('pipe')

    const transport = createSpawnCommandTransport()
    const result = await transport.run({
      command: process.execPath,
      args: [
        '-e',
        'const fs=require("node:fs");const stat=fs.fstatSync(0);process.stdout.write(JSON.stringify({fifo:stat.isFIFO(),chr:stat.isCharacterDevice()}))'
      ],
      stdin: null,
      timeoutMs: 5_000
    })
    expect(result.spawnError).toBeNull()
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ fifo: false, chr: true })
  })

  test('reports ENOENT when the binary is missing', async () => {
    const transport = createSpawnCommandTransport()
    const result = await transport.run({
      command: '/tmp/citefox-no-such-claude',
      args: ['--version'],
      timeoutMs: 1_000
    })
    expect(result.spawnError).toBe('ENOENT')
    expect(result.timedOut).toBe(false)
  })
})

describe('runCommandWithRetry', () => {
  test('retries a timeout and does not retry ENOENT', async () => {
    const delays: number[] = []
    let timeouts = 0
    const transport: CommandTransport = {
      async run() {
        timeouts += 1
        return {
          exitCode: null,
          stdout: '',
          stderr: '',
          timedOut: true,
          spawnError: null
        }
      }
    }
    const result = await runCommandWithRetry(
      transport,
      { command: 'claude', args: ['--version'], timeoutMs: 20 },
      {
        sleep: async (ms) => {
          delays.push(ms)
        }
      }
    )
    expect(timeouts).toBe(3)
    expect(delays).toEqual([200, 400])
    expect(result.timedOut).toBe(true)

    let missing = 0
    const enoent: CommandTransport = {
      async run() {
        missing += 1
        return { exitCode: null, stdout: '', stderr: '', timedOut: false, spawnError: 'ENOENT' }
      }
    }
    await runCommandWithRetry(
      enoent,
      { command: 'claude', args: ['--version'], timeoutMs: 20 },
      {
        sleep: async () => {
          throw new Error('ENOENT must not retry')
        }
      }
    )
    expect(missing).toBe(1)
  })
})

describe('spawn isolation', () => {
  test('runs the child in a fresh empty temp folder and removes it afterwards', async () => {
    const transport = createSpawnCommandTransport()
    const result = await transport.run({
      command: process.execPath,
      args: [
        '-e',
        'const fs=require("node:fs");process.stdout.write(JSON.stringify({cwd:process.cwd(),entries:fs.readdirSync(".")}))'
      ],
      stdin: null,
      timeoutMs: 5_000
    })
    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.stdout) as { cwd: string; entries: string[] }
    expect(parsed.entries).toEqual([])
    expect(parsed.cwd).not.toBe(realpathSync(process.cwd()))
    expect(path.basename(parsed.cwd)).toMatch(/^citefox-claude-/)
    expect(existsSync(parsed.cwd)).toBe(false)
  })

  test.skipIf(process.platform === 'win32')(
    'a timeout kills the whole process group, including grandchildren',
    async () => {
      const transport = createSpawnCommandTransport()
      const script =
        'const {spawn}=require("node:child_process");' +
        'const g=spawn(process.execPath,["-e","setTimeout(()=>{},60000)"],{stdio:"ignore"});' +
        'process.stdout.write(String(g.pid)+"\\n");setTimeout(()=>{},60000)'
      const result = await transport.run({
        command: process.execPath,
        args: ['-e', script],
        stdin: null,
        timeoutMs: 800
      })
      expect(result.timedOut).toBe(true)
      const grandchild = Number(result.stdout.trim())
      expect(Number.isInteger(grandchild) && grandchild > 0).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(processAlive(grandchild)).toBe(false)
    }
  )

  test('spawn options pass the isolated folder and their own process group', () => {
    const options = providerCommandSpawnOptions({ stdin: 'x', env: undefined }, '/tmp/iso')
    expect(options.cwd).toBe('/tmp/iso')
    expect(options.detached).toBe(process.platform !== 'win32')
  })
})

describe('runCommandWithRetry budget', () => {
  test('a shared budget caps transport retries across calls', async () => {
    let runs = 0
    const transport: CommandTransport = {
      async run() {
        runs += 1
        return { exitCode: null, stdout: '', stderr: '', timedOut: true, spawnError: null }
      }
    }
    const budget = { retriesLeft: 1 }
    const request = { command: 'claude', args: ['-p'], timeoutMs: 20 }
    await runCommandWithRetry(transport, request, { sleep: async () => undefined, budget })
    expect(runs).toBe(2)
    expect(budget.retriesLeft).toBe(0)
    await runCommandWithRetry(transport, request, { sleep: async () => undefined, budget })
    expect(runs).toBe(3)
  })
})

/**
 * True while `pid` runs. A killed process whose parent never reaps it stays a
 * zombie, which `kill(pid, 0)` still reports. That happens to the orphaned
 * grandchild in a container without an init process (Docker's PID 1 is the
 * container command), so on Linux a zombie counts as dead.
 */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  if (process.platform !== 'linux') return true
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) !== 'Z'
  } catch {
    return false
  }
}
