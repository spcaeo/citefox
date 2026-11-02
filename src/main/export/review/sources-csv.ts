import type { ReportTable } from '@shared/ipc'
import type { ReviewReport } from '@shared/report/review'
import { kindWord, REPLY_WORDS } from './sections-sources'

type Cell = string | number | null

/**
 * The Sources tab's tables as CSV (`reports:download`, format `csv`): YouTube videos,
 * Reddit threads ("Can we reply?" first) and LinkedIn pages, with the counts the app
 * shows. Null for any other table.
 */
export function sourcesCsv(
  report: ReviewReport,
  table: ReportTable
): { header: string[]; rows: Cell[][] } | null {
  const { youtube, reddit, linkedin } = report.sources
  if (table === 'youtube') {
    return {
      header: ['Video', 'URL', 'Channel', 'Views', 'Citations', 'Questions', 'Gap', 'Posted'],
      rows: youtube.videos.map((row) => [
        row.title ?? '',
        row.url,
        row.channel,
        row.views,
        row.citations,
        row.questions.n,
        row.gap.n,
        row.publishedAt
      ])
    }
  }
  if (table === 'reddit') {
    return {
      header: [
        'Can we reply?',
        'Upvotes',
        'Thread',
        'URL',
        'Subreddit',
        'Comments',
        'Questions',
        'Gap',
        'Citations'
      ],
      rows: reddit.threads.map((row) => [
        REPLY_WORDS[row.reply],
        row.upvotes,
        row.title ?? '',
        row.url,
        row.subreddit,
        row.comments,
        row.questions.n,
        row.gap.n,
        row.citations
      ])
    }
  }
  if (table === 'linkedin') {
    return {
      header: ['Page', 'URL', 'Kind', 'Citations', 'Questions'],
      rows: linkedin.map((row) => [
        row.title ?? '',
        row.url,
        kindWord(row.kind),
        row.citations,
        row.questions.n
      ])
    }
  }
  return null
}
