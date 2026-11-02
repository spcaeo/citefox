/**
 * Communities (SRS §4.17) and YouTube opportunities (§4.18).
 * Every count says its unit: `aios` are prompts with an AI Overview (one per
 * prompt, market and check), `citations` are links. A drill is a list of
 * {@link CommunityAio} keys, and its length is the number shown (NFR-14).
 */

import type { CitationSourceType, PromptCheckStatus } from './checks'
import type { Market } from './projects'
import { isOneOf } from './one-of'

/** FR-17.2. This page, or every tracked page in the project. */
const COMMUNITY_SCOPES = ['page', 'project'] as const

export type CommunityScope = (typeof COMMUNITY_SCOPES)[number]

/** REPORT-SPEC §8 "Who Google leans on". `yours` includes the target page. */
const CITATION_OWNERS = ['yours', 'competitor', 'external'] as const

export type CitationOwner = (typeof CITATION_OWNERS)[number]

/** FR-17.4 and REPORT-SPEC §8. `unchecked` until public Reddit data was read. */
const REDDIT_REPLY_STATES = ['open', 'archived', 'locked', 'unchecked'] as const

export type RedditReplyState = (typeof REDDIT_REPLY_STATES)[number]

/** Most characters kept of a thread's title and top post (FR-17.4 extras). */
export const THREAD_EXCERPT_MAX = 600

/** Most characters kept of the sentence that names the brand in a thread. */
export const THREAD_QUOTE_MAX = 280

/** FR-17.1 source types in the order the source mix shows them. */
export const SOURCE_MIX_ORDER: readonly CitationSourceType[] = [
  'web',
  'reddit',
  'youtube',
  'linkedin',
  'review',
  'forum',
  'other'
]

/** Community source types listed on the tab (FR-17.3). */
export const COMMUNITY_SOURCE_TYPES = ['reddit', 'youtube', 'linkedin', 'forum', 'review'] as const

export type CommunitySourceType = (typeof COMMUNITY_SOURCE_TYPES)[number]

/** FR-17.5. The opportunities list covers these three. */
export const OPPORTUNITY_SOURCE_TYPES = ['reddit', 'youtube', 'linkedin'] as const

export type OpportunitySourceType = (typeof OPPORTUNITY_SOURCE_TYPES)[number]

/**
 * One AI Overview answer: one prompt, in one market, in one check.
 * `key` is `<runId>|<promptId>` and is unique across the report.
 */
export interface CommunityAio {
  key: string
  runId: string
  pageId: string
  /** Page label, title, or URL path, for project scope rows. */
  pageLabel: string
  marketId: string
  promptId: string
  promptPosition: number
  label: string
  text: string
  status: PromptCheckStatus
  named: boolean | null
  /** ISO-8601 UTC finish time of that check. */
  checkedAt: string
  /** True for the newest full check of that page and market. */
  latest: boolean
}

/**
 * One citation: one cited link in one answer (one per distinct URL per
 * answer). Every citation count on the tab is a filter of these, so a
 * citation number drills to exactly the links it counts (NFR-14).
 */
export interface CommunityLink {
  /** The {@link CommunityAio} it sits in. */
  aioKey: string
  /** The check column ({@link SourceMixCheck.index}) of that answer. */
  checkIndex: number
  /** The link as Google listed it. */
  url: string
  /** Normalized URL: the same link in another answer or check has the same value. */
  normalizedUrl: string
  domain: string
  title: string | null
  /** 1-based place in the answer's sources. */
  position: number
  type: CitationSourceType
  owner: CitationOwner
}

/** One source type's share of one check. */
export interface SourceMixSegment {
  type: CitationSourceType
  /** Links of this type, one per distinct URL per answer. */
  citations: number
  /** Answers citing at least one link of this type. Same length as `aioKeys`. */
  aios: number
  aioKeys: readonly string[]
}

/** REPORT-SPEC §8 yours / competitor / external split for one check. */
export interface SourceOwnerSegment {
  owner: CitationOwner
  citations: number
  aios: number
  aioKeys: readonly string[]
}

/**
 * FR-17.2. One check column. In page scope it is one run per market (the
 * same check date); in project scope it is each page's Nth-newest full check.
 * `index` 0 is the newest.
 */
export interface SourceMixCheck {
  index: number
  /** ISO-8601 UTC of the oldest and newest run in this column. */
  from: string
  to: string
  /** Answers with an AI Overview in this column. Same length as `aioKeys`. */
  aios: number
  aioKeys: readonly string[]
  citations: number
  /** One per source type, in a fixed order. Segments add up to `citations`. */
  types: readonly SourceMixSegment[]
  owners: readonly SourceOwnerSegment[]
}

/**
 * FR-17.3 "First seen": the first stored check that cited a source, and the
 * buyer prompt in it (the lowest prompt position when several cite it), so
 * the date opens that answer's Prompt detail pinned to that check.
 */
export interface CommunityFirstSeen {
  runId: string
  pageId: string
  marketId: string
  promptId: string
  promptPosition: number
  /** ISO-8601 UTC finish time of that check. Same as `firstSeenAt`. */
  checkedAt: string
}

/** Fields every cited community source has (FR-17.3). */
export interface CommunitySourceBase {
  /** Normalized URL. The row key. */
  url: string
  title: string | null
  /** Latest-check answers citing it, in scope. Same length as `aioKeys`. */
  timesCited: number
  aioKeys: readonly string[]
  /** Answers among `aioKeys` that do not cite your domain (REPORT-SPEC §8 gap). */
  gap: number
  gapKeys: readonly string[]
  /** Distinct prompt positions among `aioKeys` (page scope column). */
  promptPositions: readonly number[]
  /** Distinct tracked pages among `aioKeys` (project scope column). */
  pageCount: number
  marketIds: readonly string[]
  /** ISO-8601 UTC of the first stored check that cited it, any market. */
  firstSeenAt: string | null
  /** The check and prompt behind `firstSeenAt`. Null when it cannot be told from stored data. */
  firstSeenIn: CommunityFirstSeen | null
  /** Answers among `aioKeys` whose text names the brand. */
  namedInOverview: number
}

/** FR-17.3 and FR-17.4. A cited Reddit thread. */
export interface CommunityThread extends CommunitySourceBase {
  subreddit: string | null
  threadId: string | null
  replyState: RedditReplyState
  /** From public Reddit data, when fetched. */
  comments: number | null
  upvotes: number | null
  /** ISO-8601 UTC the thread was posted, when fetched. */
  postedAt: string | null
  /** Brand named in the thread title, post, or comments. Null until fetched. */
  brandInThread: boolean | null
  /**
   * The first sentence (title, post, then comments) that names the brand,
   * trimmed to {@link THREAD_QUOTE_MAX} characters. Null when the brand is not
   * named or the thread was read before excerpts were kept.
   */
  brandQuote: string | null
  /**
   * Title and the top post's text from public Reddit data, trimmed to
   * {@link THREAD_EXCERPT_MAX} characters. Null until fetched.
   */
  excerpt: string | null
  /** ISO-8601 UTC of the last fetch. Null when never fetched. */
  checkedAt: string | null
}

/** FR-17.3, FR-11.9. A cited YouTube video, counted once by video id. */
export interface CommunityVideo extends CommunitySourceBase {
  videoId: string
  /** From the YouTube Data API, when the user has a key. */
  channelTitle: string | null
  channelId: string | null
  views: number | null
  publishedAt: string | null
  durationSeconds: number | null
  /** The user's own channel, or a video the user is tracking on the YouTube screen. */
  yours: boolean
}

export type LinkedinPostKind = 'post' | 'article' | 'newsletter' | 'profile' | 'other'

/** FR-17.3. A cited LinkedIn post or article. Author names are not shown. */
export interface CommunityPost extends CommunitySourceBase {
  kind: LinkedinPostKind
}

/** FR-17.3. A discussion on a forum other than Reddit, or a review-site page. */
export interface CommunityDiscussion extends CommunitySourceBase {
  site: string
  type: 'forum' | 'review'
}

/** FR-17.5. One answer that cites a community source and not the page. */
export interface CommunityOpportunity {
  rank: number
  aioKey: string
  /** The community source that ranks highest in that answer. */
  sourceType: OpportunitySourceType
  sourceUrl: string
  sourceTitle: string | null
  /** Subreddit, YouTube channel, or "LinkedIn article". */
  channel: string
  /** Its 1-based place in the answer's sources. */
  sourcePosition: number
  /** Other community sources in the same answer. */
  otherSources: number
  /** Visibility points the page would gain if it were cited (section 7.1). */
  gainPoints: number
  action: string
  why: string
}

/** Extras the report could add, and why not when it did not. */
export interface CommunityExtras {
  /** True when a YouTube Data API key is stored and on (FR-11.9). */
  youtubeKey: boolean
  /** The channel id or handle the project calls its own. Null when unset. */
  ownChannel: string | null
  /** Threads with `replyState` other than `unchecked`. */
  threadsChecked: number
  /** Videos with views from the API. */
  videosWithDetails: number
}

/** `communities:get`. */
export interface CommunitiesReport {
  projectId: string
  scope: CommunityScope
  /** Set for page scope. */
  pageId: string | null
  /** Null is every market. */
  marketId: string | null
  /** ISO-8601 UTC. */
  builtAt: string
  /** Newest check in scope. Null when nothing has been checked. */
  checkedAt: string | null
  brandNames: readonly string[]
  domain: string
  /** Every market in the project, for labels and the market picker. */
  markets: readonly Market[]
  /** Tracked pages with at least one check in scope. */
  pageCount: number
  /** Every answer any number below can drill to. */
  aios: readonly CommunityAio[]
  /** Every citation in `checks`, so citation counts drill to their links. */
  links: readonly CommunityLink[]
  /** Newest first, at most three. */
  checks: readonly SourceMixCheck[]
  reddit: readonly CommunityThread[]
  youtube: readonly CommunityVideo[]
  linkedin: readonly CommunityPost[]
  forums: readonly CommunityDiscussion[]
  opportunities: readonly CommunityOpportunity[]
  extras: CommunityExtras
}

/** `communities:checkThreads`. The counts add up to the threads asked for. */
export interface ThreadCheckResult {
  checked: number
  /** Fetched within the cache window, so not fetched again. */
  cached: number
  failed: number
  /** Left out because Reddit asked CiteFox to slow down, or the per-run cap was reached. */
  skipped: number
  message: string | null
}

/** `communities:refreshVideos`. */
export interface VideoDetailsResult {
  fetched: number
  missingKey: boolean
  message: string | null
}

/** `communities:getSettings` and `communities:setSettings`. One row per project. */
export interface CommunitySettings {
  /** A channel id (`UC…`) or handle (`@name`). Null when unset. */
  youtubeChannel: string | null
}

/** FR-18.2. A video idea's step. `idea` is a suggestion nobody has acted on yet. */
export const VIDEO_STEPS = ['idea', 'brief', 'sent', 'published', 'tracking'] as const

export type VideoStep = (typeof VIDEO_STEPS)[number]

/** FR-18.6. The pre-publish checklist, in order. */
export const VIDEO_CHECKLIST_ITEMS = [
  'title_wording',
  'chapters',
  'captions',
  'description_link',
  'embedded',
  'video_object',
  'faq_link'
] as const

export type VideoChecklistItem = (typeof VIDEO_CHECKLIST_ITEMS)[number]

/** One chapter marker. `at` is `mm:ss`. */
export interface VideoChapter {
  at: string
  name: string
}

/** One script line. `source` is a {@link VideoBriefSource} number, or null for framing lines. */
export interface VideoScriptLine {
  at: string
  text: string
  source: number | null
}

/**
 * Where a claim comes from (FR-18.4). `onPage` false flags a claim the page
 * does not make: add it to the page or cut the line before publishing.
 */
export interface VideoBriefSource {
  n: number
  section: string
  onPage: boolean
}

export interface VideoScene {
  n: number
  name: string
  at: string
  kind: 'card' | 'screenshot' | 'demo' | 'slide'
  note: string
}

/** FR-18.4 brief, written by the `video_brief` template. */
export interface VideoBrief {
  title: string
  hook: string
  chapters: readonly VideoChapter[]
  script: readonly VideoScriptLine[]
  sources: readonly VideoBriefSource[]
  description: string
  thumbnailText: string
  tags: readonly string[]
  scenes: readonly VideoScene[]
  /** ISO-8601 UTC. */
  writtenAt: string
  templateHash: string
}

/** A video cited now in an idea's answers. */
export interface VideoCitedNow {
  videoId: string
  url: string
  title: string | null
  channelTitle: string | null
  yours: boolean
}

/** FR-18.7. How often answers cite the tracked video, before tracking and now. */
export interface VideoTrackingCounts {
  /** Answers in the idea's prompts at the check before tracking began. Null when none. */
  beforeAt: string | null
  beforeCiting: number | null
  beforeAios: number | null
  nowAt: string | null
  nowCiting: number
  nowAios: number
  /** Latest answers citing the video. Same length as `nowCiting`. */
  nowKeys: readonly string[]
  /** Latest answers in the idea's prompts that do not cite it. */
  openKeys: readonly string[]
  /** Answers citing the video at the check before tracking. Same length as `beforeCiting`. */
  beforeKeys?: readonly string[]
}

/** FR-18.2, FR-18.3. One video idea, suggested or saved. */
export interface VideoIdea {
  id: string
  /** False for a suggestion that is computed from evidence and not saved yet. */
  saved: boolean
  step: VideoStep
  question: string
  pageId: string
  pageLabel: string
  pageUrl: string
  /** The idea's prompts on any tracked page. The first is the question's prompt. */
  promptIds: readonly string[]
  promptPositions: readonly number[]
  /** Each prompt with the page it belongs to, for links to Prompt detail. */
  prompts?: readonly { promptId: string; pageId: string; position: number }[]
  /** Latest answers in these prompts that cite a YouTube video. Same length as `evidenceKeys`. */
  evidence: number
  evidenceKeys: readonly string[]
  /** Distinct pages behind `evidenceKeys`. */
  evidencePages: number
  marketIds: readonly string[]
  videos: readonly VideoCitedNow[]
  /** At least one cited video is not yours. */
  competitorVideo: boolean
  /** `YYYY-MM-DD` the user set. Null when the idea has no deadline. */
  deadline: string | null
  brief: VideoBrief | null
  checklist: readonly VideoChecklistItem[]
  sentToFoxcueAt: string | null
  videoUrl: string | null
  trackingStartedAt: string | null
  tracking: VideoTrackingCounts | null
}

/** FR-18.1. Counts are answers (prompts with an AI Overview) in the latest checks. */
export interface VideoStats {
  aiosShown: number
  aiosShownKeys: readonly string[]
  /** Prompt × market pairs tracked in scope, AI Overview or not. */
  prompts: number
  citingVideo: number
  citingVideoKeys: readonly string[]
  citingYours: number
  citingYoursKeys: readonly string[]
  /** Answers citing a video that is not yours. */
  openSlots: number
  openSlotKeys: readonly string[]
  /** Distinct channels of videos that are not yours. Null without a YouTube key. */
  competitorChannels: number | null
  competitorChannelNames: readonly string[]
  /** Per channel in `competitorChannelNames`: the answers citing one of its videos. */
  competitorChannelKeys?: readonly { name: string; keys: readonly string[] }[]
}

/** `videos:get`. */
export interface VideoScreen {
  projectId: string
  pageId: string | null
  marketId: string | null
  builtAt: string
  checkedAt: string | null
  /** Every market in the project, for labels and the market picker. */
  markets: readonly Market[]
  aios: readonly CommunityAio[]
  stats: VideoStats
  /** Ranked by evidence, saved ideas included. */
  ideas: readonly VideoIdea[]
  extras: CommunityExtras
}

export function isCommunityScope(value: string): value is CommunityScope {
  return isOneOf(COMMUNITY_SCOPES, value)
}

export function isCitationOwner(value: string): value is CitationOwner {
  return isOneOf(CITATION_OWNERS, value)
}

export function isRedditReplyState(value: string): value is RedditReplyState {
  return isOneOf(REDDIT_REPLY_STATES, value)
}

export function isVideoStep(value: string): value is VideoStep {
  return isOneOf(VIDEO_STEPS, value)
}

export function isVideoChecklistItem(value: string): value is VideoChecklistItem {
  return isOneOf(VIDEO_CHECKLIST_ITEMS, value)
}
