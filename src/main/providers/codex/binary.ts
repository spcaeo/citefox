import path, { join } from 'node:path'
import type { BinaryProbe, LocatedBinary } from '../claude/binary'
import { isCredentialPath } from '../claude/binary'

/** File names the OpenAI Codex CLI may have. Windows names match case-insensitively. */
export function codexBinaryNames(platform: NodeJS.Platform): readonly string[] {
  return platform === 'win32' ? ['codex.exe', 'codex.cmd'] : ['codex']
}

export function codexExecutableName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'codex.exe' : 'codex'
}

function pathFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix
}

function isCodexName(name: string, platform: NodeJS.Platform): boolean {
  const candidate = platform === 'win32' ? name.toLowerCase() : name
  return codexBinaryNames(platform).includes(candidate)
}

/**
 * Codex keeps its ChatGPT login in `~/.codex/auth.json`. CiteFox never reads it,
 * so that file (and Claude's credential files) is never a candidate.
 */
export function isCodexCredentialPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase()
  return isCredentialPath(filePath) || normalized.endsWith('/auth.json')
}

/**
 * Same rule as `claudeBinaryPathProblem`: the renderer can set this path and CiteFox
 * runs it, so only an absolute path to a file named `codex` (`codex.exe` or
 * `codex.cmd` on Windows) is accepted. Returns the reason, or null when acceptable.
 */
export function codexBinaryPathProblem(
  filePath: string,
  platform: NodeJS.Platform = process.platform
): string | null {
  const names = codexBinaryNames(platform).join(' or ')
  const paths = pathFor(platform)
  if (!paths.isAbsolute(filePath)) {
    return `The Codex path must be a full path to the ${names} program.`
  }
  if (!isCodexName(paths.basename(filePath), platform)) {
    return `The Codex path must point to the ${names} program.`
  }
  return null
}

/**
 * True when a symlink target is the Codex CLI: named like the program, or inside a
 * Codex install (`~/.codex/packages/standalone/<v>/bin/codex`, `@openai/codex/bin/codex.js`,
 * `Caskroom/codex/...`).
 */
export function isCodexInstallTarget(
  resolved: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  const paths = pathFor(platform)
  if (isCodexName(paths.basename(resolved), platform)) return true
  return paths
    .dirname(resolved)
    .split(/[\\/]+/)
    .some((segment) => segment.toLowerCase().includes('codex'))
}

/** Usual install folders after PATH: the standalone installer, npm, Homebrew. */
export function usualCodexBinaryCandidates(
  home: string,
  platform: NodeJS.Platform
): readonly string[] {
  const name = codexExecutableName(platform)
  const candidates = [join(home, '.local', 'bin', name), join(home, '.npm-global', 'bin', name)]
  if (platform === 'win32') {
    candidates.push(join(home, 'AppData', 'Roaming', 'npm', 'codex.cmd'))
  } else {
    candidates.push('/usr/local/bin/codex')
    candidates.push(platform === 'darwin' ? '/opt/homebrew/bin/codex' : '/usr/bin/codex')
  }
  return candidates.filter((candidate) => !isCodexCredentialPath(candidate))
}

/** The saved path when it is a real Codex program, else PATH, else the usual folders. */
export function locateCodexBinary(
  preferred: string | null,
  probe: BinaryProbe,
  context: { home: string; platform: NodeJS.Platform; pathEnv: string | undefined }
): LocatedBinary {
  if (preferred !== null) {
    if (codexBinaryPathProblem(preferred, context.platform) !== null) {
      return { path: null, source: 'override' }
    }
    if (isCodexCredentialPath(preferred) || !probe.exists(preferred)) {
      return { path: null, source: 'override' }
    }
    if (probe.resolve !== undefined) {
      const target = probe.resolve(preferred)
      if (target === null || !isCodexInstallTarget(target, context.platform)) {
        return { path: null, source: 'override' }
      }
    }
    return { path: preferred, source: 'override' }
  }
  let onPath: string | null = null
  // Every name, in order: on Windows npm installs `codex.cmd`.
  for (const name of codexBinaryNames(context.platform)) {
    onPath = probe.searchPath(name, context.pathEnv)
    if (onPath !== null) break
  }
  if (onPath !== null && !isCodexCredentialPath(onPath)) return { path: onPath, source: 'path' }
  for (const candidate of usualCodexBinaryCandidates(context.home, context.platform)) {
    if (probe.exists(candidate)) return { path: candidate, source: 'usual' }
  }
  return { path: null, source: 'search' }
}
