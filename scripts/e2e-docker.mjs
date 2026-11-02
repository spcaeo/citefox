#!/usr/bin/env node
/**
 * Runs the full Electron/Playwright e2e suite inside Docker, so no app
 * windows open on your screen.
 *
 *   npm run test:e2e:docker                                # full suite
 *   npm run test:e2e:docker -- tests/e2e/shell.spec.ts     # some specs
 *   npm run test:e2e:docker -- --rebuild                   # rebuild the image first
 *
 * What it does:
 * 1. Builds docker/e2e.Dockerfile as citefox-e2e:node<major.minor of .nvmrc>,
 *    or reuses that image when the Dockerfile and .nvmrc have not changed.
 * 2. Starts a throwaway container with two named cache volumes
 *    (citefox-e2e-npm for ~/.npm, citefox-e2e-cache for Electron and
 *    Playwright browsers), so reruns skip most downloads.
 * 3. Copies the working tree in: tracked files plus untracked files git does
 *    not ignore. node_modules, out, release, test-results, .env files and
 *    .claude folders are never copied.
 * 4. Runs npm ci, installs Playwright's Chromium, then the suite under xvfb
 *    with gnome-keyring on a private D-Bus session (as CI does on Linux).
 * 5. Copies test-results/ (traces, screenshots, error context) back to the
 *    host, prints the Playwright summary, removes the container, and exits
 *    with the suite's exit code. The image and volumes stay for the next run.
 *
 * With spec filters, the headless --check-due vitest step is skipped and the
 * arguments go straight to Playwright (through scripts/run-e2e.mjs).
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dockerfile = join(root, 'docker', 'e2e.Dockerfile')
const nodeVersion = readFileSync(join(root, '.nvmrc'), 'utf8').trim().replace(/^v/, '')
const image = `citefox-e2e:node${nodeVersion.split('.').slice(0, 2).join('.')}`
const volumes = {
  'citefox-e2e-npm': '/home/citefox/.npm',
  'citefox-e2e-cache': '/home/citefox/.cache'
}
const appDir = '/home/citefox/app'
const container = `citefox-e2e-${process.pid}-${Date.now().toString(36)}`
const label = 'org.citefox.e2e'

const args = process.argv.slice(2)
const rebuild = args.includes('--rebuild')
const filters = args.filter((arg) => arg !== '--rebuild')

let containerStarted = false

function log(message) {
  console.log(`\n[e2e-docker] ${message}`)
}

function fail(message, code = 1) {
  console.error(`\n[e2e-docker] ${message}`)
  cleanup()
  process.exit(code)
}

function docker(dockerArgs, options = {}) {
  return spawnSync('docker', dockerArgs, { encoding: 'utf8', ...options })
}

function cleanup() {
  if (!containerStarted) return
  containerStarted = false
  docker(['rm', '-f', container], { stdio: 'ignore' })
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    console.error(`\n[e2e-docker] ${signal}: removing ${container}`)
    cleanup()
    process.exit(130)
  })
}

function seconds(since) {
  return `${((Date.now() - since) / 1000).toFixed(0)}s`
}

/** Runs a command in the container, streaming output; returns { code, tail }. */
function exec(script, scriptArgs = []) {
  return new Promise((resolve) => {
    const child = spawn(
      'docker',
      [
        'exec',
        '-w',
        appDir,
        container,
        'bash',
        '-euo',
        'pipefail',
        '-c',
        script,
        'bash',
        ...scriptArgs
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let tail = ''
    const keep = (chunk, stream) => {
      stream.write(chunk)
      tail = (tail + chunk.toString('utf8')).slice(-200_000)
    }
    child.stdout.on('data', (chunk) => keep(chunk, process.stdout))
    child.stderr.on('data', (chunk) => keep(chunk, process.stderr))
    child.on('error', (error) => resolve({ code: 1, tail: String(error) }))
    child.on('close', (code) => resolve({ code: code ?? 1, tail }))
  })
}

// --- 1. Docker and the image ------------------------------------------------

if (docker(['info'], { stdio: 'ignore' }).status !== 0) {
  fail('Docker is not running. Install or start Docker Desktop, then try again.')
}

const started = Date.now()
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
const upToDate = current.status === 0 && current.stdout.trim() === fingerprint

if (rebuild || !upToDate) {
  log(`Building ${image} (first run, or docker/e2e.Dockerfile changed)`)
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
  if (built.status !== 0) fail(`docker build failed for ${image}`)
} else {
  log(`Reusing ${image}`)
}

// --- 2. Container -----------------------------------------------------------

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
containerStarted = true

// --- 3. Copy the working tree in --------------------------------------------

const neverCopy = [
  /(^|\/)node_modules(\/|$)/,
  /^(out|release|dist|test-results|playwright-report|blob-report|coverage)(\/|$)/,
  /(^|\/)\.claude(\/|$)/,
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(?!example$)[^/]*$/,
  /(^|\/)\.DS_Store$/
]
const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024
})
if (listed.status !== 0) fail(`git ls-files failed (is this a git checkout?):\n${listed.stderr}`)
const files = [...new Set(listed.stdout.split('\0'))].filter((file) => {
  if (!file || neverCopy.some((pattern) => pattern.test(file))) return false
  try {
    lstatSync(join(root, file)) // tracked but deleted in the working tree
    return true
  } catch {
    return false
  }
})

log(`Copying ${files.length} files into ${container}`)
const copied = await new Promise((resolve) => {
  const tarArgs = ['-c', '-f', '-', '--null', '-T', '-']
  if (process.platform === 'darwin') tarArgs.unshift('--no-mac-metadata')
  const pack = spawn('tar', tarArgs, {
    cwd: root,
    env: { ...process.env, COPYFILE_DISABLE: '1' },
    stdio: ['pipe', 'pipe', 'inherit']
  })
  const unpack = spawn(
    'docker',
    [
      'exec',
      '-i',
      container,
      'tar',
      '-x',
      '-f',
      '-',
      '-C',
      appDir,
      '--no-same-owner',
      '--warning=no-unknown-keyword'
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] }
  )
  pack.stdout.pipe(unpack.stdin)
  pack.stdin.end(files.join('\0') + '\0')
  let packCode = null
  pack.on('close', (code) => (packCode = code))
  unpack.on('close', (code) => resolve(packCode === 0 && code === 0))
})
if (!copied) fail('Copying the working tree into the container failed')

// --- 4. Install and run -----------------------------------------------------

let since = Date.now()
log('npm ci')
const install = await exec('npm ci --no-audit --no-fund --loglevel=error')
if (install.code !== 0) fail(`npm ci failed (exit ${install.code})`, install.code)
log(`npm ci done in ${seconds(since)}`)

since = Date.now()
log('Installing Playwright Chromium (cached in the citefox-e2e-cache volume)')
const browsers = await exec('npx playwright install --only-shell chromium')
if (browsers.code !== 0) fail(`playwright install failed (exit ${browsers.code})`, browsers.code)
log(`Chromium ready in ${seconds(since)}`)

since = Date.now()
const suite = filters.length ? 'node scripts/run-e2e.mjs "$@"' : 'npm run test:e2e'
log(filters.length ? `Running Playwright: ${filters.join(' ')}` : 'Running npm run test:e2e')
const e2e = await exec(
  `dbus-run-session -- bash -euo pipefail -c '
    echo -n "" | gnome-keyring-daemon --unlock --components=secrets >/dev/null
    # Each Playwright worker starts its own Xvfb (tests/e2e/own-display.ts).
    CITEFOX_E2E_OWN_DISPLAY=1 xvfb-run -a -s "-screen 0 1920x1080x24" ${suite}
  ' bash "$@"`,
  filters
)
const e2eTime = seconds(since)

// --- 5. Results back to the host --------------------------------------------

const hostResults = join(root, 'test-results')
const inContainer = docker(['exec', container, 'test', '-d', `${appDir}/test-results`])
if (inContainer.status === 0) {
  rmSync(hostResults, { recursive: true, force: true })
  const back = docker(['cp', `${container}:${appDir}/test-results`, hostResults])
  if (back.status !== 0) console.error(`[e2e-docker] Could not copy test-results: ${back.stderr}`)
}
cleanup()

// The Playwright list reporter ends with lines such as "  3 failed",
// "    tests/e2e/x.spec.ts:10:1 › name", "  1 skipped", "  120 passed (12.0m)".
// eslint-disable-next-line no-control-regex
const lines = e2e.tail.replace(/\u001b\[[0-9;]*m/g, '').split('\n')
const countLine = /^\s*\d+ (passed|failed|flaky|skipped|did not run|interrupted)\b/
const summary = []
for (let i = lines.length - 1; i >= 0; i--) {
  const line = lines[i] ?? ''
  if (countLine.test(line) || /^\s{4}\S/.test(line) || line.trim() === '') summary.unshift(line)
  else break
}

log(`Summary (e2e ${e2eTime}, total ${seconds(started)})`)
if (summary.some((line) => countLine.test(line))) {
  console.log(summary.join('\n').replace(/^\n+|\s+$/g, ''))
} else {
  console.log('No Playwright summary found. See the output above.')
}
if (existsSync(hostResults)) console.log(`Results: ${hostResults}`)
console.log(`Exit code: ${e2e.code}`)
process.exit(e2e.code)
