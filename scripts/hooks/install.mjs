// `npm install` runs this (the "prepare" script): points git at scripts/hooks
// so the pre-commit secret scan runs on every commit. Does nothing outside a
// git checkout, in CI, or when CITEFOX_SKIP_HOOKS=1. Leaves another hooks
// folder alone if one is already set.
import { execFileSync } from 'node:child_process'

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

function main() {
  if (process.env.CI || process.env.CITEFOX_SKIP_HOOKS === '1') return
  try {
    if (git(['rev-parse', '--is-inside-work-tree']) !== 'true') return
  } catch {
    return
  }
  let current
  try {
    current = git(['config', '--get', 'core.hooksPath'])
  } catch {
    current = ''
  }
  if (current === 'scripts/hooks') return
  if (current) {
    console.log(
      `Git hooks: core.hooksPath is already "${current}", left as is. The secret scan is scripts/hooks/pre-commit.`
    )
    return
  }
  execFileSync('git', ['config', 'core.hooksPath', 'scripts/hooks'], { stdio: 'ignore' })
  console.log('Git hooks: the pre-commit secret scan is on (scripts/hooks).')
}

main()
