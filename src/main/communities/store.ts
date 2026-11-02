import {
  isVideoChecklistItem,
  isVideoStep,
  type CommunitySettings,
  type VideoBrief,
  type VideoChecklistItem,
  type VideoStep
} from '@shared/domain'
import type { SqliteDatabase } from '../storage/database'
import { StorageError } from '../storage/errors'

/** Rows behind Communities and YouTube (project migration 21). */

export interface RedditThreadRow {
  url: string
  threadId: string | null
  subreddit: string | null
  title: string | null
  comments: number | null
  upvotes: number | null
  archived: boolean | null
  locked: boolean | null
  postedAt: string | null
  brandNamed: boolean | null
  /** Title and top post, trimmed (project migration 26). */
  excerpt: string | null
  /** The first sentence naming the brand, trimmed. */
  brandQuote: string | null
  checkedAt: string
  error: string | null
}

export interface YoutubeVideoRow {
  videoId: string
  title: string | null
  channelId: string | null
  channelTitle: string | null
  views: number | null
  publishedAt: string | null
  durationSeconds: number | null
  fetchedAt: string
  /** The API had no such video (private or removed). */
  missing: boolean
}

export interface StoredVideoIdea {
  id: string
  question: string
  pageId: string
  promptIds: readonly string[]
  step: VideoStep
  brief: VideoBrief | null
  videoUrl: string | null
  videoId: string | null
  sentToFoxcueAt: string | null
  deadline: string | null
  checklist: readonly VideoChecklistItem[]
  trackingStartedAt: string | null
  createdAt: string
  updatedAt: string
}

interface ThreadSql {
  url: string
  thread_id: string | null
  subreddit: string | null
  title: string | null
  comments: number | null
  upvotes: number | null
  archived: number | null
  locked: number | null
  posted_at: string | null
  brand_named: number | null
  excerpt: string | null
  brand_quote: string | null
  checked_at: string
  error: string | null
}

export function listRedditThreads(db: SqliteDatabase): Map<string, RedditThreadRow> {
  const rows = db.prepare<unknown[], ThreadSql>('SELECT * FROM reddit_threads').all()
  return new Map(
    rows.map((row) => [
      row.url,
      {
        url: row.url,
        threadId: row.thread_id,
        subreddit: row.subreddit,
        title: row.title,
        comments: row.comments,
        upvotes: row.upvotes,
        archived: bool(row.archived),
        locked: bool(row.locked),
        postedAt: row.posted_at,
        brandNamed: bool(row.brand_named),
        excerpt: row.excerpt,
        brandQuote: row.brand_quote,
        checkedAt: row.checked_at,
        error: row.error
      }
    ])
  )
}

export function upsertRedditThread(db: SqliteDatabase, row: RedditThreadRow): void {
  db.prepare(
    `INSERT INTO reddit_threads (url, thread_id, subreddit, title, comments, upvotes, archived,
       locked, posted_at, brand_named, excerpt, brand_quote, checked_at, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (url) DO UPDATE SET
       thread_id = excluded.thread_id, subreddit = excluded.subreddit, title = excluded.title,
       comments = excluded.comments, upvotes = excluded.upvotes, archived = excluded.archived,
       locked = excluded.locked, posted_at = excluded.posted_at,
       brand_named = excluded.brand_named, excerpt = excluded.excerpt,
       brand_quote = excluded.brand_quote, checked_at = excluded.checked_at,
       error = excluded.error`
  ).run(
    row.url,
    row.threadId,
    row.subreddit,
    row.title,
    row.comments,
    row.upvotes,
    int(row.archived),
    int(row.locked),
    row.postedAt,
    int(row.brandNamed),
    row.excerpt,
    row.brandQuote,
    row.checkedAt,
    row.error
  )
}

interface VideoSql {
  video_id: string
  title: string | null
  channel_id: string | null
  channel_title: string | null
  views: number | null
  published_at: string | null
  duration_seconds: number | null
  fetched_at: string
  missing: number
}

export function listYoutubeVideos(db: SqliteDatabase): Map<string, YoutubeVideoRow> {
  const rows = db.prepare<unknown[], VideoSql>('SELECT * FROM youtube_videos').all()
  return new Map(
    rows.map((row) => [
      row.video_id,
      {
        videoId: row.video_id,
        title: row.title,
        channelId: row.channel_id,
        channelTitle: row.channel_title,
        views: row.views,
        publishedAt: row.published_at,
        durationSeconds: row.duration_seconds,
        fetchedAt: row.fetched_at,
        missing: row.missing === 1
      }
    ])
  )
}

export function upsertYoutubeVideo(db: SqliteDatabase, row: YoutubeVideoRow): void {
  db.prepare(
    `INSERT INTO youtube_videos (video_id, title, channel_id, channel_title, views, published_at,
       duration_seconds, fetched_at, missing)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (video_id) DO UPDATE SET
       title = excluded.title, channel_id = excluded.channel_id,
       channel_title = excluded.channel_title, views = excluded.views,
       published_at = excluded.published_at, duration_seconds = excluded.duration_seconds,
       fetched_at = excluded.fetched_at, missing = excluded.missing`
  ).run(
    row.videoId,
    row.title,
    row.channelId,
    row.channelTitle,
    row.views,
    row.publishedAt,
    row.durationSeconds,
    row.fetchedAt,
    row.missing ? 1 : 0
  )
}

export interface StoredCommunitySettings extends CommunitySettings {
  /** The channel id a handle resolved to through the API. Null until resolved. */
  youtubeChannelId: string | null
}

export function readCommunitySettings(db: SqliteDatabase): StoredCommunitySettings {
  const row = db
    .prepare<unknown[], { youtube_channel: string | null; youtube_channel_id: string | null }>(
      'SELECT youtube_channel, youtube_channel_id FROM community_settings WHERE id = 1'
    )
    .get()
  return {
    youtubeChannel: row?.youtube_channel ?? null,
    youtubeChannelId: row?.youtube_channel_id ?? null
  }
}

export function writeCommunitySettings(
  db: SqliteDatabase,
  settings: StoredCommunitySettings,
  now: string
): void {
  db.prepare(
    `INSERT INTO community_settings (id, youtube_channel, youtube_channel_id, updated_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET youtube_channel = excluded.youtube_channel,
       youtube_channel_id = excluded.youtube_channel_id, updated_at = excluded.updated_at`
  ).run(settings.youtubeChannel, settings.youtubeChannelId, now)
}

/** Where a community URL was first cited: the check and the buyer prompt in it. */
export interface FirstSeenRow {
  at: string
  runId: string
  pageId: string
  marketId: string
  promptId: string
  promptPosition: number
}

/**
 * First stored check (any market, any page) that cited each community URL,
 * and the prompt in it with the lowest position. Only finished, non-cancelled
 * runs count. Ties on the finish time go to the earlier run id.
 */
export function firstSeenByUrl(db: SqliteDatabase): Map<string, FirstSeenRow> {
  const rows = db
    .prepare<
      unknown[],
      {
        normalized_url: string
        finished_at: string
        run_id: string
        page_id: string
        market_id: string
        prompt_id: string
        position: number
      }
    >(
      `SELECT normalized_url, finished_at, run_id, page_id, market_id, prompt_id, position
       FROM (
         SELECT aio_references.normalized_url, runs.finished_at, runs.id AS run_id, runs.page_id,
           runs.market_id, serp_results.prompt_id, COALESCE(prompts.position, 0) AS position,
           ROW_NUMBER() OVER (
             PARTITION BY aio_references.normalized_url
             ORDER BY runs.finished_at, runs.id, COALESCE(prompts.position, 0), serp_results.prompt_id
           ) AS rank
         FROM aio_references
         JOIN serp_results ON serp_results.id = aio_references.serp_result_id
         JOIN runs ON runs.id = serp_results.run_id
         LEFT JOIN prompts ON prompts.id = serp_results.prompt_id
         WHERE aio_references.source_type IN ('reddit', 'youtube', 'linkedin', 'forum', 'review')
           AND runs.status = 'finished' AND runs.finished_at IS NOT NULL
       )
       WHERE rank = 1`
    )
    .all()
  const map = new Map<string, FirstSeenRow>()
  for (const row of rows) {
    map.set(row.normalized_url, {
      at: row.finished_at,
      runId: row.run_id,
      pageId: row.page_id,
      marketId: row.market_id,
      promptId: row.prompt_id,
      promptPosition: row.position
    })
  }
  return map
}

interface IdeaSql {
  id: string
  question: string
  page_id: string
  prompt_ids: string
  step: string
  brief_json: string | null
  video_url: string | null
  video_id: string | null
  sent_to_foxcue_at: string | null
  deadline: string | null
  checklist_json: string
  tracking_started_at: string | null
  created_at: string
  updated_at: string
}

export function listVideoIdeas(db: SqliteDatabase): StoredVideoIdea[] {
  return db
    .prepare<unknown[], IdeaSql>('SELECT * FROM video_ideas ORDER BY created_at ASC, id ASC')
    .all()
    .map(ideaFromSql)
}

export function getVideoIdea(db: SqliteDatabase, id: string): StoredVideoIdea | null {
  const row = db.prepare<unknown[], IdeaSql>('SELECT * FROM video_ideas WHERE id = ?').get(id)
  return row === undefined ? null : ideaFromSql(row)
}

/** Insert or replace one idea. The storyboard column mirrors `brief.scenes`. */
export function saveVideoIdea(db: SqliteDatabase, idea: StoredVideoIdea): void {
  db.prepare(
    `INSERT INTO video_ideas (id, question, page_id, prompt_ids, step, brief_json, storyboard_json,
       video_url, sent_to_foxcue_at, video_id, deadline, checklist_json, tracking_started_at,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       question = excluded.question, page_id = excluded.page_id, prompt_ids = excluded.prompt_ids,
       step = excluded.step, brief_json = excluded.brief_json,
       storyboard_json = excluded.storyboard_json, video_url = excluded.video_url,
       sent_to_foxcue_at = excluded.sent_to_foxcue_at, video_id = excluded.video_id,
       deadline = excluded.deadline, checklist_json = excluded.checklist_json,
       tracking_started_at = excluded.tracking_started_at, updated_at = excluded.updated_at`
  ).run(
    idea.id,
    idea.question,
    idea.pageId,
    JSON.stringify(idea.promptIds),
    idea.step,
    idea.brief === null ? null : JSON.stringify(idea.brief),
    idea.brief === null ? null : JSON.stringify(idea.brief.scenes),
    idea.videoUrl,
    idea.sentToFoxcueAt,
    idea.videoId,
    idea.deadline,
    JSON.stringify(idea.checklist),
    idea.trackingStartedAt,
    idea.createdAt,
    idea.updatedAt
  )
}

function ideaFromSql(row: IdeaSql): StoredVideoIdea {
  if (!isVideoStep(row.step)) throw new StorageError('Invalid video idea step')
  const promptIds = parseStringArray(row.prompt_ids)
  const checklist = parseStringArray(row.checklist_json).filter(isVideoChecklistItem)
  return {
    id: row.id,
    question: row.question,
    pageId: row.page_id,
    promptIds,
    step: row.step,
    brief: row.brief_json === null ? null : (JSON.parse(row.brief_json) as VideoBrief),
    videoUrl: row.video_url,
    videoId: row.video_id,
    sentToFoxcueAt: row.sent_to_foxcue_at,
    deadline: row.deadline,
    checklist,
    trackingStartedAt: row.tracking_started_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function parseStringArray(text: string): string[] {
  const parsed = JSON.parse(text) as unknown
  if (!Array.isArray(parsed)) throw new StorageError('Invalid stored list')
  return parsed.filter((item): item is string => typeof item === 'string')
}

function bool(value: number | null): boolean | null {
  return value === null ? null : value === 1
}

function int(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0
}
