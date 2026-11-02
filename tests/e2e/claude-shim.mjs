/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * Stand-in for the `claude` binary. Production spawns this by PATH.
 * Stdout matches `parseClaudeCliOutput`: `structured_output` is the JSON
 * object inside the recorded Anthropic textbolt fixtures.
 *
 * Routing (Docs/PROMPT-AUDIT.md section 3, rule 7), on the prompt's first lines:
 * - `Template: <kind>.md` loads `<kind>.json` from the template fixture folders
 *   (`src/main/topics/fixtures`, `src/main/pipeline/fixtures`,
 *   `src/main/engine/checks/fixtures`, `tests/e2e/fixtures`, in that order, or
 *   CITEFOX_TEMPLATE_FIXTURE_DIRS). An optional second line `Variant: <x>` loads
 *   `<kind>.<x>.json` first. A file may hold the plain reply, a CLI envelope
 *   (`structured_output`) or an Anthropic envelope (`body.content[0].text`).
 *   `topic_page_match`, `topic_questions_cleanup`, `topic_profile_rewrite`,
 *   `topic_cluster_sort` and `topic_target_suggest` are built from the prompt, and so
 *   are `coverage_matrix` and `coverage_fixes` (the recorded rows the prompt's
 *   numbered lines ask for).
 * - `Assist: <id>` loads `src/main/assist/fixtures/<id>.json`. Onboarding v2 sections
 *   (`Assist: setup.<section>`) hold the CSV or text reply as a JSON string, sent as the
 *   plain `result`; a ✦ Find more prompt reads `setup.<section>.more.json` first.
 * - `Ask CiteFox:` and `Suggest brands and competitors for ` keep their fixtures.
 * - The older substring routes (aio_gap, run_summary, video_brief, sentiment,
 *   brand prompts, and the page pipeline's "Write six parts" and "You are writing
 *   buyer prompts") stay as fallbacks for prompts whose kind has no fixture file.
 *   The buyer profile and prompts keep the recorded textbolt replies that way.
 */
import { appendFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = process.env.CITEFOX_FIXTURE_DIR
const logPath = process.env.CITEFOX_SHIM_LOG ?? '/tmp/citefox-claude-shim.log'

/**
 * @param {string} line
 * @returns {void}
 */
function log(line) {
  appendFileSync(logPath, `${line}\n`)
}

if (!dir) {
  log('CITEFOX_FIXTURE_DIR is unset')
  process.exit(1)
}

const args = process.argv.slice(2)
if (args[0] === '--version') {
  process.stdout.write('2.4.1 (Claude Code)\n')
  process.exit(0)
}
if (args[0] === 'auth' && args[1] === 'status') {
  process.stdout.write(
    JSON.stringify({
      loggedIn: true,
      authMethod: 'claude.ai',
      apiProvider: 'firstParty',
      subscriptionType: 'max'
    })
  )
  process.exit(0)
}

// CiteFox writes the prompt to stdin and closes it (SRS LLM-3); argv has no prompt.
const prompt = args.includes('-p') ? readFileSync(0, 'utf8') : ''

/**
 * @param {string} name
 * @returns {Record<string, unknown>}
 */
function fixtureJson(name) {
  const file = JSON.parse(readFileSync(path.join(dir, name), 'utf8'))
  const text = file.body?.content?.[0]?.text
  if (typeof text !== 'string') throw new Error(`${name} has no assistant text`)
  return JSON.parse(text)
}

/**
 * Recorded brand-sentiment replies, stored as the plain JSON Claude returns.
 * @param {string} name
 * @returns {Record<string, unknown>}
 */
function sentimentFixture(name) {
  const file = new URL(`../../src/main/engine/sentiment/fixtures/${name}`, import.meta.url)
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** @returns {string[]} */
function promptTexts() {
  return fixtureJson('claude-prompts.json').prompts.map((row) => row.text)
}

/**
 * Assist and Ask CiteFox replies are recorded objects, not Anthropic envelopes.
 * @param {string} directory
 * @param {string} name
 * @returns {any}
 */
function replyFixture(directory, name) {
  try {
    return JSON.parse(readFileSync(path.join(directory, name), 'utf8'))
  } catch {
    return null
  }
}

const promptLines = prompt.split('\n')
const firstLine = promptLines[0] ?? ''
// The engine runs `claude` in an empty temp folder, so resolve from this file, not the cwd.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const assistDir =
  process.env.CITEFOX_ASSIST_FIXTURE_DIR ?? path.join(repoRoot, 'src/main/assist/fixtures')
const askDir = process.env.CITEFOX_ASK_FIXTURE_DIR ?? path.join(repoRoot, 'src/main/ask/fixtures')

/** Template fixture folders, searched in order. */
const templateDirs = (
  process.env.CITEFOX_TEMPLATE_FIXTURE_DIRS?.split(path.delimiter).filter(Boolean) ?? [
    'src/main/topics/fixtures',
    'src/main/pipeline/fixtures',
    'src/main/engine/checks/fixtures',
    'src/main/assistant/fixtures',
    'tests/e2e/fixtures'
  ]
).map((folder) => path.resolve(repoRoot, folder))

/**
 * The reply inside a fixture file: a CLI envelope's `structured_output`, the
 * JSON text of a recorded Anthropic envelope, or the plain reply object.
 * @param {unknown} file
 * @returns {Record<string, unknown> | null}
 */
function unwrapReply(file) {
  if (typeof file !== 'object' || file === null || Array.isArray(file)) return null
  const record = /** @type {Record<string, any>} */ (file)
  if (typeof record.structured_output === 'object' && record.structured_output !== null) {
    return record.structured_output
  }
  const text = record.body?.content?.[0]?.text
  if (typeof text === 'string') return JSON.parse(text)
  return record
}

/**
 * `<kind>.<variant>.json`, else `<kind>.json`, from the first template fixture
 * folder that has it. Null when no folder has either.
 * @param {string} kind
 * @param {string | undefined} variant
 * @returns {{ json: Record<string, unknown>, name: string } | null}
 */
function templateFixture(kind, variant) {
  const names =
    variant === undefined ? [`${kind}.json`] : [`${kind}.${variant}.json`, `${kind}.json`]
  for (const name of names) {
    for (const folder of templateDirs) {
      const file = replyFixture(folder, name)
      if (file !== null) return { json: unwrapReply(file) ?? {}, name }
    }
  }
  return null
}

/**
 * Topic replies built from the prompt (Docs/TOPICS-SPEC.md section 6): page match
 * and clean-up answer the prompt's "id · text" lines, the same way
 * src/main/topics/fixture-replies.ts does. Null for every other kind.
 * @param {string} kind
 * @returns {Record<string, unknown> | null}
 */
function generatedReply(kind) {
  /** @type {{ id: string, text: string }[]} */
  const lines = prompt
    .split('\n')
    .map((line) => /^([A-Za-z0-9][\w-]*) · (.+)$/u.exec(line.trim()))
    .filter((match) => match !== null)
    .map((match) => ({ id: match[1] ?? '', text: match[2] ?? '' }))
  if (kind === 'topic_page_match') {
    const pages = prompt
      .split('\n')
      .map((line) => /^(https?:\/\/\S+) · /u.exec(line)?.[1])
      .filter((url) => url !== undefined)
    return {
      matches: lines.map((line, index) => ({
        id: line.id,
        url: index % 4 === 3 || pages.length === 0 ? null : (pages[index % pages.length] ?? null),
        confidence: index % 4 === 3 ? 0 : 60 + ((index * 7) % 35),
        reason:
          index % 4 === 3
            ? 'No page answers this yet.'
            : 'A heading on the page answers this situation.'
      }))
    }
  }
  if (kind === 'coverage_matrix' || kind === 'coverage_fixes') {
    // Content gaps (Docs/PROMPT-AUDIT.md, P1): one row per prompt the call lists as
    // "<n>. [<stage> · <source>] …", from the recorded TextBolt rows by position.
    const positions = prompt
      .split('\n')
      .map((line) => /^(\d+)\. \[[a-z0-9_]+ · [a-z0-9_]+\] /u.exec(line)?.[1])
      .filter((value) => value !== undefined)
      .map(Number)
    // No numbered prompt lines: the fixture file (or its Variant) answers as recorded.
    if (positions.length === 0) return null
    const found = templateFixture(kind, undefined)
    /** @type {{ position: number }[]} */
    const recorded = Array.isArray(found?.json.rows) ? found.json.rows : []
    if (recorded.length === 0) return null
    return {
      rows: positions.map((position) => {
        const row =
          recorded.find((item) => item.position === position) ??
          recorded[(position - 1) % recorded.length]
        return { ...row, position }
      })
    }
  }
  if (kind === 'topic_questions_cleanup') {
    return {
      items: lines
        .filter((line) => line.text.split(/\s+/u).length < 8)
        .map((line) => ({
          id: line.id,
          after: `${line.text.replace(/[?.!]+$/u, '')}: how do we handle this for our team without a developer?`,
          stage: 'problem',
          change: 'Made it a full question'
        }))
    }
  }
  if (kind === 'topic_target_suggest') {
    // The first two listed pages, best first; a new page idea when none is listed.
    const pages = prompt
      .split('\n')
      .map((line) => /^(https?:\/\/\S+) · /u.exec(line)?.[1])
      .filter((url) => url !== undefined)
    return {
      picks: pages.slice(0, 2).map((url, index) => ({
        url,
        reason:
          index === 0
            ? 'Its title names this exact buyer problem, and answers already cite it most.'
            : 'A section on this page answers part of the topic.'
      })),
      newPage:
        pages.length === 0
          ? {
              title: 'Replacing a carrier email-to-text gateway',
              path: '/email-to-text-gateway-replacement',
              about: 'What to switch to when a carrier gateway shuts down, and how to move alerts.'
            }
          : null
    }
  }
  if (kind === 'topic_cluster_sort') {
    // Each `t<n> · ` line is a topic; every question goes to the first one, else a new topic.
    const isTopic = (/** @type {string} */ id) => /^t\d+$/u.test(id)
    const topic = lines.find((line) => isTopic(line.id))
    return {
      proposals: lines
        .filter((line) => !isTopic(line.id))
        .map((line) => ({
          id: line.id,
          topicId: topic?.id ?? null,
          newTopic: topic === undefined ? 'Text alerts from monitoring tools' : null,
          reason:
            topic === undefined
              ? 'No listed topic fits; the buyer wants monitoring alerts as texts.'
              : 'The buyer is in the same situation as this topic.'
        }))
    }
  }
  if (kind === 'topic_profile_rewrite') {
    return {
      points: lines.map((line) => ({
        section: 'who',
        text: `${line.text.replace(/^\[[^\]]*\]\s*/u, '').replace(/[.]+$/u, '')}, in plain words`,
        replaces: line.id
      }))
    }
  }
  return null
}

let matched = ''
/** @type {Record<string, unknown> | string | null | undefined} */
let json
const assistId = /^Assist: ([A-Za-z0-9._-]+)$/.exec(firstLine)?.[1]
const templateKind = /^Template: ([a-z][a-z0-9_]*)\.md$/.exec(firstLine)?.[1]
const variant = /^Variant: ([A-Za-z0-9_-]+)$/.exec(promptLines[1] ?? '')?.[1]
// Topic kinds log as `topic-<kind>` (specs read these lines); others as `template-<kind>`.
const isTopicKind = templateKind !== undefined && /^(?:topic_|competitor_page_)/.test(templateKind)
if (templateKind !== undefined) {
  const label = isTopicKind ? `topic-${templateKind}` : `template-${templateKind}`
  const generated = generatedReply(templateKind)
  const found = generated === null ? templateFixture(templateKind, variant) : null
  if (generated !== null) {
    json = generated
    matched = label
  } else if (found !== null) {
    json = found.json
    matched = found.name === `${templateKind}.json` ? label : `${label}.${variant}`
  } else if (isTopicKind) {
    log(`no topic fixture for ${templateKind}`)
    process.exit(1)
  }
}
if (matched !== '') {
  // Routed by its Template: line above.
} else if (assistId !== undefined) {
  // Onboarding v2 sections (`Assist: setup.<section>`): ✦ Find more lists the rows the
  // section holds ("Already listed, don't repeat"), so it reads `<id>.more.json` first.
  const more = assistId.startsWith('setup.') && prompt.includes("Already listed, don't repeat")
  const moreJson = more ? replyFixture(assistDir, `${assistId}.more.json`) : null
  json = moreJson ?? replyFixture(assistDir, `${assistId}.json`)
  if (json === null) {
    log(`no assist fixture for ${assistId}`)
    process.exit(1)
  }
  matched = moreJson === null ? `assist-${assistId}` : `assist-${assistId}.more`
} else if (firstLine.startsWith('Ask CiteFox:')) {
  json = replyFixture(askDir, 'ask-filters.json')
  if (json === null) {
    log('no ask fixture')
    process.exit(1)
  }
  matched = 'ask'
} else if (prompt.includes('Reply with JSON only')) {
  matched = 'checkup'
  json = { ok: true }
} else if (prompt.includes('Template: aio_gap.md')) {
  const index = promptTexts().findIndex((text) => prompt.includes(text))
  const position = index + 1
  if (![3, 4, 5, 8, 9].includes(position)) {
    log(`no gap fixture for prompt ${position}`)
    process.exit(1)
  }
  matched = `gap-${position}`
  json = fixtureJson(`claude-gap-${position}.json`)
} else if (prompt.includes('Template: run_summary.md')) {
  matched = 'summary'
  json = fixtureJson('claude-summary.json')
} else if (prompt.includes('Template: video_brief.md')) {
  matched = 'video-brief'
  const file = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../src/main/communities/fixtures/video-brief.json'
  )
  json = JSON.parse(readFileSync(file, 'utf8')).structured_output
} else if (prompt.includes('Template: sentiment_fact_check.md')) {
  // Brand sentiment fact check (Docs/PROMPT-AUDIT.md P6 4b), as
  // src/main/engine/sentiment/fixture-replies.ts `factCheckFixture` routes it.
  if (!prompt.includes('TextBolt pricing starts at $19')) {
    matched = 'sentiment-check-none'
    json = sentimentFixture('claude-sentiment-check-none.json')
  } else if (prompt.includes('TextBolt plans start at $29 a month.')) {
    matched = 'sentiment-pricing-facts'
    json = sentimentFixture('claude-sentiment-check-facts.json')
  } else {
    matched = 'sentiment-check-pricing'
    json = sentimentFixture('claude-sentiment-check-pricing.json')
  }
} else if (prompt.includes('Template: sentiment_claims_v2.md')) {
  // Brand sentiment (FR-16.2): the recorded replies for the brand-prompt overviews,
  // and an empty reading for every other overview.
  if (prompt.includes('TextBolt pricing starts at $19')) {
    matched = 'sentiment-pricing'
    json = sentimentFixture('claude-sentiment-pricing.json')
  } else if (prompt.includes('no-code email-to-SMS gateway')) {
    matched = 'sentiment-reviews'
    json = sentimentFixture('claude-sentiment-reviews.json')
  } else {
    matched = 'sentiment-none'
    json = sentimentFixture('claude-sentiment-none.json')
  }
} else if (prompt.includes('Template: brand_prompts.md')) {
  matched = 'brand-prompts'
  json = sentimentFixture(
    prompt.includes('Spanish') ? 'claude-brand-prompts-es.json' : 'claude-brand-prompts.json'
  )
} else if (prompt.includes('Write six parts')) {
  matched = 'profile'
  json = fixtureJson('claude-profile.json')
} else if (prompt.includes('You are writing buyer prompts')) {
  matched = 'prompts'
  json = fixtureJson('claude-prompts.json')
} else {
  log(`unmatched prompt: ${prompt.slice(0, 240)}`)
  process.exit(1)
}

log(matched)
const envelope = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  // A section reply is CSV or plain text (a JSON string in its fixture): sent as is.
  result: typeof json === 'string' ? json : JSON.stringify(json),
  ...(typeof json === 'string' ? {} : { structured_output: json }),
  session_id: '00000000-0000-4000-8000-000000000001',
  duration_ms: 10,
  duration_api_ms: 10,
  total_cost_usd: 0,
  usage: {
    input_tokens: 12,
    output_tokens: 4,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0
  }
}
// The business description a topic step was written with, so a spec can check an edit reached it.
const about = prompt.split('\n').find((line) => line.startsWith('About the business:'))
if (about !== undefined) log(`${firstLine} ${about}`)
// The owner's project rules a prompt carried, so a spec can check a saved rule reached it.
const rulesAt = promptLines.indexOf("The owner's rules for this project (always follow them):")
if (rulesAt >= 0) {
  const rules = []
  for (let at = rulesAt + 1; at < promptLines.length && promptLines[at].startsWith('- '); at += 1) {
    rules.push(promptLines[at].slice(2))
  }
  log(`${firstLine} RULES: ${rules.join(' | ')}`)
}

/**
 * CITEFOX_SHIM_FAIL ("<text>;…") fails every call whose prompt contains one of the texts,
 * after the delay below, the way a `claude -p` that stops does (exit 1), so a spec can show
 * one product's competitor search not finishing.
 */
const failOn = (process.env.CITEFOX_SHIM_FAIL ?? '').split(';').filter(Boolean)
const fails = failOn.some((text) => prompt.includes(text))

/**
 * CITEFOX_SHIM_DELAY_MS keeps every call running so a spec can see the live
 * progress panel; CITEFOX_SHIM_SLOW ("<first line>=<ms>;…") slows only the
 * named steps, so a spec can edit while the autopilot runs.
 */
const slow = (process.env.CITEFOX_SHIM_SLOW ?? '')
  .split(';')
  .map((entry) => entry.split('='))
  .find(([line]) => line === firstLine)
const delay = Number(slow?.[1] ?? process.env.CITEFOX_SHIM_DELAY_MS ?? '0')
const answer = () => {
  if (!fails) {
    process.stdout.write(JSON.stringify(envelope))
    return
  }
  log(`${firstLine} failed on purpose (CITEFOX_SHIM_FAIL)`)
  process.stderr.write('The stand-in stopped this call (CITEFOX_SHIM_FAIL).\n')
  process.exit(1)
}
if (Number.isFinite(delay) && delay > 0) {
  setTimeout(answer, delay)
} else {
  answer()
}
