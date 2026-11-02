import type { AioReference, CitationOwner } from '@shared/domain'
import { isOwnHost } from '../engine/checks/classify'
import type { EvidenceProfile } from './evidence'

/**
 * REPORT-SPEC §8 "Who Google leans on". Own pages, counted subdomains included,
 * are yours; a source the check stored as a competitor (of the page's product, when
 * it ran: Docs/PROMPT-AUDIT.md P9) is a competitor; everyone else is external. The
 * stored class wins over today's list, so these counts match Results and the export.
 * Own citations are never counted twice (section 7.4).
 */
export function ownerOf(reference: AioReference, profile: EvidenceProfile): CitationOwner {
  if (reference.classification === 'target' || reference.classification === 'own') return 'yours'
  if (isOwnHost(reference.domain, profile.domain, profile.includeSubdomains)) return 'yours'
  if (reference.classification === 'competitor') return 'competitor'
  return 'external'
}
