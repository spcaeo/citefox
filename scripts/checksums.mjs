/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JavaScript, no type annotations */
// Writes SHA256SUMS.txt next to the downloads in a folder (default: release/).
// The format is `sha256sum`'s, so `shasum -a 256 -c SHA256SUMS.txt` (Mac,
// Linux) checks every file. Update files (latest*.yml) and blockmaps are left
// out: people download the installers, not those.
//
//   node scripts/checksums.mjs            # release/
//   node scripts/checksums.mjs dist       # the release workflow's merged folder
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const DOWNLOAD = /\.(dmg|zip|exe|AppImage|deb)$/

function sha256(file) {
  return new Promise((done, fail) => {
    const hash = createHash('sha256')
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => done(hash.digest('hex')))
      .on('error', fail)
  })
}

const dir = resolve(process.argv[2] ?? 'release')
if (!existsSync(dir)) {
  console.log(`[checksums] no ${dir}, nothing to do`)
  process.exit(0)
}
const files = readdirSync(dir)
  .filter((name) => DOWNLOAD.test(name) && statSync(join(dir, name)).isFile())
  .sort()
const lines = []
for (const name of files) lines.push(`${await sha256(join(dir, name))}  ${name}`)
writeFileSync(join(dir, 'SHA256SUMS.txt'), lines.length ? `${lines.join('\n')}\n` : '')
console.log(`[checksums] SHA256SUMS.txt lists ${files.length} file(s)`)
