/**
 * CiteFox's sponsors (SPONSORS.md). Sponsors fund the open-source project. This
 * is the only place their names, links, words and colours are set.
 *
 * Privacy: a sponsor link is the sponsor's URL plus the three fixed `utm_*`
 * parameters below, nothing else. CiteFox never adds user, project, page or
 * usage data, loads no remote images and sends no tracking requests. Links open
 * in the system browser (main's window-open handler).
 */

export type SponsorTier = 'gold' | 'silver'

export interface SponsorColors {
  /** Brand ground, such as FoxCue black. */
  ground: string
  /** Text and marks on `ground`. */
  ink: string
  /** The brand accent: FoxCue yellow, FreshlyCited gold. */
  accent: string
  /** Text on `accent` (contrast at least 4.5:1). */
  onAccent: string
  /** A light brand surface, when the brand has one. */
  paper?: string
}

export interface Sponsor {
  id: 'foxcue' | 'freshlycited'
  name: string
  tier: SponsorTier
  /** Home page, https only. */
  url: string
  /** One line for the top strip or the sidebar card. */
  tagline: string
  /** A plain sentence about what the sponsor does (Settings, gallery). */
  description: string
  /** Call to action on the sponsor's button. */
  cta: string
  colors: SponsorColors
}

/** The only query CiteFox adds to a sponsor link. */
export const SPONSOR_UTM = {
  utm_source: 'citefox',
  utm_medium: 'app',
  utm_campaign: 'sponsor'
} as const

export const SPONSORS: readonly Sponsor[] = [
  {
    id: 'foxcue',
    name: 'FoxCue',
    tier: 'gold',
    url: 'https://foxcue.com/',
    tagline: 'Get cited in AI answers, with you on camera',
    description: 'FoxCue turns your pages into videos AI Overviews cite.',
    cta: 'Join the waitlist',
    colors: { ground: '#0A0A0A', ink: '#FFFFFF', accent: '#FFD400', onAccent: '#0A0A0A' }
  },
  {
    id: 'freshlycited',
    name: 'FreshlyCited',
    tier: 'silver',
    url: 'https://freshlycited.com/',
    tagline: 'Help Google and Bing find your new and updated pages sooner.',
    description:
      'FreshlyCited submits new and updated pages for crawling and checks whether Google shows them.',
    cta: 'Check my pages free',
    colors: {
      ground: '#13213A',
      ink: '#FFFCF5',
      accent: '#D4AF37',
      onAccent: '#13213A',
      paper: '#FFFCF5'
    }
  }
]

/** The sponsor link: its URL with exactly {@link SPONSOR_UTM}, whatever the URL already had. */
export function sponsorHref(sponsor: Pick<Sponsor, 'url'>): string {
  const url = new URL(sponsor.url)
  url.search = ''
  url.hash = ''
  for (const [key, value] of Object.entries(SPONSOR_UTM)) url.searchParams.set(key, value)
  return url.toString()
}

/** The sponsor of a tier. Each tier has one. */
export function sponsorOf(tier: SponsorTier): Sponsor {
  const found = SPONSORS.find((sponsor) => sponsor.tier === tier)
  if (!found) throw new Error(`No ${tier} sponsor`)
  return found
}
