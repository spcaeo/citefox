import type { SetupContext, SetupRow } from '@shared/ipc'
import { bareDomain } from '../../engine/competitor-domains'
import { cleanHost } from '@shared/competitor-hosts'
import {
  backedBy,
  canCheckText,
  fold,
  ordinaryName,
  siteSays,
  unbackedNumbers,
  withoutGuessedSizes
} from '../../engine/site-grounding'
import { isOwnName } from './rows'
import type { SiteGround } from './types'

/**
 * The code checks the section cards share (prompt bench report 2026-10-31): a row is
 * held to what the site read saw. Each check is off when the site is unknown or too
 * little text was read, so a row is never dropped for lack of evidence we did not have.
 */

/** The business's main name: the read's first brand, else the context's, else the domain. */
export function mainBrand(context: SetupContext, ground: SiteGround): string {
  const first = ground.facts?.brands[0] ?? context.brands[0]
  if (first !== undefined && first.trim().length > 0) return first.trim()
  return bareDomain(cleanHost(context.domain)).split('.')[0] ?? context.domain
}

/** True for one of the business's own names or products (an integration is never one). */
export function isOwnProduct(name: string, context: SetupContext, ground: SiteGround): boolean {
  if (isOwnName(name, context)) return true
  const key = fold(name)
  const own = [...(ground.facts?.brands ?? []), ...context.brands].map(fold).filter(Boolean)
  if (own.includes(key)) return true
  // "Acme Pay" for Acme: a name that starts with the main brand as a word ("LinearB" is
  // not Linear's).
  const main = mainBrand(context, ground).toLowerCase()
  const raw = name.trim().toLowerCase()
  return (
    fold(main).length >= 3 &&
    raw.length > main.length &&
    raw.startsWith(main) &&
    /[^\p{L}\p{N}]/u.test(raw.charAt(main.length))
  )
}

/** A legal-entity name ("Acme Inc", "Acme, LLC"). */
const LEGAL = /[\s,]+(?:inc|llc|l\.l\.c|ltd|limited|corp|corporation|gmbh|co|plc|s\.a|ag|pty)\.?$/iu
/** A host-like name ("acme.com"). */
const HOSTISH = /^[\p{L}\p{N}-]+\.(?:com|io|so|app|ai|co|net|org|dev|us|ca)$/iu

/**
 * Brands kept to names on the site (bench pattern 3): no legal names, no domain variant of
 * a kept name, no single word that only cuts the main name short ("Cal" for Cal.com), at
 * most one other spelling of the main name, and (with enough page text) only names the
 * pages show. The read's own brands that the reply missed are added back.
 */
export function finishBrands(
  rows: readonly SetupRow[],
  context: SetupContext,
  ground: SiteGround
): { rows: SetupRow[]; warnings: string[] } {
  const main = mainBrand(context, ground)
  const mainKey = fold(main)
  const check = canCheckText(ground.check) ? ground.check : null
  const dropped: string[] = []
  const kept: SetupRow[] = []
  const keys = new Set<string>()
  let variants = 0
  const candidates = [...rows]
  for (const name of ground.facts?.brands ?? []) {
    if (!candidates.some((row) => fold(row.name) === fold(name))) {
      candidates.push({ name, detail: '', url: null, tag: null })
    }
  }
  for (const row of candidates) {
    const name = row.name.trim()
    const key = fold(name)
    const reason = brandProblem(name, key, mainKey, check, main, ground.check)
    if (reason !== null) {
      dropped.push(name)
      continue
    }
    if (keys.has(key)) {
      // The same name spelled another way: one other spelling of the main name only.
      if (key !== mainKey || variants >= 1 || kept.some((item) => item.name === name)) continue
      variants += 1
    }
    keys.add(key)
    kept.push(row)
  }
  // A bare product word ("Mail") goes when its branded name ("Zoho Mail") is kept.
  const brandedKeys = new Set(kept.map((row) => fold(row.name)))
  const plain = kept.filter(
    (row) => /\s/u.test(row.name.trim()) || !brandedKeys.has(fold(`${main}${row.name}`))
  )
  kept.splice(0, kept.length, ...plain)
  const warnings =
    dropped.length === 0
      ? []
      : [
          `Left out ${dropped.length === 1 ? 'a name' : `${dropped.length} names`} the pages do not use this way: ${dropped.join(', ')}.`
        ]
  return { rows: kept, warnings }
}

function brandProblem(
  name: string,
  key: string,
  mainKey: string,
  check: SiteGround['check'],
  main: string,
  site: SiteGround['check']
): string | null {
  if (key.length < 2) return 'empty'
  if (LEGAL.test(name)) return 'legal name'
  if (key === mainKey) return null
  // "supabase.com" next to Supabase; "Cal.ai" next to Cal.com is its own product.
  if (HOSTISH.test(name) && fold(name.replace(/\.[a-z]+$/iu, '')) === mainKey) {
    return 'domain variant'
  }
  // "Cal" for "Cal.com", "Mint" for "Mintlify": one word that cuts the main name short.
  if (!/\s/u.test(name) && mainKey.startsWith(key)) return 'cut short'
  // "Zoho Mail" when the pages show "Mail" under the Zoho name: the brand plus a site word.
  const rest = name.toLowerCase().startsWith(`${main.toLowerCase()} `)
    ? name.slice(main.length).trim()
    : ''
  if (check !== null && !siteSays(check, name) && !(rest.length > 1 && siteSays(check, rest))) {
    return 'not on the site'
  }
  // "Storage", "Experiments", "Premium": an ordinary word, not a brand to track.
  if (ordinaryName(name, main, site)) return 'ordinary word'
  return null
}

/**
 * A buyer row held to the site (bench patterns 2 and 4): size bands and money the site
 * does not show come out of the name; with enough page text, the evidence must be words
 * copied from the pages or a real page path, and no unbacked number may stay.
 */
export function groundBuyer(
  name: string,
  detail: string,
  evidence: string,
  ground: SiteGround
): { name: string; detail: string } | null {
  const plainName = withoutGuessedSizes(name, ground.check)
  const plainDetail = withoutGuessedSizes(detail, ground.check)
  if (plainName.length < 2) return null
  if (!canCheckText(ground.check)) return { name: plainName, detail: plainDetail }
  if (!backedBy(ground.check, evidence)) return null
  if (unbackedNumbers(ground.check, plainName).length > 0) return null
  return { name: plainName, detail: plainDetail }
}

/** True when a line states a number the site does not back (checks off: false). */
export function guessesNumbers(text: string, ground: SiteGround): boolean {
  return canCheckText(ground.check) && unbackedNumbers(ground.check, text).length > 0
}

/** True when the site's pages name it (checks off: true). */
export function siteNames(name: string, ground: SiteGround): boolean {
  return !canCheckText(ground.check) || siteSays(ground.check, name)
}
