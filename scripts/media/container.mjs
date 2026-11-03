/**
 * The throwaway Docker container the media scripts record in (record-demo.mjs for
 * the screenshots, make-video.mjs for the product video). It uses the e2e image
 * (docker/e2e.Dockerfile, the same as `npm run test:e2e:docker`), copies the
 * working tree in, runs npm ci and the app build, and is removed afterwards. The
 * image and the npm/cache volumes stay for the next run.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const appDir = '/home/citefox/app'
const dockerfile = join(root, 'docker', 'e2e.Dockerfile')
const nodeVersion = readFileSync(join(root, '.nvmrc'), 'utf8').trim().replace(/^v/, '')
const image = `citefox-e2e:node${nodeVersion.split('.').slice(0, 2).join('.')}`
const label = 'org.citefox.e2e'
const volumes = {
  'citefox-e2e-npm': '/home/citefox/.npm',
  'citefox-e2e-cache': '/home/citefox/.cache'
}

export function log(message) {
  console.log(`\n[media] ${message}`)
}

export function docker(dockerArgs, options = {}) {
  return spawnSync('docker', dockerArgs, { encoding: 'utf8', ...options })
}

export function hasTool(command, probe) {
  return spawnSync(command, probe, { stdio: 'ignore' }).status === 0
}

/**
 * Starts the container and returns helpers. `fail(message)` removes it and exits.
 * @param {{ name: string, rebuild?: boolean }} options
 */
export function openContainer({ name, rebuild = false }) {
  const container = `${name}-${process.pid}-${Date.now().toString(36)}`
  let started = false

  function cleanup() {
    if (!started) return
    started = false
    spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' })
  }

  function fail(message) {
    console.error(`\n[media] ${message}`)
    cleanup()
    process.exit(1)
  }

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      cleanup()
      process.exit(130)
    })
  }

  /** Runs a bash script in the app folder; resolves with its exit code. */
  function exec(script, { user, env = {} } = {}) {
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
          '-e',
          'DISABLE_TELEMETRY=true',
          ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
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

  /** `build: false` skips npm ci and the app build (composing a film needs only the Revideo packages). */
  async function start({ build = true } = {}) {
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
    for (const volume of Object.keys(volumes)) {
      if (docker(['volume', 'inspect', volume], { stdio: 'ignore' }).status !== 0) {
        docker(['volume', 'create', '--label', `${label}=1`, volume], { stdio: 'ignore' })
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
      ...Object.entries(volumes).flatMap(([volume, path]) => ['-v', `${volume}:${path}`]),
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

    log(build ? 'npm ci and build' : 'npm ci')
    const install = 'npm ci --no-audit --no-fund --loglevel=error'
    if ((await exec(build ? `${install} && npx electron-vite build` : install)) !== 0)
      fail('npm ci or the build failed')
  }

  /** Runs a Playwright config under Xvfb with a private keyring, as the e2e suite does. */
  function playwright(config, extra = '') {
    return exec(`dbus-run-session -- bash -euo pipefail -c '
      echo -n "" | gnome-keyring-daemon --unlock --components=secrets >/dev/null
      xvfb-run -a -s "-screen 0 1920x1080x24" npx playwright test -c ${config} ${extra}
    '`)
  }

  /** Copies a folder into the container (it lands as `to`, under the app folder's tree). */
  function copyIn(from, to) {
    const back = docker(['cp', from, `${container}:${to}`])
    if (back.status !== 0) fail(`Could not copy ${from} in: ${back.stderr}`)
  }

  /** Copies a folder out of the container. */
  function copyOut(from, to) {
    const back = docker(['cp', `${container}:${from}`, to])
    if (back.status !== 0) fail(`Could not copy ${from}: ${back.stderr}`)
  }

  return {
    container,
    start,
    exec,
    playwright,
    copyOut,
    copyIn,
    fail,
    cleanup,
    get started() {
      return started
    }
  }
}
