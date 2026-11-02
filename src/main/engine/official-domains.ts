import { isRecord } from '../providers/json-schema'
import { completeAssist } from './assist'
import type { AssistShape } from './assist-shapes'
import type { EngineHost } from './host'
import type { OfficialDomainAsker } from './fill-companies'
import { MAX_CANDIDATES } from './company-domain-lookup'

/**
 * One small follow-up (no pages, no search) for steps whose main reply has no
 * `officialDomain` field, such as topic seed discover: Claude lists the official domain
 * candidates it already knows for each company whose domain the site does not show.
 * Every candidate is verified (`company-domain-lookup.ts`) before it is shown.
 * The first line names the call so the e2e `claude` stand-in can answer it from
 * `src/main/assist/fixtures/company.officialDomains.json`.
 */

export const OFFICIAL_DOMAINS_ASSIST_ID = 'company.officialDomains'

const SHAPE: AssistShape = {
  example: {
    domains: [
      { name: 'Example Rival', candidates: ['examplerival.com'] },
      { name: 'Unsure Co', candidates: [] }
    ]
  },
  notes:
    'One entry per company, using the name exactly as given. candidates: up to two bare domains such as "example.com", most likely first; an empty list when you are not sure. Never a URL or a note.'
}

export function parseOfficialDomains(value: unknown): Map<string, string[]> | null {
  if (!isRecord(value) || !Array.isArray(value.domains)) return null
  const found = new Map<string, string[]>()
  for (const entry of value.domains) {
    if (!isRecord(entry) || typeof entry.name !== 'string' || !Array.isArray(entry.candidates)) {
      return null
    }
    const candidates = entry.candidates
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim())
      .slice(0, MAX_CANDIDATES)
    found.set(entry.name.trim(), candidates)
  }
  return found
}

export function officialDomainAsker(
  host: EngineHost,
  channel: string,
  projectId: string | null
): OfficialDomainAsker {
  return async (companies) => {
    const list = companies.map((item) => `- ${item.name}: ${item.reason}`).join('\n')
    const json = await completeAssist(
      host,
      channel,
      `Assist: ${OFFICIAL_DOMAINS_ASSIST_ID}\nList the official website domain of each company below, from what you already know. Do not search. Each candidate is checked before anyone sees it, so leave the list empty when you are not sure.\n\nCompanies (each with what the business's site says about it):\n${list}`,
      (value) => parseOfficialDomains(value) !== null,
      SHAPE,
      { assistId: OFFICIAL_DOMAINS_ASSIST_ID, projectId }
    )
    return parseOfficialDomains(json) ?? new Map()
  }
}
