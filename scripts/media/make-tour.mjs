#!/usr/bin/env node
/**
 * The welcome tour film: src/renderer/src/assets/intro/tour.mp4 (1280×720, 30 fps,
 * H.264 + AAC with our own music, about 45 s, under 6 MB), which the first-run player
 * (src/renderer/src/intro) plays once.
 *
 *   npm run media:tour                          # record, compose, music, encode
 *   npm run media:tour -- --rebuild             # rebuild the e2e image first
 *   npm run media:tour -- --record-only <dir>   # only record the footage into <dir>
 *   npm run media:tour -- --compose <dir>       # compose + encode from footage in <dir>
 *   npm run media:tour -- --encode <dir>        # only encode <dir>/film.mp4 again
 *   npm run media:tour -- --out <file>          # another output file
 *
 * 1. Records the footage in Docker (scripts/media/container.mjs): tests/media/
 *    tour.spec.ts drives the TextBolt demo project (sponsor cards hidden, nothing sent).
 * 2. Composes it in the same container with Revideo (scripts/media/video/src/tour.tsx),
 *    on the beat grid in scripts/media/video/tour.json, with the eight captions burned in.
 * 3. Makes the music with scripts/media/make-tour-music.py (numpy only, A major, 96 BPM)
 *    and encodes with ffmpeg.
 * 4. Removes the container and the temporary folder.
 *
 * Only Docker opens the app and its windows: never run the recording spec on the Mac.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { appDir, hasTool, log, openContainer, root } from './container.mjs'

const MAX_BYTES = 6 * 1024 * 1024
const args = process.argv.slice(2)
const flag = (name) => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}
const recordOnly = flag('--record-only')
const composeFrom = flag('--compose')
const encodeFrom = flag('--encode')
const outFile = resolve(root, flag('--out') ?? 'src/renderer/src/assets/intro/tour.mp4')
const box = openContainer({ name: 'citefox-tour', rebuild: args.includes('--rebuild') })

const size = (file) => statSync(file).size
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`

async function installFfmpeg() {
  log('Installing ffmpeg and unzip in the container')
  if (
    (await box.exec(
      'apt-get update -qq && apt-get install -y -qq --no-install-recommends ffmpeg unzip >/dev/null',
      { user: 'root' }
    )) !== 0
  )
    box.fail('Installing ffmpeg in the container failed')
}

/** Records the footage in the container and copies it into `into`. */
async function record(into) {
  await box.start()
  await installFfmpeg()
  log('Recording the tour footage (frame by frame at 2×)')
  const code = await box.playwright('tests/media/playwright.config.ts', 'tour.spec.ts')
  if (code !== 0) box.fail(`The tour spec failed (exit ${code}).`)
  rmSync(into, { recursive: true, force: true })
  mkdirSync(dirname(into), { recursive: true })
  box.copyOut(`${appDir}/test-results/media-out/tour`, into)
}

/** Composes the film from the footage in `from`; returns a folder with film.mp4. */
async function compose(from) {
  await box.start({ build: false })
  await installFfmpeg()
  const dest = `${appDir}/test-results/media-out/tour`
  await box.exec(`mkdir -p ${dest}`)
  box.copyIn(`${from}/.`, dest)
  log('Composing with Revideo')
  const film = `${appDir}/scripts/media/video/output`
  const composed = await box.exec(
    [
      'bash scripts/media/video/prepare.sh test-results/media-out/tour',
      'npx puppeteer browsers install chrome-headless-shell >/dev/null',
      // Revideo can hang after it has written the picture (output/film-0.mp4, one worker): it is
      // given 8 minutes, and the finished picture is used when it does not tidy up by itself.
      "cd scripts/media/video && (timeout 480 node render.mjs output 'https://example.invalid/' ./src/tour-project.ts || true)",
      `[ -f ${film}/film.mp4 ] || cp ${film}/film-0.mp4 ${film}/film.mp4`
    ].join(' && ')
  )
  if (composed !== 0) box.fail('The Revideo render failed')
  const raw = mkdtempSync(join(tmpdir(), 'citefox-tour-'))
  box.copyOut(`${film}/film.mp4`, join(raw, 'film.mp4'))
  return raw
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { stdio: 'inherit', ...options })
  if (result.status !== 0) box.fail(`${command} failed`)
}

/** Our own track (numpy synthesis), as an AAC file in `raw`. */
function music(raw) {
  log('Making the music (A major, 96 BPM)')
  const target = join(raw, 'music.m4a')
  const script = join(root, 'scripts/media/make-tour-music.py')
  if (hasTool('uv', ['--version'])) run('uv', ['run', '--with', 'numpy', 'python', script, target])
  else run('python3', [script, target])
  return target
}

function encode(raw) {
  const audio = existsSync(join(raw, 'music.m4a')) ? join(raw, 'music.m4a') : music(raw)
  mkdirSync(dirname(outFile), { recursive: true })
  let kept = false
  for (const crf of [24, 26, 28, 30, 32, 34]) {
    log(`tour.mp4: 1280×720, crf ${crf}`)
    run('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      join(raw, 'film.mp4'),
      '-i',
      audio,
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-vf',
      'scale=1280:720:flags=lanczos',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      String(crf),
      '-profile:v',
      'high',
      '-pix_fmt',
      'yuv420p',
      '-r',
      '30',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-ar',
      '48000',
      '-t',
      '45',
      '-movflags',
      '+faststart',
      outFile
    ])
    if (size(outFile) < MAX_BYTES - 256 * 1024) {
      kept = true
      break
    }
  }
  if (!kept) box.fail('tour.mp4 would be over 6 MB even at the lowest quality')
  console.log(`  ${outFile}  ${mb(size(outFile))}`)
}

if (!hasTool('ffmpeg', ['-version'])) box.fail('ffmpeg is needed on this computer to encode.')
if (recordOnly) {
  await record(resolve(recordOnly))
} else if (encodeFrom) {
  encode(resolve(encodeFrom))
} else {
  const footage = composeFrom ? resolve(composeFrom) : undefined
  let from = footage
  let temp
  if (!from) {
    temp = mkdtempSync(join(tmpdir(), 'citefox-tour-footage-'))
    from = join(temp, 'tour')
    await record(from)
    box.cleanup()
  }
  const raw = await compose(from)
  try {
    encode(raw)
  } finally {
    rmSync(raw, { recursive: true, force: true })
    if (temp) rmSync(temp, { recursive: true, force: true })
  }
}
box.cleanup()
if (existsSync(outFile) && !recordOnly) {
  const bytes = readFileSync(outFile).length
  if (bytes >= MAX_BYTES) box.fail('tour.mp4 is over 6 MB')
}
log('Done. Look at frames and listen before you commit.')
