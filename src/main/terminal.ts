import { spawn } from 'node:child_process'
import type { OpenTerminalResult } from '@shared/ipc'

/** Starts a process and resolves once the OS has spawned it. */
export interface ProcessLaunch {
  spawn(command: string, args: readonly string[]): Promise<void>
}

const LINUX_TERMINALS = [
  'x-terminal-emulator',
  'gnome-terminal',
  'konsole',
  'xfce4-terminal',
  'xterm'
] as const

/**
 * LLM-2. Opens the user's terminal so they can run `claude` themselves.
 * CiteFox does not start a Claude login and does not pass a secret.
 */
export async function openClaudeTerminal(
  launch: ProcessLaunch,
  platform: NodeJS.Platform = process.platform
): Promise<OpenTerminalResult> {
  try {
    if (platform === 'darwin') {
      await launch.spawn('open', ['-a', 'Terminal'])
    } else if (platform === 'win32') {
      await launch.spawn('cmd.exe', ['/c', 'start', 'cmd.exe'])
    } else {
      await launchFirst(launch, LINUX_TERMINALS)
    }
    return {
      opened: true,
      message: 'Opened a terminal. Run claude and log in there. CiteFox does not log in for you.'
    }
  } catch {
    return {
      opened: false,
      message: 'Could not open a terminal. Open one yourself and run claude to log in.'
    }
  }
}

export function createProcessLaunch(): ProcessLaunch {
  return {
    spawn(command, args) {
      return new Promise((resolve, reject) => {
        const child = spawn(command, [...args], {
          shell: false,
          detached: true,
          stdio: 'ignore',
          windowsHide: false
        })
        child.once('error', reject)
        child.once('spawn', () => {
          child.unref()
          resolve()
        })
      })
    }
  }
}

async function launchFirst(launch: ProcessLaunch, commands: readonly string[]): Promise<void> {
  let last: unknown
  for (const command of commands) {
    try {
      await launch.spawn(command, [])
      return
    } catch (error) {
      last = error
    }
  }
  throw last instanceof Error ? last : new Error('Could not open a terminal')
}
