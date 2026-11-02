// Dev-only prompt test bench (scripts/prompt-eval.mjs). Not imported by the app.
import { isCountryCode, isLanguageTag } from '@shared/domain'
import type { SetupSectionId } from '@shared/ipc'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The bench's command line. Pure except reading a `--sites` file.
 *
 * The order the app runs setup sections in (renderer `onboarding/steps/readRunner.ts`,
 * `useShapeExamples.ts`, `usePromptWriter.ts`): step 3's site read (always run) brings
 * the summary, brands, products, competitors, switch-from and integrations; then buyers
 * and triggers; then step 8's examples; then step 9's topic and questions. The six
 * section cards a user can ✦ Redo (steps 4 and 6) come last, each on the context the
 * auto path built, and do not feed each other.
 */
export const AUTO_SECTIONS = ['buyers', 'triggers', 'examples', 'topic', 'questions'] as const
export const CARD_SECTIONS = [
  'summary',
  'brands',
  'products',
  'competitors',
  'switchingFrom',
  'integrations'
] as const
export const APP_ORDER: readonly SetupSectionId[] = [...AUTO_SECTIONS, ...CARD_SECTIONS]

export interface EvalArgs {
  sites: string[]
  sections: SetupSectionId[]
  out: string
  label: string
  country: string
  language: string
}

export class EvalArgsError extends Error {}

export const EVAL_USAGE = `CiteFox prompt bench (dev only). Runs the real setup prompts on websites, no app window.

  node scripts/prompt-eval.mjs --sites <file or a,b,c> --out <dir> --label <name>

Options:
  --sites <list>     A file with one domain per line (# comments allowed), or a comma list.
  --sections <list>  Sections to run after the site read, in app order. Default: all
                     (${APP_ORDER.join(', ')}).
  --out <dir>        Output folder. Results go to <out>/<label>/.
  --label <name>     Run name, such as baseline. Default: run.
  --country <CC>     Market country. Default: US.
  --language <tag>   Market language. Default: en.
  --help             Show this help.

Uses Claude Code's own login on this computer (no API key) and reads sites the way setup does.
No paid search calls. Sites run one at a time, at most 2 Claude calls at once.`

const FLAGS = new Set(['sites', 'sections', 'out', 'label', 'country', 'language'])

export function wantsEvalHelp(argv: readonly string[]): boolean {
  return argv.some((token) => token === '--help' || token === '-h')
}

/** `--flag value` pairs; `cwd` resolves `--out` and a `--sites` file. */
export function parseEvalArgs(
  argv: readonly string[],
  cwd: string,
  readFile: (path: string) => string | null = readIfFile
): EvalArgs {
  const flags = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === undefined || token === '--') continue
    if (!token.startsWith('--')) throw new EvalArgsError(`Unexpected argument "${token}".`)
    const name = token.slice(2)
    if (!FLAGS.has(name)) throw new EvalArgsError(`Unknown flag --${name}. Run with --help.`)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new EvalArgsError(`--${name} needs a value.`)
    }
    flags.set(name, value)
    index += 1
  }
  const sitesRaw = flags.get('sites')
  if (sitesRaw === undefined) throw new EvalArgsError('--sites is required.')
  const out = flags.get('out')
  if (out === undefined) throw new EvalArgsError('--out is required.')
  const label = flags.get('label') ?? 'run'
  if (!/^[A-Za-z0-9._-]+$/u.test(label)) {
    throw new EvalArgsError('--label may use letters, digits, dot, dash and underscore only.')
  }
  const country = (flags.get('country') ?? 'US').trim().toUpperCase()
  if (!isCountryCode(country))
    throw new EvalArgsError(`--country ${country} is not a country code.`)
  const language = (flags.get('language') ?? 'en').trim()
  if (!isLanguageTag(language)) throw new EvalArgsError(`--language ${language} is not valid.`)
  const fileText = readFile(resolve(cwd, sitesRaw))
  const sites = parseSiteList(fileText ?? sitesRaw, fileText !== null)
  if (sites.length === 0) throw new EvalArgsError('--sites names no domain.')
  return {
    sites,
    sections: parseSections(flags.get('sections')),
    out: resolve(cwd, out),
    label,
    country,
    language
  }
}

/** Domains from a file (one per line, `#` comments) or a comma list, bare and once each. */
export function parseSiteList(text: string, isFile: boolean): string[] {
  const parts = isFile
    ? text.split(/\r?\n/u).map((line) => line.replace(/#.*$/u, ''))
    : text.split(',')
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of parts) {
    const domain = bareDomain(part)
    if (domain.length === 0 || seen.has(domain)) continue
    if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/u.test(domain)) {
      throw new EvalArgsError(`"${part.trim()}" is not a domain.`)
    }
    seen.add(domain)
    out.push(domain)
  }
  return out
}

export function bareDomain(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//u, '')
      .split('/')[0]
      ?.replace(/^www\./u, '')
      .replace(/\.$/u, '') ?? ''
  )
}

/** The sections asked for, in app order whatever order they were typed in. */
export function parseSections(raw: string | undefined): SetupSectionId[] {
  if (raw === undefined || raw.trim() === '' || raw.trim() === 'all') return [...APP_ORDER]
  const asked = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  for (const name of asked) {
    if (!APP_ORDER.includes(name as SetupSectionId)) {
      throw new EvalArgsError(`Unknown section "${name}". Sections: ${APP_ORDER.join(', ')}.`)
    }
  }
  return APP_ORDER.filter((id) => asked.includes(id))
}

function readIfFile(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null
  } catch {
    return null
  }
}
