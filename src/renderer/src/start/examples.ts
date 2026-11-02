/**
 * One-line examples for "How do you want to start?" and the chooser (owner
 * feedback 6), built only from what the user saved during onboarding: the
 * domain, brand names, competitors and "What buyers switch from". Nothing here
 * is presented as found data: page paths and questions are marked "e.g." or
 * "such as", and a missing field falls back to plain generic copy.
 */

/** The saved profile fields the examples read. All optional. */
export interface ExampleProfile {
  domain?: string | null
  brandNames?: readonly string[]
  competitors?: readonly string[]
  switchingFrom?: readonly string[]
}

/** The six ways to choose what to track yourself. Search Console is not built yet. */
export const START_WAYS = ['page', 'seed', 'keywords', 'questions', 'competitor', 'gsc'] as const
export type StartWay = (typeof START_WAYS)[number]

export interface WayExample {
  id: StartWay
  title: string
  /** One short line, always starting with "e.g." unless the way is not available. */
  example: string
  /** The example is a URL (shown in mono). */
  url: boolean
  available: boolean
}

export interface AutopilotExample {
  /** "Reads example.com and its sitemap" */
  reads: string
  /** "Picks pages such as /pricing and /compare/… pages" */
  pages: string
  /** "Checks the rivals you named, such as A and B" */
  rivals: string
  /** "Writes 10 buyer questions, such as "…"" */
  questions: string
}

export interface StartExamples {
  autopilot: AutopilotExample
  ways: readonly WayExample[]
}

const WAY_TITLES: Record<StartWay, string> = {
  page: 'A page URL',
  seed: 'A problem or seed',
  keywords: 'Keywords & groups',
  questions: 'My own questions',
  competitor: "A competitor's page",
  gsc: 'Search Console'
}

/** `https://www.Example.com/x` → `example.com`; null when it is not a domain. */
export function cleanDomain(value: string | null | undefined): string | null {
  if (!value) return null
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0]
  return host && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null
}

function firstText(list: readonly string[] | undefined): string | null {
  const found = (list ?? []).map((item) => item.trim()).find((item) => item.length > 0)
  return found ?? null
}

function nonEmpty(list: readonly string[] | undefined): string[] {
  return (list ?? []).map((item) => item.trim()).filter((item) => item.length > 0)
}

/** "A", "A and B" (at most two names). */
function pair(names: readonly string[]): string {
  const [a, b] = names
  return b ? `${a} and ${b}` : (a ?? '')
}

/** What the autopilot will do, in the user's own terms. */
export function autopilotExample(profile: ExampleProfile): AutopilotExample {
  const domain = cleanDomain(profile.domain)
  const brand = firstText(profile.brandNames)
  const rivals = nonEmpty(profile.competitors).map((item) => cleanDomain(item) ?? item)
  const switchFrom = firstText(profile.switchingFrom)
  return {
    reads: domain ? `Reads ${domain} and its sitemap` : 'Reads your homepage and sitemap',
    pages: 'Picks the pages most likely to matter, e.g. /pricing and /compare/… pages',
    rivals:
      rivals.length > 0
        ? `Checks the rivals you named, such as ${pair(rivals)}, and finds others`
        : 'Finds your rivals and sorts them from partners',
    questions: switchFrom
      ? `Writes 10 buyer questions, such as “We’re moving off ${switchFrom}. What should we use instead?”`
      : brand
        ? `Writes 10 buyer questions in your buyers’ words, asked before they have heard of ${brand}`
        : 'Writes 10 buyer questions in your buyers’ words'
  }
}

/** One example line per way, from the profile (and a saved suggested seed when there is one). */
export function wayExamples(profile: ExampleProfile, suggestedSeed?: string | null): WayExample[] {
  const domain = cleanDomain(profile.domain)
  const brand = firstText(profile.brandNames)
  const rival = firstText(profile.competitors)
  const rivalDomain = cleanDomain(rival)
  const switchFrom = firstText(profile.switchingFrom)
  const seed = suggestedSeed?.trim()
  const lines: Record<StartWay, { example: string; url?: boolean; available?: boolean }> = {
    page: domain
      ? { example: `e.g. https://${domain}/pricing`, url: true }
      : { example: 'e.g. your pricing page' },
    seed: {
      example: seed
        ? `e.g. “${seed}”`
        : switchFrom
          ? `e.g. “replacing ${switchFrom}”`
          : brand
            ? `e.g. the problem a buyer has before they find ${brand}`
            : 'e.g. a problem your buyers have, in their words'
    },
    keywords: {
      example: switchFrom
        ? `e.g. “${switchFrom} alternative”, grouped by intent`
        : 'e.g. the terms buyers type into Google, grouped by intent'
    },
    questions: { example: 'e.g. paste lines from sales calls or support tickets' },
    competitor: rivalDomain
      ? { example: `e.g. https://${rivalDomain}/pricing`, url: true }
      : rival
        ? { example: `e.g. ${rival}’s pricing page` }
        : { example: 'e.g. a rival’s pricing or compare page' },
    gsc: { example: 'Until then, export your queries and paste them', available: false }
  }
  return START_WAYS.map((id) => ({
    id,
    title: WAY_TITLES[id],
    example: lines[id].example,
    url: lines[id].url ?? false,
    available: lines[id].available ?? true
  }))
}

export function startExamples(
  profile: ExampleProfile,
  suggestedSeed?: string | null
): StartExamples {
  return { autopilot: autopilotExample(profile), ways: wayExamples(profile, suggestedSeed) }
}

/** The example line for one way. */
export function wayExample(
  profile: ExampleProfile,
  way: StartWay,
  suggestedSeed?: string | null
): WayExample {
  const found = wayExamples(profile, suggestedSeed).find((item) => item.id === way)
  if (!found) throw new Error(`Unknown way ${way}`)
  return found
}
