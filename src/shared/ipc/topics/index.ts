/**
 * Topics (cluster checking) and keywords & groups (Docs/TOPICS-SPEC.md sections 2–6).
 *
 * Rules every channel here follows:
 * - Nothing spends a SerpApi search except `topics:start` (which starts a check
 *   job through the queue). Discover, generate and match read saved data and the
 *   project's site (Jina or a direct read), never Google.
 * - AI suggestions come back apart (`…Suggestion` lists) and change nothing until
 *   the screen applies them with `topics:updateDraft`. The exception is a step's
 *   own primary action (Write buyer profile, Write questions, Generate keywords,
 *   Match pages, Read their page, Questions from their page), which writes the
 *   draft and returns it.
 * - Claude calls go through the project's connection and are logged in
 *   `llm_calls`; `topics:describeStep` gives the "Claude · about N s" label and
 *   what the step reads. Long multi-call steps push `topics:progress`.
 * - Questions and keywords never contain the brand or an alias: generated text
 *   naming one is dropped (or flagged `brand` for user and imported text).
 */

export * from './types'
export * from './draft'
export * from './steps'
export * from './pages'
export * from './results'
export * from './channels'
