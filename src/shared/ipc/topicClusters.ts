/**
 * Topics and clusters (Docs/TOPICS-SPEC.md §8): moving questions between topics,
 * tidying topics (merge, split, set a stage), creating topics without a check, and
 * the Claude suggestions that propose new topics and sort questions into them.
 *
 * Rules every channel here follows:
 * - Nothing spends a SerpApi search. A topic made here waits for Check now (or its
 *   first interval check); the screens say so.
 * - A question sits in one place: one topic, or the page it was set up on ("Not in a
 *   topic"). Moving it saves a new prompt-set version on both sides and links the new
 *   prompt to the old one (`prompt_lineage`), so its earlier checks stay its history.
 * - Claude replies change nothing until the screen applies them with a move or a create.
 */

import type { TopicStage } from '../domain'
import { invokeWith, type InvokeChannelSpecs } from './contract'
import type { TopicCallInfo } from './topics'

/** One tracked question: the page or topic it belongs to and its prompt id there. */
export interface QuestionRef {
  sourceId: string
  promptId: string
}

/**
 * Where moved questions go: a topic, a new topic with this name, or back to the page
 * each one targets (`page`, shown as "Not in a topic"). A question with no tracked
 * target page cannot go back to a page and is skipped.
 */
export type MoveDestination =
  { kind: 'topic'; topicId: string } | { kind: 'new'; name: string } | { kind: 'page' }

export interface MoveQuestionsRequest {
  projectId: string
  items: readonly QuestionRef[]
  to: MoveDestination
}

/** A question left where it was, and why in plain words. */
export interface SkippedQuestion {
  promptId: string
  reason: string
}

export interface MoveQuestionsResult {
  moved: number
  /** The topic the questions went to (the new one for `new`). Null for `page`. */
  topicId: string | null
  /** Each moved question's new prompt id, so the screen can keep it marked. */
  promptIds: readonly { from: string; to: string }[]
  skipped: readonly SkippedQuestion[]
  /** One sentence for the screen, such as "Moved 3 questions to Text alerts." */
  message: string
}

/** Sets the journey stage label of topic questions. Page questions are skipped. */
export interface SetQuestionStageRequest {
  projectId: string
  items: readonly QuestionRef[]
  /** Null clears the stage. */
  stage: TopicStage | null
}

export interface SetQuestionStageResult {
  changed: number
  skipped: readonly SkippedQuestion[]
  message: string
}

/** Moves every question of `topicId` into `intoTopicId`, then removes `topicId`. */
export interface MergeTopicRequest {
  projectId: string
  topicId: string
  intoTopicId: string
}

/**
 * One new topic per journey stage that has questions ("<topic> · Compare"). The
 * stage the topic has most questions in stays in the topic, as do questions with no
 * stage. Needs questions in at least two stages.
 */
export interface SplitTopicRequest {
  projectId: string
  topicId: string
}

export interface SplitTopicResult {
  topics: readonly { topicId: string; name: string; questions: number }[]
  /** Questions left in the original topic. */
  kept: number
  message: string
}

/** A question Claude wrote for an idea or a new topic, with its journey stage. */
export interface TopicIdeaQuestion {
  text: string
  stage: TopicStage
}

/**
 * A topic Claude suggests from the site, the buyer profile and the competitors
 * (Suggest topics). Nothing is saved until "Create N topics".
 */
export interface TopicIdea {
  /** Opaque id for ticking it in the list. */
  id: string
  name: string
  /** The buyer situation in one or two sentences; it becomes the topic's seed. */
  situation: string
  /** One example question, in the buyer's words. */
  example: string
  /** About ten questions across the journey stages, reviewed after creating. */
  questions: readonly TopicIdeaQuestion[]
  /** An own page that should be cited for it; null means a new page. */
  fitsUrl: string | null
}

export interface SuggestTopicsRequest {
  projectId: string
  /** Names already shown ("Suggest others" asks for different ones). */
  avoid?: readonly string[]
}

export interface SuggestTopicsResult {
  ideas: readonly TopicIdea[]
  /** Null when nothing was asked (no project data yet; `message` says why). */
  info: TopicCallInfo | null
  message: string | null
}

/** Creates one topic per idea with its questions; nothing is checked. */
export interface CreateTopicsRequest {
  projectId: string
  topics: readonly {
    name: string
    situation: string
    questions: readonly TopicIdeaQuestion[]
    /** Every question's target page; null for none yet. */
    targetUrl: string | null
  }[]
}

export interface CreateTopicsResult {
  topicIds: readonly string[]
  questions: number
  message: string
}

/**
 * Saves a topic from a New topic draft without checking it (the dialog's last step),
 * and moves in the tracked questions picked for it.
 */
export interface CreateFromDraftRequest {
  projectId: string
  draftId: string
  moveIn?: readonly QuestionRef[]
}

export interface CreateFromDraftResult {
  topicId: string
  /** Questions written for the topic. */
  questions: number
  /** Tracked questions moved in. */
  moved: number
  message: string
}

/** A topic Claude may sort a question into. */
export interface SortCandidate {
  id: string
  name: string
  /** The buyer situation (the topic's seed). */
  situation: string
}

/**
 * Claude proposes one topic per question ("Sort into topics with AI", and "Also move
 * in N questions you already track" in New topic, which passes the one new topic).
 */
export interface SortQuestionsRequest {
  projectId: string
  items: readonly QuestionRef[]
  /** The topics to sort into. Absent: every tracked topic of the project. */
  candidates?: readonly SortCandidate[]
  /** False only proposes candidates (no new topic names). Default true. */
  allowNew?: boolean
}

export interface SortProposal {
  sourceId: string
  promptId: string
  text: string
  /** A candidate's id, or null. */
  topicId: string | null
  /** A new topic's name when no candidate fits; null otherwise. */
  newTopic: string | null
  /** One plain line on why. */
  reason: string
}

export interface SortQuestionsResult {
  proposals: readonly SortProposal[]
  info: TopicCallInfo
}

/** A name and situation for a new topic made from these questions. */
export interface SuggestTopicNameRequest {
  projectId: string
  items: readonly QuestionRef[]
}

export interface SuggestTopicNameResult {
  name: string
  situation: string
  info: TopicCallInfo
}

/**
 * `topics:createEmpty`: a topic with a name and no question yet ("+ New empty
 * topic"). It is tracked but never checked until it has a question; questions
 * come later through + Add → Questions. `marketIds` omitted: the project's
 * default market.
 */
export interface CreateEmptyTopicRequest {
  projectId: string
  name: string
  marketIds?: readonly string[]
}

/**
 * `topics:duplicate`: a new topic with the same questions, keywords, stages,
 * target pages, markets, interval and bands. No checks or history are copied,
 * and nothing is searched until Check now. `name` omitted: "<topic> (copy)".
 */
export interface DuplicateTopicRequest {
  projectId: string
  topicId: string
  name?: string
}

/** What `topics:createEmpty` and `topics:duplicate` made. */
export interface CreatedTopicResult {
  topicId: string
  name: string
  /** Questions and keywords in the new topic (0 for an empty one). */
  questions: number
  message: string
}

/**
 * Topic folders (migration 050): the Topics dashboard's Folder › Topic tree. The user
 * makes them; a new topic lands in "No folder", and deleting a folder sends its topics
 * back there. Every folder channel answers with the whole list.
 */
export interface TopicFolder {
  id: string
  name: string
  /** ISO-8601 UTC. Folders are listed oldest first. */
  createdAt: string
  /** Topics in this folder (removed topics included; screens filter them). */
  topicIds: readonly string[]
}

export interface TopicFolderList {
  projectId: string
  folders: readonly TopicFolder[]
}

export interface CreateTopicFolderRequest {
  projectId: string
  name: string
  /** Topics to move into the new folder at once ("Move to folder › New folder…"). */
  topicIds?: readonly string[]
}

export interface RenameTopicFolderRequest {
  projectId: string
  folderId: string
  name: string
}

export interface DeleteTopicFolderRequest {
  projectId: string
  folderId: string
}

export interface MoveTopicsToFolderRequest {
  projectId: string
  topicIds: readonly string[]
  /** Null moves them back to "No folder". */
  folderId: string | null
}

/** Invoke channels for this area. Each one is declared here only. */
export const topicClustersChannels = {
  'topics:moveQuestions': invokeWith<MoveQuestionsRequest, MoveQuestionsResult>(),
  'topics:setQuestionStage': invokeWith<SetQuestionStageRequest, SetQuestionStageResult>(),
  'topics:merge': invokeWith<MergeTopicRequest, MoveQuestionsResult>(),
  'topics:split': invokeWith<SplitTopicRequest, SplitTopicResult>(),
  'topics:createTopics': invokeWith<CreateTopicsRequest, CreateTopicsResult>(),
  'topics:createFromDraft': invokeWith<CreateFromDraftRequest, CreateFromDraftResult>(),
  'topics:suggestTopics': invokeWith<SuggestTopicsRequest, SuggestTopicsResult>(),
  'topics:sortQuestions': invokeWith<SortQuestionsRequest, SortQuestionsResult>(),
  'topics:suggestName': invokeWith<SuggestTopicNameRequest, SuggestTopicNameResult>(),
  'topics:createEmpty': invokeWith<CreateEmptyTopicRequest, CreatedTopicResult>(),
  'topics:duplicate': invokeWith<DuplicateTopicRequest, CreatedTopicResult>(),
  'topics:folders': invokeWith<{ projectId: string }, TopicFolderList>(),
  'topics:createFolder': invokeWith<CreateTopicFolderRequest, TopicFolderList>(),
  'topics:renameFolder': invokeWith<RenameTopicFolderRequest, TopicFolderList>(),
  'topics:deleteFolder': invokeWith<DeleteTopicFolderRequest, TopicFolderList>(),
  'topics:moveToFolder': invokeWith<MoveTopicsToFolderRequest, TopicFolderList>()
} as const satisfies InvokeChannelSpecs
