import type { ExportSourceExtras } from '../export/sections/sources'
import type { SqliteDatabase } from '../storage/database'
import { replyStateOf } from './report'
import { listRedditThreads, listYoutubeVideos } from './store'

/**
 * The cached Reddit and YouTube extras (FR-17.4, FR-11.9) for the export
 * `sources` block. Reads only what "Check threads" and "Get views" stored;
 * an export never fetches.
 */
export function loadExportSourceExtras(db: SqliteDatabase): ExportSourceExtras {
  const videos = new Map(
    [...listYoutubeVideos(db).values()]
      .filter((row) => !row.missing)
      .map((row) => [
        row.videoId,
        {
          title: row.title,
          channelTitle: row.channelTitle,
          views: row.views,
          publishedAt: row.publishedAt
        }
      ])
  )
  const threads = new Map(
    [...listRedditThreads(db).values()].map((row) => [
      row.url,
      {
        replyState: replyStateOf(row),
        upvotes: row.error === null ? row.upvotes : null,
        comments: row.error === null ? row.comments : null
      }
    ])
  )
  return { videos, threads }
}
