#!/usr/bin/env node
/**
 * The CiteFox product video (v2): media/demo.mp4 (1920×1080, H.264 + AAC, with
 * music), media/demo-silent.mp4 (for autoplay on the site), media/demo.gif (the
 * Summary and question scenes, 960 px), media/demo-poster.png and
 * media/social-clip.mp4 (1080×1080).
 *
 *   npm run media:video                       # record, compose, encode
 *   npm run media:video -- --rebuild          # rebuild the e2e image first
 *   npm run media:video -- --process <dir>    # only encode <dir>/film.mp4 again
 *
 * 1. Records the footage in Docker (scripts/media/container.mjs): tests/media/
 *    video.spec.ts drives the TextBolt demo project frame by frame at 2× and writes
 *    clips, stills and highlight boxes.
 * 2. Composes the video in the same container with Revideo (MIT; scripts/media/
 *    video): a laptop on a sepia ground, camera moves, spotlights, callout chips and
 *    karaoke captions on the beat grid in scripts/media/video/timeline.json.
 * 3. Encodes with ffmpeg (here when installed, else in the container) and mixes in
 *    media/demo-music.m4a, the original track from scripts/media/make-music.py.
 * 4. Removes the container and the temporary folder.
 *
 * The download URL on the end card is SITE_URL from scripts/site/config.mjs.
 */
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SITE_URL } from '../site/config.mjs'
import { appDir, docker, hasTool, log, openContainer, root } from './container.mjs'

const mediaDir = join(root, 'media')
const music = join(mediaDir, 'demo-music.m4a')
const timeline = JSON.parse(readFileSync(join(root, 'scripts/media/video/timeline.json'), 'utf8'))
const beat = 60 / timeline.bpm
const starts = {}
let total = 0
for (const scene of timeline.scenes) {
  starts[scene.id] = total
  total += scene.beats * beat
}
const MAX_MP4 = 20 * 1024 * 1024
const MAX_GIF = 8 * 1024 * 1024

const args = process.argv.slice(2)
const processIndex = args.indexOf('--process')
const processOnly = processIndex >= 0 ? args[processIndex + 1] : undefined
const box = openContainer({ name: 'citefox-video', rebuild: args.includes('--rebuild') })

if (!existsSync(music)) {
  box.fail(
    'media/demo-music.m4a is missing: run uv run --with numpy python scripts/media/make-music.py'
  )
}

async function record() {
  await box.start()
  log('Installing ffmpeg and unzip in the container (clips, and the headless browser)')
  if (
    (await box.exec(
      'apt-get update -qq && apt-get install -y -qq --no-install-recommends ffmpeg unzip >/dev/null',
      { user: 'root' }
    )) !== 0
  )
    box.fail('Installing ffmpeg in the container failed')

  log('Recording the footage (frame by frame at 2×)')
  const code = await box.playwright('tests/media/playwright.config.ts', 'video.spec.ts')
  if (code !== 0) box.fail(`The video spec failed (exit ${code}).`)

  log('Composing with Revideo')
  // Revideo looks for the clips' audio next to its output folder, so it renders inside the project.
  const film = `${appDir}/scripts/media/video/output`
  const composed = await box.exec(
    [
      'bash scripts/media/video/prepare.sh test-results/media-out/video',
      'npx puppeteer browsers install chrome-headless-shell >/dev/null',
      `cd scripts/media/video && node render.mjs output '${SITE_URL}'`
    ].join(' && ')
  )
  if (composed !== 0) box.fail('The Revideo render failed')
  const raw = mkdtempSync(join(tmpdir(), 'citefox-video-'))
  box.copyOut(`${film}/film.mp4`, join(raw, 'film.mp4'))
  return raw
}

/** Runs ffmpeg here, or in the container (with the folder copied over) when this computer has none. */
async function ffmpeg(raw, ffArgs) {
  if (hasTool('ffmpeg', ['-version'])) {
    const result = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...ffArgs], {
      cwd: raw,
      stdio: 'inherit'
    })
    if (result.status !== 0) box.fail('ffmpeg failed')
    return
  }
  if (!box.started) box.fail('ffmpeg is needed for --process.')
  const work = `${appDir}/test-results/encode`
  await box.exec(`mkdir -p ${work}`)
  for (const name of ['film.mp4', 'music.m4a']) {
    if (existsSync(join(raw, name)))
      docker(['cp', join(raw, name), `${box.container}:${work}/${name}`])
  }
  const quoted = ffArgs.map((arg) => `'${arg.replace(/'/g, `'\\''`)}'`).join(' ')
  if ((await box.exec(`cd ${work} && ffmpeg -y -loglevel error ${quoted}`)) !== 0)
    box.fail('ffmpeg failed in the container')
  const out = ffArgs[ffArgs.length - 1]
  box.copyOut(`${work}/${out}`, join(raw, out))
}

const size = (file) => statSync(file).size
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

async function encode(raw) {
  copyFileSync(music, join(raw, 'music.m4a'))
  log('demo.mp4: H.264 + AAC with the music')
  for (const crf of [20, 23, 26, 29]) {
    await ffmpeg(raw, [
      '-i',
      'film.mp4',
      '-i',
      'music.m4a',
      '-map',
      '0:v',
      '-map',
      '1:a',
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
      '160k',
      '-shortest',
      '-movflags',
      '+faststart',
      'out-demo.mp4'
    ])
    if (size(join(raw, 'out-demo.mp4')) <= MAX_MP4) break
  }
  log('demo-silent.mp4: the same picture, no sound')
  await ffmpeg(raw, [
    '-i',
    'out-demo.mp4',
    '-map',
    '0:v',
    '-c:v',
    'copy',
    '-an',
    '-movflags',
    '+faststart',
    'out-demo-silent.mp4'
  ])

  log('demo-poster.png: the Summary highlight')
  await ffmpeg(raw, [
    '-ss',
    (starts.summary + 4.9).toFixed(2),
    '-i',
    'film.mp4',
    '-frames:v',
    '1',
    'out-demo-poster.png'
  ])

  // The GIF: Summary's highlights, then the question page's "right page" moment.
  const a = [starts.summary + 1.9, starts.summary + 9.3]
  const b = [starts.question + 4.5, starts.question + 9.4]
  log(`demo.gif: ${(a[1] - a[0] + b[1] - b[0]).toFixed(1)} s, 960 px`)
  for (const fps of [12, 10, 8]) {
    await ffmpeg(raw, [
      '-i',
      'film.mp4',
      '-filter_complex',
      `[0:v]trim=${a[0]}:${a[1]},setpts=PTS-STARTPTS[a];[0:v]trim=${b[0]}:${b[1]},setpts=PTS-STARTPTS[b];` +
        `[a][b]concat=n=2:v=1[c];[c]fps=${fps},scale=960:-1:flags=lanczos,split[x][y];` +
        `[x]palettegen=max_colors=128:stats_mode=diff[p];[y][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
      '-loop',
      '0',
      'out-demo.gif'
    ])
    if (size(join(raw, 'out-demo.gif')) <= MAX_GIF) break
  }

  // Square social clip: Summary through Competitors, on the same sepia ground.
  const from = starts.summary
  const to = starts.fixes
  log(`social-clip.mp4: ${(to - from).toFixed(1)} s, 1080×1080`)
  await ffmpeg(raw, [
    '-ss',
    from.toFixed(2),
    '-t',
    (to - from).toFixed(2),
    '-i',
    'film.mp4',
    '-ss',
    from.toFixed(2),
    '-t',
    (to - from).toFixed(2),
    '-i',
    'music.m4a',
    '-filter_complex',
    '[0:v]crop=1700:1080:110:0,scale=1080:-2:flags=lanczos,pad=1080:1080:0:(oh-ih)/2:color=0xece2cd[v];' +
      `[1:a]afade=t=in:d=0.6,afade=t=out:st=${(to - from - 1.5).toFixed(2)}:d=1.5[a]`,
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '22',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    'out-social-clip.mp4'
  ])

  mkdirSync(mediaDir, { recursive: true })
  for (const name of [
    'demo.mp4',
    'demo-silent.mp4',
    'demo.gif',
    'demo-poster.png',
    'social-clip.mp4'
  ]) {
    copyFileSync(join(raw, `out-${name}`), join(mediaDir, name))
    console.log(`  media/${name}  ${mb(size(join(mediaDir, name)))}`)
  }
  if (size(join(mediaDir, 'demo.mp4')) > MAX_MP4) box.fail('demo.mp4 is over 20 MB')
  if (size(join(mediaDir, 'demo.gif')) > MAX_GIF) box.fail('demo.gif is over 8 MB')
}

if (processOnly) {
  await encode(processOnly)
} else {
  const raw = await record()
  try {
    await encode(raw)
  } finally {
    rmSync(raw, { recursive: true, force: true })
  }
}
box.cleanup()
log('Done: media/ is up to date. Look at the frames and listen before you commit.')
