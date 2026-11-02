import { accessSync, constants, realpathSync } from 'node:fs'
import path, { delimiter, join } from 'node:path'

export interface BinaryProbe {
  exists(filePath: string): boolean
  searchPath(fileName: string, pathEnv: string | undefined): string | null
  /** The file a path points to after every symlink, or null. Omitted: no check. */
  resolve?(filePath: string): string | null
}

/** File names a Claude Code program may have. Windows names match case-insensitively. */
export function claudeBinaryNames(platform: NodeJS.Platform): readonly string[] {
  return platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude']
}

function pathFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix
}

function isClaudeName(name: string, platform: NodeJS.Platform): boolean {
  const candidate = platform === 'win32' ? name.toLowerCase() : name
  return claudeBinaryNames(platform).includes(candidate)
}

/**
 * The renderer can set the Claude Code path (Settings, onboarding checkup),
 * and CiteFox then executes it. Only an absolute path to a file named
 * `claude` (`claude.exe` or `claude.cmd` on Windows) is accepted, so a
 * compromised renderer cannot point CiteFox at a shell or another program.
 * Returns the reason, or null when the path is acceptable.
 */
export function claudeBinaryPathProblem(
  filePath: string,
  platform: NodeJS.Platform = process.platform
): string | null {
  const names = claudeBinaryNames(platform).join(' or ')
  const paths = pathFor(platform)
  if (!paths.isAbsolute(filePath)) {
    return `The Claude Code path must be a full path to the ${names} program.`
  }
  if (!isClaudeName(paths.basename(filePath), platform)) {
    return `The Claude Code path must point to the ${names} program.`
  }
  return null
}

/**
 * True when a symlink target is Claude Code: it is named like the program,
 * or it sits inside a Claude Code install (`~/.local/share/claude/versions/<v>`,
 * `@anthropic-ai/claude-code/cli.js`, `Caskroom/claude-code/...`).
 */
export function isClaudeInstallTarget(
  resolved: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  const paths = pathFor(platform)
  if (isClaudeName(paths.basename(resolved), platform)) return true
  return paths
    .dirname(resolved)
    .split(/[\\/]+/)
    .some((segment) => segment.toLowerCase().includes('claude'))
}

/**
 * LLM-2. Credential files are never candidates. CiteFox does not read Claude
 * Code's OAuth token from disk or from the keychain.
 */
export function isCredentialPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase()
  return (
    normalized.includes('credentials') ||
    normalized.includes('oauth') ||
    normalized.endsWith('/.claude.json')
  )
}

export function claudeExecutableName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'claude.exe' : 'claude'
}

/** LLM-1. Usual install folders after PATH. Override and PATH are tried first. */
export function usualClaudeBinaryCandidates(
  home: string,
  platform: NodeJS.Platform
): readonly string[] {
  const name = claudeExecutableName(platform)
  const candidates = [join(home, '.local', 'bin', name), join(home, '.claude', 'local', name)]
  if (platform === 'win32') {
    candidates.push(join(home, 'AppData', 'Local', 'Programs', 'claude', name))
  } else {
    candidates.push('/usr/local/bin/claude')
    candidates.push(platform === 'darwin' ? '/opt/homebrew/bin/claude' : '/usr/bin/claude')
  }
  return candidates.filter((candidate) => !isCredentialPath(candidate))
}

/**
 * Test runs only: with `CITEFOX_E2E_FAKE_AI_ONLY=1` an unpackaged build finds Claude Code
 * and Codex only in the temp folder (where e2e specs put their shims) or inside the app,
 * so a test never runs the real `claude` or `codex` installed on the developer's computer.
 * Null means no limit. A packaged app ignores the variable.
 */
export function fakeAiOnlyRoots(
  isPackaged: boolean,
  roots: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): readonly string[] | null {
  return !isPackaged && env.CITEFOX_E2E_FAKE_AI_ONLY === '1' ? roots : null
}

function isUnder(filePath: string, roots: readonly string[]): boolean {
  const paths = [path.resolve(filePath)]
  try {
    paths.push(realpathSync(filePath))
  } catch {
    // A missing file is checked by its name only.
  }
  return roots.some((root) => {
    const bases = [path.resolve(root)]
    try {
      bases.push(realpathSync(root))
    } catch {
      // A missing root holds nothing.
    }
    return paths.some((candidate) =>
      bases.some((base) => candidate === base || candidate.startsWith(base + path.sep))
    )
  })
}

/** `onlyUnder`: see {@link fakeAiOnlyRoots}. */
export function createFsBinaryProbe(onlyUnder: readonly string[] | null = null): BinaryProbe {
  const exists = (filePath: string): boolean => {
    if (isCredentialPath(filePath)) return false
    if (onlyUnder !== null && !isUnder(filePath, onlyUnder)) return false
    try {
      accessSync(filePath, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
      return true
    } catch {
      return false
    }
  }
  return {
    exists,
    resolve(filePath: string): string | null {
      try {
        return realpathSync(filePath)
      } catch {
        return null
      }
    },
    searchPath(fileName: string, pathEnv: string | undefined): string | null {
      if (pathEnv === undefined || pathEnv.length === 0) return null
      for (const directory of pathEnv.split(delimiter)) {
        if (directory.length === 0) continue
        const candidate = join(directory, fileName)
        if (exists(candidate)) return candidate
      }
      return null
    }
  }
}

export type LocatedBinary =
  | { path: string; source: 'override' | 'path' | 'usual' }
  | { path: null; source: 'override' | 'search' }

export function locateClaudeBinary(
  preferred: string | null,
  probe: BinaryProbe,
  context: { home: string; platform: NodeJS.Platform; pathEnv: string | undefined }
): LocatedBinary {
  if (preferred !== null) {
    if (claudeBinaryPathProblem(preferred, context.platform) !== null) {
      return { path: null, source: 'override' }
    }
    if (isCredentialPath(preferred) || !probe.exists(preferred)) {
      return { path: null, source: 'override' }
    }
    if (probe.resolve !== undefined) {
      const target = probe.resolve(preferred)
      if (target === null || !isClaudeInstallTarget(target, context.platform)) {
        return { path: null, source: 'override' }
      }
    }
    return { path: preferred, source: 'override' }
  }
  const onPath = probe.searchPath(claudeExecutableName(context.platform), context.pathEnv)
  if (onPath !== null && !isCredentialPath(onPath)) return { path: onPath, source: 'path' }
  for (const candidate of usualClaudeBinaryCandidates(context.home, context.platform)) {
    if (probe.exists(candidate)) return { path: candidate, source: 'usual' }
  }
  return { path: null, source: 'search' }
}
