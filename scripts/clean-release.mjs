// Runs after `npm run dist*`: keeps only this version's downloads (installers
// and the Mac zip) and the update files (latest*.yml, beta*.yml) in release/.
// Removes older versions, the unpacked app folders, blockmaps and
// electron-builder's debug files. CI calls electron-builder directly, so its
// uploads are not affected. Use `npm run pack` when you need the unpacked .app
// for fuse or signing checks. scripts/checksums.mjs runs next.
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const release = join(root, 'release')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const download = /\.(dmg|zip|exe|AppImage|deb)$/
const updateFile = /^(latest|beta|alpha)[\w-]*\.yml$/

let entries
try {
  entries = readdirSync(release)
} catch {
  process.exit(0)
}

const kept = []
for (const name of entries) {
  if ((download.test(name) && name.includes(`-${version}-`)) || updateFile.test(name)) {
    kept.push(name)
    continue
  }
  rmSync(join(release, name), { recursive: true, force: true })
}
console.log(`[clean-release] kept ${kept.length ? kept.join(', ') : 'nothing'}`)
