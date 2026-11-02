import type { AnswerShapeCode } from '../../answer-shape'
import { isCitedRow } from '../../metrics/counts'
import { sampleRows } from './sample.test-helper'
import type { AnswerExtras, CitedSource } from './sources-types'

/**
 * Stored citations, answer blocks and Communities details for the sample project
 * (sample.test-helper.ts), for the Sources and Answer shape tests: a Reddit thread that
 * takes replies and one that is locked, a YouTube video with its channel, a LinkedIn
 * article, a competitor on every answer and your page where the answer cites you.
 */

const OWN = 'https://textbolt.com/pricing'
const THREAD = 'https://www.reddit.com/r/sysadmin/comments/abc123/email_to_sms/'
const LOCKED = 'https://www.reddit.com/r/voip/comments/zz9/old_thread/'
const VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=40'
const LINKEDIN = 'https://www.linkedin.com/pulse/email-sms-guide-someone'
const TWILIO = 'https://www.twilio.com/docs/sms'

function cite(url: string, who: CitedSource['who'], title: string | null = null): CitedSource {
  const type = url.includes('reddit')
    ? 'reddit'
    : url.includes('youtube')
      ? 'youtube'
      : url.includes('linkedin')
        ? 'linkedin'
        : 'web'
  return { url, domain: new URL(url).hostname.replace(/^www\./, ''), title, who, type }
}

/** Citations and blocks for every answered row of the sample (both engines, all checks). */
export function answerExtras(): AnswerExtras {
  const citations: Record<string, CitedSource[]> = {}
  const blocks: Record<string, AnswerShapeCode[]> = {}
  for (const row of sampleRows()) {
    if (row.result === 'no_answer' || row.result === 'failed') continue
    const n = Number(row.questionId.split('|q')[1])
    const list: CitedSource[] = [cite(TWILIO, 'competitor')]
    if (isCitedRow(row)) list.push(cite(row.citedUrl ?? OWN, 'you'))
    if (n % 2 === 0) list.push(cite(THREAD, 'other', 'Email to SMS now? - Reddit'))
    if (n === 3) list.push(cite(LOCKED, 'other'))
    if (n % 3 === 0) list.push(cite(VIDEO, 'other', 'How to text from email'))
    if (n === 4) list.push(cite(LINKEDIN, 'other', 'Email to SMS guide'))
    citations[row.id] = list
    if (row.engine === 'google_aio') {
      blocks[row.id] =
        n === 10
          ? []
          : n % 2 === 0 || n === 5
            ? ['A1', 'A1', 'C4', 'D2']
            : row.checkId === 'c3'
              ? ['B2', 'B3']
              : ['A1', 'B2']
    }
  }
  return {
    citations,
    blocks,
    videos: {
      dQw4w9WgXcQ: {
        title: null,
        channel: 'SMS Academy',
        views: 1200,
        publishedAt: '2025-05-01T00:00:00.000Z'
      }
    },
    threads: {
      abc123: { reply: 'open', upvotes: 42, comments: 7 },
      zz9: { reply: 'locked', upvotes: 99, comments: 3 }
    }
  }
}
