import { SmokeError } from './errors'

/**
 * Smoke flags for the prompt-audit hooks (Docs/PROMPT-AUDIT.md, P0 item 9). The
 * page hooks run after the page smoke's score; `--competitor` runs with `--topic`.
 */
export interface HookFlags {
  /** `--gaps`: run the content-gap hook after the page smoke (P1 fills it). */
  gaps: boolean
  /** `--assist <id>`: run one assist after the page smoke (P5, P7, P8 fill it). */
  assist: string | null
  /** `--sentiment`: run brand sentiment after the page smoke (P6 fills it). */
  sentiment: boolean
  /** `--reports`: run check reports after the page smoke (P6 fills it). */
  reports: boolean
  /** `--classify`: save a Fill read as products, check again, print classes (P9). */
  classify: boolean
  /** `--competitor <url>`: competitor page for the topic smoke (P4 fills it). */
  competitor: string | null
}

/** Hook flags that take no value. */
export const SWITCH_FLAGS: ReadonlySet<string> = new Set([
  'gaps',
  'sentiment',
  'reports',
  'classify'
])

/** Every hook flag name, without the leading dashes. */
export const HOOK_FLAG_NAMES = [
  'gaps',
  'assist',
  'sentiment',
  'reports',
  'classify',
  'competitor'
] as const

const PAGE_HOOK_FLAGS = ['gaps', 'sentiment', 'reports', 'classify', 'assist'] as const

/**
 * Reads the hook flags from the parsed flag map. A switch flag is stored with an
 * empty value. Page hooks are refused in topic and fill mode; `--competitor` needs
 * topic mode.
 */
export function readHookFlags(
  flags: ReadonlyMap<string, string>,
  topicMode: boolean,
  fillMode: boolean
): HookFlags {
  const assist = readAssistId(flags.get('assist'))
  const page = PAGE_HOOK_FLAGS.find((name) => flags.has(name))
  if (page !== undefined && (topicMode || fillMode)) {
    throw new SmokeError(`--${page} runs after the page smoke. Leave out --topic and --fill.`)
  }
  const competitor = readCompetitorUrl(flags.get('competitor'))
  if (competitor !== null && !topicMode) {
    throw new SmokeError('--competitor runs with --topic.')
  }
  return {
    gaps: flags.has('gaps'),
    assist,
    sentiment: flags.has('sentiment'),
    reports: flags.has('reports'),
    classify: flags.has('classify'),
    competitor
  }
}

/** True when the page smoke should run its hooks after the score. */
export function wantsPageHooks(flags: HookFlags): boolean {
  return flags.gaps || flags.sentiment || flags.reports || flags.classify || flags.assist !== null
}

function readAssistId(raw: string | undefined): string | null {
  if (raw === undefined) return null
  // A comma list runs several assists on one page smoke (`--assist a,b`).
  if (!/^[A-Za-z0-9._-]{1,80}(?:,[A-Za-z0-9._-]{1,80}){0,15}$/u.test(raw)) {
    throw new SmokeError('--assist needs an assist id such as audience.triggers.')
  }
  return raw
}

function readCompetitorUrl(raw: string | undefined): string | null {
  if (raw === undefined) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new SmokeError('--competitor needs a page URL such as https://www.simpletexting.com/.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SmokeError('--competitor must start with http:// or https://.')
  }
  if (url.username !== '' || url.password !== '') {
    throw new SmokeError('--competitor must not include a username or password.')
  }
  return url.toString()
}
