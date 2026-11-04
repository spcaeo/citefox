import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * R12 and owner decision 3 (Nov 2026): users never see the providers behind CiteFox
 * (Claude, Codex, cloro, SerpApi, Jina, Anthropic, OpenAI) outside the API keys and AI connection
 * settings, where they paste a key or connect (and the status of those connections).
 * What an AI does is "CiteFox AI"; searches are "searches" and "CiteFox credits".
 *
 * This reads every string a renderer file can show (string literals, template
 * text and JSX text; never comments or import paths) and fails on a provider
 * name outside the allowed places below.
 */

const ROOT = path.resolve(__dirname)
const PROVIDER = /\b(?:Claude|Codex|cloro|SerpApi|Jina|Anthropic|OpenAI)\b/

/** Where the names may show: connecting, checking and paying for each service. */
const ALLOWED_PLACES: readonly RegExp[] = [
  /^connections\//,
  /^status\//,
  /^settings\//,
  /^keys\//,
  // Usage's fixture for the mock build.
  /^usage\/mock\.ts$/,
  /^shell\/StatusPopover\.tsx$/,
  /^shell\/pickerDrawers\//,
  // First run: picking and connecting the AI and the search keys.
  /^onboarding\/(?:AiPicker|ClaudeScreen|validate|OnboardingApp)\.tsx?$/,
  /^onboarding\/steps\/(?:ClaudeStep|EnginesStep|EnginesRail|useEngineChoices|ShapesStep)\.tsx?$/,
  // A project's own AI connection and search key (Project settings › CiteFox AI).
  /^projectSettings\/components\/(?:ClaudeSection|SearchesSection)\.tsx$/,
  /^projectSettings\/utils\/model\.ts$/,
  // What to track: the choice between the two search services the user pays for.
  /^projectSettings\/track\/TrackSection\.tsx$/,
  /^projects\/newProject\//,
  // The chip's named form, used on Status only.
  /^ui\/claudeChip\.ts$/,
  // Not shipped screens: fixtures for the mock clients.
  /^mocks\//,
  /^projects\/mockClient\.ts$/,
  /^onboarding\/mock[A-Z][^/]*\.ts$/,
  /^admin\//
]

/** Single strings elsewhere that are not provider names to a reader. */
const ALLOWED_TEXT: readonly RegExp[] = [
  // The user's own chatbot list ("Which chatbot do you use?"), next to ChatGPT and Gemini.
  /^Claude$/,
  // Internal ids and provider values compared in code, never shown.
  /^[a-z0-9_:-]+$/
]

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(name) && !/\.test\.|test-helper|\.d\.ts$/.test(name)) out.push(full)
  }
  return out
}

function shownStrings(file: string): { line: number; text: string }[] {
  const source = readFileSync(file, 'utf8')
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
  const found: { line: number; text: string }[] = []
  const visit = (node: ts.Node): void => {
    const isText =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      node.kind === ts.SyntaxKind.JsxText
    const inImport =
      node.parent !== undefined &&
      (ts.isImportDeclaration(node.parent) ||
        ts.isExportDeclaration(node.parent) ||
        ts.isLiteralTypeNode(node.parent))
    if (isText && !inImport) {
      const text =
        ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)
          ? node.text
          : node.getText(sf)
      if (PROVIDER.test(text) && !ALLOWED_TEXT.some((allowed) => allowed.test(text.trim()))) {
        found.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

describe('provider names (R12)', () => {
  it('no screen outside Connections, Status and Permissions names Claude, Codex, cloro or SerpApi', () => {
    const leaks: string[] = []
    for (const file of sourceFiles(ROOT)) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/')
      if (ALLOWED_PLACES.some((place) => place.test(rel))) continue
      for (const hit of shownStrings(file)) {
        leaks.push(`${rel}:${hit.line}: ${hit.text.trim().slice(0, 100)}`)
      }
    }
    expect(leaks).toEqual([])
  }, 60_000)
})

/**
 * The same rule for the words the main process sends the user (errors, notices, report
 * text, progress lines). Not scanned: the provider code itself, stored SQL, live smoke runs,
 * the eval harness and log lines (a logger call is for the owner, not the customer).
 */
const MAIN_ROOT = path.resolve(__dirname, '../../main')
const MAIN_SKIPPED: readonly RegExp[] = [
  /^providers\//,
  /^storage\//,
  /^smoke\//,
  /^eval\//,
  /^handlers\/test-harness\.ts$/,
  // SQL that compares a stored provider id.
  /^engine\/progress\/project-history\.ts$/
]
/**
 * Main-process files that still name a provider in text the user can see, because it is a
 * connection or key message (Settings > Connections, key entry, Status). The owner has not
 * decided the wording for these yet; do not add to this list for any other screen.
 */
const MAIN_UNDECIDED: readonly RegExp[] = [
  // Key and connection messages: add, test, rotate, run out, rate limit.
  /^engine\/(?:checks\/(?:prepare|engine-helpers|key-rotation|capture|market-questions|cloro-capture)|claude|claude-fallback|jina-keys|project-settings\/(?:activity|search|settings|usage))\.ts$/,
  /^(?:ipc-project-settings|handlers\/(?:keys|onboarding))\.ts$/,
  /^notices\/claude-ask\.ts$/,
  /^queue\/check-queue\.ts$/,
  // What the connection settings are called in a settings export.
  /^project-transfer\/settings-transfer\.ts$/,
  // The Status screen's AI explanations of usage and failed calls.
  /^assist\/definitions\/status\.ts$/
]
const LOG_CALL = /(?:logger|\blog)\b|\.(?:warn|info|debug|error)$/

function mainSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name !== 'fixtures') mainSourceFiles(full, out)
    } else if (/\.ts$/.test(name) && !/\.test\.|test-helper|\.d\.ts$/.test(name)) out.push(full)
  }
  return out
}

function mainShownStrings(file: string): { line: number; text: string }[] {
  const source = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const found: { line: number; text: string }[] = []
  const inLogCall = (node: ts.Node): boolean => {
    for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
      if (ts.isCallExpression(parent) && LOG_CALL.test(parent.expression.getText(sf))) return true
      if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true
      if (ts.isLiteralTypeNode(parent) || ts.isCaseClause(parent)) return true
    }
    return false
  }
  const visit = (node: ts.Node): void => {
    const isText =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    if (isText && PROVIDER.test(node.text) && !inLogCall(node)) {
      const text = node.text.trim()
      if (!ALLOWED_TEXT.some((allowed) => allowed.test(text))) {
        found.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

describe('provider names in main-process messages (R12)', () => {
  it('no report, notice or error outside the connection messages names Claude, cloro, SerpApi or Jina', () => {
    const leaks: string[] = []
    const used = new Set<RegExp>()
    for (const file of mainSourceFiles(MAIN_ROOT)) {
      const rel = path.relative(MAIN_ROOT, file).split(path.sep).join('/')
      if (MAIN_SKIPPED.some((skip) => skip.test(rel))) continue
      const hits = mainShownStrings(file)
      const place = MAIN_UNDECIDED.find((item) => item.test(rel))
      if (place !== undefined) {
        if (hits.length > 0) used.add(place)
        continue
      }
      for (const hit of hits) leaks.push(`${rel}:${hit.line}: ${hit.text.slice(0, 100)}`)
    }
    expect(leaks).toEqual([])
    // A fixed file leaves the list, so the list only ever gets shorter.
    expect(MAIN_UNDECIDED.filter((place) => !used.has(place)).map(String)).toEqual([])
  }, 60_000)
})
