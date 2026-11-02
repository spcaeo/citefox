// Pure helpers for scripts/public-sync.mjs (no git, no files), so the filters
// and checks are tested on their own (public-sync-core.test.mjs).

/**
 * A path glob as a RegExp, matched against the whole repo-relative path.
 * `**` crosses folders, `*` and `?` stay inside one. `dir/**` matches all of dir.
 * @param {string} glob
 */
export function globToRegExp(glob) {
  let out = ''
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i]
    if (ch === '*' && glob[i + 1] === '*') {
      const slashAfter = glob[i + 2] === '/'
      out += slashAfter ? '(?:.*/)?' : '.*'
      i += slashAfter ? 2 : 1
    } else if (ch === '*') {
      out += '[^/]*'
    } else if (ch === '?') {
      out += '[^/]'
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${out}$`)
}

/** One include or exclude rule: a string glob, or `{ path, why }`. */
function rule(entry) {
  const text = typeof entry === 'string' ? entry : entry.path
  const negated = text.startsWith('!')
  const glob = negated ? text.slice(1) : text
  return {
    glob,
    negated,
    re: globToRegExp(glob),
    why: typeof entry === 'string' ? '' : (entry.why ?? '')
  }
}

/**
 * Normalises public-sync.config.json. Keys starting with `$` are comments.
 * @param {Record<string, unknown>} raw
 */
export function normaliseConfig(raw) {
  const include = Array.isArray(raw.include) ? raw.include : []
  const exclude = Array.isArray(raw.exclude) ? raw.exclude : []
  if (include.length === 0) throw new Error('public-sync.config.json: "include" is empty')
  return {
    target: typeof raw.target === 'string' ? raw.target : '.public-export',
    branch: typeof raw.branch === 'string' ? raw.branch : 'main',
    publicRemote: typeof raw.publicRemote === 'string' ? raw.publicRemote : '',
    commitAuthor:
      typeof raw.commitAuthor === 'string' && raw.commitAuthor ? raw.commitAuthor : null,
    requiredFiles: Array.isArray(raw.requiredFiles)
      ? raw.requiredFiles
      : ['LICENSE', 'NOTICE', 'TRADEMARKS.md'],
    apacheAllowed: (Array.isArray(raw.apacheAllowed) ? raw.apacheAllowed : []).map((g) =>
      globToRegExp(g)
    ),
    privateSubjectWords: Array.isArray(raw.privateSubjectWords) ? raw.privateSubjectWords : [],
    include: include.map(rule),
    exclude: exclude.map(rule)
  }
}

/**
 * Splits paths into what is exported, what an exclude rule drops, and what
 * no include rule allows. Exclude rules run in order; the last match wins, so
 * `!glob` puts back a path an earlier exclude dropped.
 * @param {string[]} paths
 * @param {ReturnType<typeof normaliseConfig>} config
 */
export function selectFiles(paths, config) {
  const kept = []
  const excluded = []
  const notAllowed = []
  for (const path of paths) {
    let hit = null
    for (const r of config.exclude) if (r.re.test(path)) hit = r.negated ? null : r
    if (hit) excluded.push({ path, rule: hit.glob, why: hit.why })
    else if (!config.include.some((r) => !r.negated && r.re.test(path))) notAllowed.push(path)
    else kept.push(path)
  }
  return { kept, excluded, notAllowed }
}

/**
 * Parses `git ls-tree -r -z` output into Map(path → `mode sha`). Skips submodules.
 * @param {string} out
 */
export function parseLsTree(out) {
  const map = new Map()
  for (const record of out.split('\0')) {
    if (!record) continue
    const tab = record.indexOf('\t')
    const [mode, type, sha] = record.slice(0, tab).split(' ')
    if (type !== 'blob') continue
    map.set(record.slice(tab + 1), `${mode} ${sha}`)
  }
  return map
}

/**
 * What a sync changes in the public repo. Both maps are path → `mode sha`.
 * @param {Map<string, string>} next  the files to export
 * @param {Map<string, string>} current  the public repo's last commit
 */
export function planChanges(next, current) {
  const added = []
  const modified = []
  const deleted = []
  for (const [path, id] of next) {
    if (!current.has(path)) added.push(path)
    else if (current.get(path) !== id) modified.push(path)
  }
  for (const path of current.keys()) if (!next.has(path)) deleted.push(path)
  return { added: added.sort(), modified: modified.sort(), deleted: deleted.sort() }
}

/** The private commit a public commit came from (its `Private-Commit:` trailer), or null. */
export function lastSyncedCommit(message) {
  const match = /^Private-Commit: ([0-9a-f]{7,40})\s*$/m.exec(message ?? '')
  return match ? match[1] : null
}

/**
 * Subjects that are safe to publish: a subject naming a private word
 * (a client, a reference report) becomes "Private change".
 * @param {string[]} subjects
 * @param {string[]} privateWords
 */
export function publicSubjects(subjects, privateWords) {
  const words = privateWords.filter(Boolean).map((w) => w.toLowerCase())
  return subjects.map((s) =>
    words.some((w) => s.toLowerCase().includes(w)) ? 'Private change' : s
  )
}

/**
 * The public commit message: "Sync from private <short sha>: <subjects>",
 * a bullet list of the subjects, and a Private-Commit trailer for the next sync.
 * @param {{ shortSha: string, fullSha: string, subjects: string[], first: boolean }} input
 */
export function commitMessage({ shortSha, fullSha, subjects, first }) {
  const list = first ? ['First public snapshot'] : subjects.length ? subjects : ['Updates']
  const maxTitle = 100
  let title = `Sync from private ${shortSha}: ${list.join('; ')}`
  if (title.length > maxTitle) {
    const more = list.length > 1 ? ` (+${list.length - 1} more)` : ''
    const head = `Sync from private ${shortSha}: ${list[0]}`
    title =
      head.length + more.length > maxTitle
        ? `${head.slice(0, maxTitle - more.length - 1)}…${more}`
        : head + more
  }
  const shown = list.slice(0, 60)
  const body =
    list.length > 1
      ? `\n\n${shown.map((s) => `- ${s}`).join('\n')}${list.length > shown.length ? `\n- …and ${list.length - shown.length} more` : ''}`
      : ''
  return `${title}${body}\n\nPrivate-Commit: ${fullSha}\n`
}

/** Says Apache-2.0 about a licence. Third-party mentions are allowed by path in the config. */
const APACHE = /Apache[- ]?(?:License[, ]*(?:Version )?)?2\.0|"license"\s*:\s*"Apache/i

/**
 * Licence problems in the export: a missing required file, a package.json
 * licence that is not the project's own, or a file that calls CiteFox Apache-2.0.
 * @param {{ path: string, text: string | null }[]} files  text is null for binaries
 * @param {ReturnType<typeof normaliseConfig>} config
 */
export function licenseProblems(files, config) {
  const problems = []
  const paths = new Set(files.map((f) => f.path))
  for (const required of config.requiredFiles)
    if (!paths.has(required)) problems.push(`${required} is missing`)
  for (const { path, text } of files) {
    if (text === null) continue
    if (path === 'package.json') {
      try {
        const license = JSON.parse(text).license
        if (license !== 'SEE LICENSE IN LICENSE')
          problems.push(`package.json: license is "${license}", expected "SEE LICENSE IN LICENSE"`)
      } catch {
        problems.push('package.json: not valid JSON')
      }
      continue
    }
    if (config.apacheAllowed.some((re) => re.test(path))) continue
    const lines = text.split('\n')
    lines.forEach((line, index) => {
      if (APACHE.test(line))
        problems.push(
          `${path}:${index + 1}: says Apache-2.0 (CiteFox uses the CiteFox Source-Available License)`
        )
    })
  }
  return problems
}
