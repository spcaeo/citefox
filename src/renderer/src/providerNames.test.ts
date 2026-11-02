import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * R12 and owner decision 3 (Nov 2026): users never see the providers behind CiteFox
 * (Claude, Codex, cloro, SerpApi, Jina) outside the API keys and AI connection
 * settings, where they paste a key or connect (and the status of those connections).
 * What an AI does is "CiteFox AI"; searches are "searches" and "CiteFox credits".
 *
 * This reads every string a renderer file can show (string literals, template
 * text and JSX text; never comments or import paths) and fails on a provider
 * name outside the allowed places below.
 */

const ROOT = path.resolve(__dirname)
const PROVIDER = /\b(?:Claude|Codex|cloro|SerpApi|Jina)\b/

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
  /^onboarding\/(?:WelcomeScreen|AiPicker|ClaudeScreen|validate|OnboardingApp)\.tsx?$/,
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
