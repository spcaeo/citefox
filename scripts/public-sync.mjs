#!/usr/bin/env node
// Copies a clean snapshot of this private repo into the public repo kept at
// .public-export/ (its own git repo, git-ignored here) and commits it there as
// one commit. No private history is copied. Never pushes. Docs/PUBLISHING.md.
//
//   npm run public:sync                       export HEAD, check, commit
//   npm run public:sync -- --dry-run          list what would change, write nothing
//   npm run public:sync -- --ref <commit>     export another commit
//   npm run public:sync -- --builtin-scan     allow the built-in scan when gitleaks is missing
//
// Checks before the commit (any failure stops it, nothing is committed):
//   gitleaks on the export (.gitleaks.toml) plus the built-in pattern scan,
//   LICENSE, NOTICE and TRADEMARKS.md are there, nothing calls CiteFox Apache-2.0.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { findGitleaks } from './lib/gitleaks.mjs'
import {
  commitMessage,
  lastSyncedCommit,
  licenseProblems,
  normaliseConfig,
  parseLsTree,
  planChanges,
  publicSubjects,
  selectFiles
} from './lib/public-sync-core.mjs'
import { scanText } from './lib/secret-scan.mjs'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const option = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

function git(args, opts = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...opts
  })
}

function gitOk(args, opts = {}) {
  return (
    spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts })
      .status === 0
  )
}

function fail(message) {
  console.error(`\npublic:sync stopped: ${message}`)
  process.exit(1)
}

function printList(label, paths, limit) {
  if (paths.length === 0) return
  console.log(`\n${label} (${paths.length}):`)
  for (const p of paths.slice(0, limit)) console.log(`  ${p}`)
  if (paths.length > limit)
    console.log(`  …and ${paths.length - limit} more (use --dry-run --all to see every path)`)
}

const BINARY = /\.(png|jpe?g|gif|webp|ico|icns|ttf|otf|woff2?|wav|mp3|mp4|gz|zip|dmg|pdf)$/i

function readExport(target, paths) {
  return paths.map((path) => {
    if (BINARY.test(path)) return { path, text: null }
    const buf = readFileSync(join(target, path))
    return { path, text: buf.includes(0) ? null : buf.toString('utf8') }
  })
}

function scanExport(target, files, allowBuiltinOnly) {
  const problems = []
  for (const { path, text } of files) {
    if (text === null) continue
    for (const f of scanText(text)) problems.push(`${path}:${f.line}  ${f.rule}  ${f.preview}`)
  }
  const bin = findGitleaks()
  if (bin) {
    const config = existsSync(join(target, '.gitleaks.toml'))
      ? ['--config', join(target, '.gitleaks.toml')]
      : []
    const result = spawnSync(
      bin,
      [
        'detect',
        '--no-git',
        '--source',
        target,
        '--redact',
        '--no-banner',
        '--log-level',
        'warn',
        ...config
      ],
      { stdio: 'inherit' }
    )
    if (result.status !== 0)
      problems.push('gitleaks found secrets in the export (listed above, redacted)')
  } else if (!allowBuiltinOnly) {
    problems.push(
      'gitleaks is not installed. Install it (Arch: pacman -S gitleaks, Mac: brew install gitleaks) or set GITLEAKS_BIN; ' +
        'to rely on the built-in scan only, rerun with --builtin-scan'
    )
  } else {
    console.log('gitleaks not found: used the built-in scan only (--builtin-scan).')
  }
  return problems
}

function clearWorkTree(target) {
  for (const entry of readdirSync(target)) {
    if (entry === '.git') continue
    rmSync(join(target, entry), { recursive: true, force: true })
  }
}

function main() {
  const root = git(['rev-parse', '--show-toplevel']).trim()
  const configPath = resolve(root, option('--config') ?? 'public-sync.config.json')
  const config = normaliseConfig(JSON.parse(readFileSync(configPath, 'utf8')))
  const target = resolve(root, config.target)
  const rel = relative(root, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    fail(`target "${config.target}" must be a folder inside the project`)
  if (!gitOk(['check-ignore', '-q', `${rel}/.probe`], { cwd: root }))
    fail(`${rel}/ must be git-ignored here (add it to .gitignore)`)

  const ref = option('--ref') ?? 'HEAD'
  const fullSha = git(['rev-parse', '--verify', `${ref}^{commit}`], { cwd: root }).trim()
  const shortSha = fullSha.slice(0, 8)
  const tree = parseLsTree(git(['ls-tree', '-r', '-z', '--full-tree', fullSha], { cwd: root }))
  const { kept, excluded, notAllowed } = selectFiles([...tree.keys()], config)
  const next = new Map(kept.map((p) => [p, tree.get(p)]))

  const hasRepo = existsSync(join(target, '.git'))
  const hasHead = hasRepo && gitOk(['rev-parse', '--verify', 'HEAD'], { cwd: target })
  const current = hasHead
    ? parseLsTree(git(['ls-tree', '-r', '-z', 'HEAD'], { cwd: target }))
    : new Map()
  const plan = planChanges(next, current)
  const changed = plan.added.length + plan.modified.length + plan.deleted.length

  const dryRun = flag('--dry-run')
  const limit = dryRun && flag('--all') ? Infinity : dryRun ? 200 : 20
  console.log(`Private ${shortSha} (${ref}) → ${rel}/ ${hasHead ? '' : '(new public repo)'}`)
  console.log(
    `Files: ${kept.length} exported, ${excluded.length} excluded, ${notAllowed.length} not in the include list.`
  )
  const byRule = new Map()
  for (const e of excluded) byRule.set(e.rule, (byRule.get(e.rule) ?? 0) + 1)
  if (byRule.size) {
    console.log('\nExcluded:')
    for (const [glob, n] of byRule) console.log(`  ${String(n).padStart(4)}  ${glob}`)
  }
  printList(
    'Not in the include list (add to public-sync.config.json to publish)',
    notAllowed,
    limit
  )
  printList('Added', plan.added, limit)
  printList('Changed', plan.modified, limit)
  printList('Deleted', plan.deleted, limit)
  if (changed === 0) {
    console.log('\nNothing to sync: the public repo already matches.')
    return
  }
  if (dryRun) {
    console.log(`\nDry run: ${changed} file(s) would change. Nothing was written.`)
    return
  }

  // Export: a throwaway index inside the public repo's .git, so this repo's index is untouched.
  if (!hasRepo) {
    mkdirSync(target, { recursive: true })
    git(['init', '-q', '-b', config.branch], { cwd: target })
  }
  clearWorkTree(target)
  const indexFile = join(target, '.git', 'citefox-export-index')
  const env = { ...process.env, GIT_INDEX_FILE: indexFile }
  try {
    git(['read-tree', fullSha], { cwd: root, env })
    git(['checkout-index', '-z', '--stdin', `--prefix=${target}/`], {
      cwd: root,
      env,
      input: kept.join('\0')
    })
  } finally {
    rmSync(indexFile, { force: true })
  }

  const files = readExport(target, kept)
  const problems = [
    ...licenseProblems(files, config),
    ...scanExport(target, files, flag('--builtin-scan'))
  ]
  if (problems.length) {
    console.error('\nChecks failed:')
    for (const p of problems) console.error(`  ${p}`)
    fail(
      'fix these in the private repo (or in public-sync.config.json), commit, and run again. Nothing was committed.'
    )
  }

  git(['add', '-A'], { cwd: target })
  if (gitOk(['diff', '--cached', '--quiet'], { cwd: target })) {
    console.log('\nNothing to commit after export.')
    return
  }
  const last = hasHead ? lastSyncedCommit(git(['log', '-1', '--format=%B'], { cwd: target })) : null
  const lastKnown = last && gitOk(['merge-base', '--is-ancestor', last, fullSha], { cwd: root })
  const subjects = lastKnown
    ? git(['log', '--no-merges', '--format=%s', `${last}..${fullSha}`], { cwd: root })
        .split('\n')
        .filter(Boolean)
        .reverse()
    : []
  const message = commitMessage({
    shortSha,
    fullSha,
    subjects: publicSubjects(subjects, config.privateSubjectWords),
    first: !hasHead
  })
  const author = config.commitAuthor ? ['--author', config.commitAuthor] : []
  git(['commit', '-q', '-F', '-', ...author], { cwd: target, input: message })
  const made = git(['log', '-1', '--format=%h %s'], { cwd: target }).trim()

  const hasRemote = gitOk(['remote', 'get-url', 'origin'], { cwd: target })
  console.log(`\nCommitted in ${rel}/: ${made}`)
  console.log('\nReview it:')
  console.log(`  git -C ${rel} show --stat HEAD`)
  console.log(`  git -C ${rel} commit --amend      # edit the message before pushing`)
  console.log('\nPush it yourself when it looks right (this script never pushes):')
  if (!hasRemote)
    console.log(`  git -C ${rel} remote add origin ${config.publicRemote || '<public repo URL>'}`)
  console.log(`  git -C ${rel} push ${hasRemote ? '' : '-u '}origin ${config.branch}`)
}

main()
