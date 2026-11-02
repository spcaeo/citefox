#!/usr/bin/env node
/**
 * Refreshes the marketing media in media/ (README and download site):
 * hero.png, summary.png, question.png, reports-home.png, report-visibility.png,
 * competitors.png, fixes.png, demo.mp4 and demo.gif.
 *
 *   npm run media:record                      # record in Docker, then encode
 *   npm run media:record -- --rebuild         # rebuild the e2e image first
 *   npm run media:record -- --process <dir>   # only encode an earlier raw run
 *
 * 1. Runs tests/media/demo.spec.ts inside the e2e Docker image
 *    (docker/e2e.Dockerfile, the same image as `npm run test:e2e:docker`), so no
 *    window opens on your screen. The spec seeds the TextBolt demo project
 *    (tests/e2e/reports-seed.ts plus the TextBolt topic), opens the app at
 *    1440×900 in Sepia, takes 2× screenshots and records a screencast tour.
 * 2. Copies the raw output back to a temporary folder.
 * 3. Encodes: PNGs resized to 2400 px wide and compressed; frames to an H.264
 *    demo.mp4 (≤10 MB); a 960 px demo.gif of the Reports drill (≤8 MB).
 *    Uses ffmpeg and ImageMagick on this computer when both are installed,
 *    otherwise installs them inside the throwaway container and encodes there.
 * 4. Removes the container and the temporary folder. The image and the cache
 *    volumes stay for the next run, as with test:e2e:docker.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const mediaDir = join(root, 'media')
const dockerfile = join(root, 'docker', 'e2e.Dockerfile')
const nodeVersion = readFileSync(join(root, '.nvmrc'), 'utf8').trim().replace(/^v/, '')
const image = `citefox-e2e:node${nodeVersion.split('.').slice(0, 2).join('.')}`
const label = 'org.citefox.e2e'
const appDir = '/home/citefox/app'
const container = `citefox-media-${process.pid}-${Date.now().toString(36)}`
const volumes = {
  'citefox-e2e-npm': '/home/citefox/.npm',
  'citefox-e2e-cache': '/home/citefox/.cache'
}
const SHOTS = [
  'hero',
  'summary',
  'question',
  'reports-home',
  'report-visibility',
  'competitors',
  'fixes'
]
const MAX_MP4 = 10 * 1024 * 1024
const MAX_GIF = 8 * 1024 * 1024

const args = process.argv.slice(2)
const processIndex = args.indexOf('--process')
const processOnly = processIndex >= 0 ? args[processIndex + 1] : undefined
const rebuild = args.includes('--rebuild')
let started = false

function log(message) {
  console.log(`\n[media] ${message}`)
}

function fail(message) {
  console.error(`\n[media] ${message}`)
  cleanup()
  process.exit(1)
}

function cleanup() {
  if (!started) return
  started = false
  spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' })
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    cleanup()
    process.exit(130)
  })
}

function docker(dockerArgs, options = {}) {
  return spawnSync('docker', dockerArgs, { encoding: 'utf8', ...options })
}

function exec(script, { user } = {}) {
  return new Promise((resolve) => {
    const child = spawn(
      'docker',
      [
        'exec',
        ...(user ? ['-u', user] : []),
        '-w',
        appDir,
        '-e',
        'CITEFOX_MEDIA_DOCKER=1',
        '-e',
        `CITEFOX_MEDIA_OUT=${appDir}/test-results/media-out`,
        container,
        'bash',
        '-euo',
        'pipefail',
        '-c',
        script
      ],
      { stdio: 'inherit' }
    )
    child.on('close', (code) => resolve(code ?? 1))
  })
}

function hasTool(command, probe) {
  return spawnSync(command, probe, { stdio: 'ignore' }).status === 0
}

// --- Record in Docker -----------------------------------------------------------

async function record() {
  if (docker(['info'], { stdio: 'ignore' }).status !== 0) fail('Docker is not running.')
  const fingerprint = createHash('sha256')
    .update(readFileSync(dockerfile))
    .update(nodeVersion)
    .digest('hex')
    .slice(0, 16)
  const current = docker([
    'image',
    'inspect',
    '--format',
    `{{ index .Config.Labels "${label}.fingerprint" }}`,
    image
  ])
  if (rebuild || current.status !== 0 || current.stdout.trim() !== fingerprint) {
    log(`Building ${image}`)
    const built = docker(
      [
        'build',
        '--build-arg',
        `NODE_VERSION=${nodeVersion}`,
        '--label',
        `${label}=1`,
        '--label',
        `${label}.fingerprint=${fingerprint}`,
        '-t',
        image,
        '-f',
        dockerfile,
        join(root, 'docker')
      ],
      { stdio: 'inherit' }
    )
    if (built.status !== 0) fail('docker build failed')
  }
  for (const name of Object.keys(volumes)) {
    if (docker(['volume', 'inspect', name], { stdio: 'ignore' }).status !== 0) {
      docker(['volume', 'create', '--label', `${label}=1`, name], { stdio: 'ignore' })
    }
  }
  const run = docker([
    'run',
    '--detach',
    '--init',
    '--rm',
    '--name',
    container,
    '--label',
    `${label}=1`,
    '--security-opt',
    'seccomp=unconfined',
    '--shm-size',
    '2g',
    ...Object.entries(volumes).flatMap(([name, path]) => ['-v', `${name}:${path}`]),
    image,
    'sleep',
    'infinity'
  ])
  if (run.status !== 0) fail(`docker run failed:\n${run.stderr}`)
  started = true

  // The working tree, as test:e2e:docker copies it (tracked + untracked, not ignored).
  const listed = spawnSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    }
  )
  if (listed.status !== 0) fail('git ls-files failed')
  const skip = [
    /(^|\/)node_modules(\/|$)/,
    /^(out|release|dist|test-results|media)(\/|$)/,
    /(^|\/)\.claude(\/|$)/,
    /(^|\/)\.env(\.|$)/
  ]
  const files = [...new Set(listed.stdout.split('\0'))].filter(
    (file) => file && !skip.some((pattern) => pattern.test(file)) && existsSync(join(root, file))
  )
  log(`Copying ${files.length} files into ${container}`)
  const copied = await new Promise((resolve) => {
    const pack = spawn('tar', ['-c', '-f', '-', '--null', '-T', '-'], {
      cwd: root,
      env: { ...process.env, COPYFILE_DISABLE: '1' },
      stdio: ['pipe', 'pipe', 'inherit']
    })
    const unpack = spawn(
      'docker',
      ['exec', '-i', container, 'tar', '-x', '-f', '-', '-C', appDir, '--no-same-owner'],
      { stdio: ['pipe', 'inherit', 'inherit'] }
    )
    pack.stdout.pipe(unpack.stdin)
    pack.stdin.end(files.join('\0') + '\0')
    unpack.on('close', (code) => resolve(code === 0))
  })
  if (!copied) fail('Copying the working tree failed')

  log('npm ci and build')
  if ((await exec('npm ci --no-audit --no-fund --loglevel=error && npx electron-vite build')) !== 0)
    fail('npm ci or the build failed')

  log('Recording (screenshots, then the demo tour)')
  const code = await exec(`dbus-run-session -- bash -euo pipefail -c '
    echo -n "" | gnome-keyring-daemon --unlock --components=secrets >/dev/null
    xvfb-run -a -s "-screen 0 1920x1080x24" npx playwright test -c tests/media/playwright.config.ts
  '`)
  if (code !== 0)
    fail(`The media spec failed (exit ${code}). See test-results/media in the container log above.`)

  const raw = mkdtempSync(join(tmpdir(), 'citefox-media-raw-'))
  const back = docker(['cp', `${container}:${appDir}/test-results/media-out/.`, raw])
  if (back.status !== 0) fail(`Could not copy the raw output: ${back.stderr}`)
  return raw
}

// --- Encode -----------------------------------------------------------------------

/** Runs ffmpeg/magick here, or in the container when this computer has neither. */
function makeRunner(raw) {
  const local = hasTool('ffmpeg', ['-version']) && hasTool('magick', ['-version'])
  if (local) {
    return {
      dir: raw,
      run: (command, commandArgs) => {
        const result = spawnSync(command, commandArgs, {
          cwd: raw,
          stdio: ['ignore', 'ignore', 'inherit']
        })
        if (result.status !== 0) fail(`${command} failed`)
      },
      ready: () => Promise.resolve()
    }
  }
  if (!started)
    fail('ffmpeg and ImageMagick are needed for --process (or run a full npm run media:record).')
  const work = `${appDir}/test-results/media-out`
  return {
    dir: raw,
    async ready() {
      log('Installing ffmpeg and ImageMagick in the container')
      const code = await exec(
        'apt-get update -qq && apt-get install -y -qq --no-install-recommends ffmpeg imagemagick >/dev/null',
        { user: 'root' }
      )
      if (code !== 0) fail('Installing ffmpeg in the container failed')
    },
    run: (command, commandArgs) => {
      const tool = command === 'magick' ? 'convert' : command
      const result = spawnSync('docker', ['exec', '-w', work, container, tool, ...commandArgs], {
        stdio: ['ignore', 'ignore', 'inherit']
      })
      if (result.status !== 0) fail(`${command} failed in the container`)
      // Results are copied back after each step.
      for (const name of commandArgs.filter((arg) => /^out-/.test(arg))) {
        docker(['cp', `${container}:${work}/${name}`, join(raw, name)])
      }
    }
  }
}

async function encode(raw) {
  const runner = makeRunner(raw)
  await runner.ready()
  mkdirSync(mediaDir, { recursive: true })

  log('Screenshots: 2400 px wide, compressed')
  for (const name of SHOTS) {
    if (!existsSync(join(raw, 'shots', `${name}.png`))) fail(`Missing shot ${name}.png`)
    runner.run('magick', [
      `shots/${name}.png`,
      '-resize',
      '2400x',
      '-strip',
      '-colors',
      '256',
      '-define',
      'png:compression-level=9',
      `out-${name}.png`
    ])
  }

  log('Video: frames to H.264')
  const frames = JSON.parse(readFileSync(join(raw, 'frames.json'), 'utf8'))
  const marks = JSON.parse(readFileSync(join(raw, 'marks.json'), 'utf8'))
  if (frames.length < 2) fail('The screencast has no frames')
  const end = marks.end ?? frames[frames.length - 1].at + 1
  const lines = ['ffconcat version 1.0']
  frames.forEach((frame, index) => {
    const next = index + 1 < frames.length ? frames[index + 1].at : end
    lines.push(
      `file 'frames/${frame.file}'`,
      `duration ${Math.max(0.001, next - frame.at).toFixed(3)}`
    )
  })
  // The concat demuxer needs the last file again to honour its duration.
  lines.push(`file 'frames/${frames[frames.length - 1].file}'`)
  writeFileSync(join(raw, 'frames.ffconcat'), lines.join('\n') + '\n')
  if (runner.dir === raw && !hasTool('ffmpeg', ['-version'])) {
    docker(['cp', join(raw, 'frames.ffconcat'), `${container}:${appDir}/test-results/media-out/`])
  }
  const start = frames[0].at
  for (const crf of [20, 24, 28]) {
    runner.run('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      'frames.ffconcat',
      '-vf',
      'fps=30,scale=1440:-2:flags=lanczos,format=yuv420p',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      String(crf),
      '-movflags',
      '+faststart',
      '-an',
      'out-demo.mp4'
    ])
    if (statSync(join(raw, 'out-demo.mp4')).size <= MAX_MP4) break
  }

  log('GIF: the Reports drill, 960 px')
  const from = Math.max(0, (marks.visibility ?? marks.reports ?? start) - start)
  const length = Math.min(14, Math.max(10, (marks.home ?? from + start + 12) - start - from + 0.6))
  for (const fps of [12, 10, 8]) {
    runner.run('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-ss',
      from.toFixed(2),
      '-t',
      length.toFixed(2),
      '-i',
      'out-demo.mp4',
      '-vf',
      `fps=${fps},scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
      '-loop',
      '0',
      'out-demo.gif'
    ])
    if (statSync(join(raw, 'out-demo.gif')).size <= MAX_GIF) break
  }

  for (const name of [...SHOTS.map((shot) => `${shot}.png`), 'demo.mp4', 'demo.gif']) {
    copyFileSync(join(raw, `out-${name}`), join(mediaDir, name))
    const size = statSync(join(mediaDir, name)).size
    console.log(`  media/${name}  ${(size / 1024).toFixed(0)} KB`)
  }
  if (statSync(join(mediaDir, 'demo.mp4')).size > MAX_MP4) fail('demo.mp4 is over 10 MB')
  if (statSync(join(mediaDir, 'demo.gif')).size > MAX_GIF) fail('demo.gif is over 8 MB')
}

// --- Main -------------------------------------------------------------------------

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
cleanup()
log('Done: media/ is up to date. Look at each file before you commit it.')
