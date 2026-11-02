import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

/**
 * Playwright loads specs as CommonJS and does not apply Vite or tsconfig paths
 * to files under src/main. The check engine imports markdown with Vite's
 * `?raw` suffix, and handlers import `@shared/*`. This resolver maps both
 * onto files Node can load. The markdown is written out as CommonJS so
 * Playwright does not parse the template as TypeScript.
 */
const nodeRequire = createRequire(__filename)
const ROOT = path.resolve(__dirname, '../..')
const RAW_DIR = path.join(os.tmpdir(), 'citefox-raw-modules')

interface NodeModuleCtor {
  _resolveFilename: (
    this: unknown,
    request: string,
    parent: NodeJS.Module | null | undefined,
    isMain: boolean,
    options?: unknown
  ) => string
}

let installed = false

/** `@shared` and `@shared/*` from tsconfig.node.json. Node cannot see those paths. */
function sharedFilename(request: string): string | null {
  const subpath =
    request === '@shared'
      ? 'index'
      : request.startsWith('@shared/')
        ? request.slice('@shared/'.length)
        : null
  if (subpath === null) return null
  const base = path.resolve(ROOT, 'src/shared', subpath)
  if (existsSync(`${base}.ts`)) return `${base}.ts`
  if (existsSync(path.join(base, 'index.ts'))) return path.join(base, 'index.ts')
  return null
}

function rawModule(markdownPath: string): string {
  const text = readFileSync(markdownPath, 'utf8')
  const name = createHash('sha256').update(markdownPath).digest('hex').slice(0, 16)
  const dest = path.join(RAW_DIR, `${name}.cjs`)
  mkdirSync(RAW_DIR, { recursive: true })
  writeFileSync(dest, `module.exports = ${JSON.stringify({ __esModule: true, default: text })};\n`)
  return dest
}

export function installRawMarkdown(): void {
  if (installed) return
  installed = true
  const Module = nodeRequire('module') as NodeModuleCtor
  const resolve = Module._resolveFilename
  Module._resolveFilename = function (request, parent, isMain, options) {
    const shared = sharedFilename(request)
    if (shared !== null) return shared
    if (request.endsWith('?raw')) {
      const markdown = resolve.call(this, request.slice(0, -'?raw'.length), parent, isMain, options)
      return rawModule(markdown)
    }
    return resolve.call(this, request, parent, isMain, options)
  }
}
