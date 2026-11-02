#!/usr/bin/env node
/**
 * The browser demo's Docker steps (Docs/DEMO.md). A headless window opens only
 * inside the e2e image (docker/e2e.Dockerfile, the same as test:e2e:docker),
 * never on this computer.
 *
 *   node scripts/demo/docker.mjs record   # npm run demo:record
 *     Seeds the demo project, builds the recording demo, walks every screen and
 *     writes src/renderer/demo/snapshot.json back here.
 *   node scripts/demo/docker.mjs check [--shots <dir>] [--thumbs]   # npm run demo:check
 *     Builds the demo and the sample reports in the container, opens each main
 *     screen and each sample report, fails on console errors or empty screens,
 *     and copies the screenshots to <dir> (default test-results/demo-shots).
 *   node scripts/demo/docker.mjs run "<bash>"   # any command in the container (debugging)
 *
 * The container is removed afterwards; the image and cache volumes stay.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dockerfile = join(root, 'docker', 'e2e.Dockerfile')
const nodeVersion = readFileSync(join(root, '.nvmrc'), 'utf8').trim().replace(/^v/, '')
const image = `citefox-e2e:node${nodeVersion.split('.').slice(0, 2).join('.')}`
const label = 'org.citefox.e2e'
const appDir = '/home/citefox/app'
const container = `citefox-demo-${process.pid}-${Date.now().toString(36)}`
const volumes = {
  'citefox-e2e-npm': '/home/citefox/.npm',
  'citefox-e2e-cache': '/home/citefox/.cache'
}

const args = process.argv.slice(2)
const mode = args[0]
const shotsIndex = args.indexOf('--shots')
const shotsDir = resolve(
  shotsIndex >= 0 ? args[shotsIndex + 1] : join(root, 'test-results', 'demo-shots')
)
if (mode !== 'record' && mode !== 'check' && mode !== 'run') {
  console.error('Usage: node scripts/demo/docker.mjs record | check [--shots <dir>] | run "<bash>"')
  process.exit(2)
}
let started = false

function log(message) {
  console.log(`\n[demo] ${message}`)
}

function cleanup() {
  if (!started) return
  started = false
  spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' })
}

function fail(message) {
  console.error(`\n[demo] ${message}`)
  cleanup()
  process.exit(1)
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

function exec(script) {
  return new Promise((done) => {
    const child = spawn(
      'docker',
      [
        'exec',
        '-w',
        appDir,
        '-e',
        'CITEFOX_DEMO_DOCKER=1',
        '-e',
        'TZ=America/Toronto',
        container,
        'bash',
        '-euo',
        'pipefail',
        '-c',
        script
      ],
      { stdio: 'inherit' }
    )
    child.on('close', (code) => done(code ?? 1))
  })
}

async function start() {
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
  if (current.status !== 0 || current.stdout.trim() !== fingerprint) {
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
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
  if (listed.status !== 0) fail('git ls-files failed')
  const skip = [
    /(^|\/)node_modules(\/|$)/,
    /^(out|release|dist|test-results)(\/|$)/,
    /(^|\/)\.claude(\/|$)/,
    /(^|\/)\.env(\.|$)/
  ]
  const files = [...new Set(listed.stdout.split('\0'))].filter(
    (file) => file && !skip.some((pattern) => pattern.test(file)) && existsSync(join(root, file))
  )
  log(`Copying ${files.length} files into ${container}`)
  const copied = await new Promise((done) => {
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
    unpack.on('close', (code) => done(code === 0))
  })
  if (!copied) fail('Copying the working tree failed')
  log('npm ci')
  if ((await exec('npm ci --no-audit --no-fund --loglevel=error')) !== 0) fail('npm ci failed')
}

const VITEST = 'npx vitest run -c vitest.demo.config.mts'
const XVFB = 'xvfb-run -a -s "-screen 0 1920x1080x24"'

try {
  await start()
  if (mode === 'run') {
    const code = await exec(args[1].replaceAll('$XVFB', XVFB))
    if (code !== 0) fail(`exit ${code}`)
  } else if (mode === 'record') {
    log('Recording build, then the tour')
    const code = await exec(
      `DEMO_OUT=out/demo-record VITE_CITEFOX_DEMO_RECORD=1 npx vite build -c vite.demo.config.ts --logLevel warn
       ${XVFB} ${VITEST} tests/demo/record.e2e.ts`
    )
    if (code !== 0) fail(`Recording failed (exit ${code}); the snapshot was not changed.`)
    const back = docker([
      'cp',
      `${container}:${appDir}/src/renderer/demo/snapshot.json`,
      join(root, 'src/renderer/demo/snapshot.json')
    ])
    if (back.status !== 0) fail(`Could not copy the snapshot back: ${back.stderr}`)
    log('Wrote src/renderer/demo/snapshot.json')
  } else {
    log('Demo and sample builds, then the check')
    const code = await exec(
      `npx vite build -c vite.demo.config.ts --logLevel warn
       ${VITEST} tests/demo/samples.e2e.ts
       node scripts/site/build-site.mjs
       CITEFOX_DEMO_SHOTS=test-results/demo-shots ${XVFB} ${VITEST} tests/demo/check.e2e.ts`
    )
    mkdirSync(shotsDir, { recursive: true })
    docker(['cp', `${container}:${appDir}/test-results/demo-shots/.`, shotsDir])
    log(`Screenshots in ${shotsDir}`)
    if (args.includes('--thumbs') && existsSync(join(shotsDir, 'thumbs'))) {
      mkdirSync(join(root, 'media', 'samples'), { recursive: true })
      for (const name of readdirSync(join(shotsDir, 'thumbs'))) {
        copyFileSync(join(shotsDir, 'thumbs', name), join(root, 'media', 'samples', name))
      }
      log('Copied the sample thumbnails to media/samples/')
    }
    if (code !== 0) fail(`The demo check failed (exit ${code})`)
  }
} finally {
  cleanup()
}
