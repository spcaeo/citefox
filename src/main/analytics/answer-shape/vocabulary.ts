import { createHash } from 'node:crypto'
import type { AnswerShapeCode } from '@shared/answer-shape'

/**
 * The fixed answer-shape vocabulary (Docs/REPORT-SPEC.md section 9). The codes, names
 * and fingerprint rules are shared (`@shared/answer-shape`) so the ready reports read
 * them too; the stored classification and its cache key live here.
 */
export {
  ANSWER_SHAPE_CODES,
  ANSWER_SHAPE_GROUPS,
  ANSWER_SHAPE_LABELS,
  fingerprintLabel,
  isAnswerShapeCode,
  shapeFingerprint,
  type AnswerShapeCode,
  type AnswerShapeGroup
} from '@shared/answer-shape'

/** One classified block of an overview, in reading order. */
export interface AnswerShapeBlock {
  code: AnswerShapeCode
  /** The block's opening words, at most 160 characters. Kept for the drawer, never re-sent. */
  excerpt: string
}

/** One stored classification. The cache key is `overviewHash` (Docs/REPORT-SPEC.md section 9). */
export interface StoredAnswerShape {
  overviewHash: string
  /** SHA-256 of the template body that classified it. */
  templateHash: string
  blocks: readonly AnswerShapeBlock[]
  /** ISO-8601 UTC. */
  classifiedAt: string
}

/**
 * The cache key for an overview: SHA-256 of its text with whitespace collapsed and
 * trimmed, so a re-captured overview with different line breaks is not re-classified.
 */
export function overviewHash(text: string): string {
  return createHash('sha256').update(text.replace(/\s+/g, ' ').trim(), 'utf8').digest('hex')
}
