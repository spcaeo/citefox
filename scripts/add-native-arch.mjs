// Adds another arch's @napi-rs/keyring binary to node_modules, so one release
// runner can package more than its own arch:
//
//   node scripts/add-native-arch.mjs darwin x64     (Apple-chip Mac: Intel + universal)
//   node scripts/add-native-arch.mjs win32 arm64    (x64 Windows: Windows on Arm)
//   node scripts/add-native-arch.mjs linux arm64    (x64 Linux: arm64 AppImage and deb)
//
// npm installs only the host's optional `@napi-rs/keyring-<platform>-<arch>`
// package. This downloads the exact tarball package-lock.json names, checks it
// against the lockfile's sha512, and unpacks it where npm would have put it.
// better-sqlite3 already ships every platform's prebuild. The afterPack check in
// electron-builder.config.ts still fails a build whose binary is missing.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [platform, arch] = process.argv.slice(2)
if (!platform || !arch) {
  console.error('Usage: node scripts/add-native-arch.mjs <darwin|win32|linux> <x64|arm64>')
  process.exit(1)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
const suffix = { darwin: '', win32: '-msvc', linux: '-gnu' }[platform]
if (suffix === undefined) {
  console.error(`Unknown platform "${platform}"`)
  process.exit(1)
}
const name = `@napi-rs/keyring-${platform}-${arch}${suffix}`
const key = `node_modules/${name}`
const entry = lock.packages?.[key]
if (!entry?.resolved || !entry.integrity) {
  console.error(`package-lock.json has no ${key} with a resolved URL and integrity`)
  process.exit(1)
}

const target = join(root, key)
if (existsSync(join(target, 'package.json'))) {
  console.log(`[add-native-arch] ${name} is already installed`)
  process.exit(0)
}

const response = await fetch(entry.resolved)
if (!response.ok) {
  console.error(`Download failed (${response.status}): ${entry.resolved}`)
  process.exit(1)
}
const tarball = Buffer.from(await response.arrayBuffer())
const [algo, expected] = entry.integrity.split('-')
const actual = createHash(algo).update(tarball).digest('base64')
if (actual !== expected) {
  console.error(`Integrity mismatch for ${name}: expected ${expected}, got ${actual}`)
  process.exit(1)
}

const temp = mkdtempSync(join(tmpdir(), 'citefox-native-'))
try {
  const file = join(temp, 'package.tgz')
  writeFileSync(file, tarball)
  mkdirSync(target, { recursive: true })
  // npm tarballs keep everything under package/.
  execFileSync('tar', ['-xzf', file, '-C', target, '--strip-components=1'], { stdio: 'inherit' })
} finally {
  rmSync(temp, { recursive: true, force: true })
}
console.log(`[add-native-arch] added ${name}@${entry.version}`)
