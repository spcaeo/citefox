import type { AioReference } from '@shared/domain'
import { brandNamed } from '../../engine/checks/classify'
import { hostOf, normalizeUrl } from '../../engine/checks/url'
import { loadEvidence } from '../../communities/evidence'
import { replyStateOf } from '../../communities/report'
import { redditThreadOf } from '../../communities/source-type'
import { listRedditThreads } from '../../communities/store'
import { wordCount } from '../../pipeline/hash'
import { getLatestSnapshot } from '../../storage/content-records'
import { getPage } from '../../storage/pages'
import { AssistInputError, type AssistContext, type AssistDefinition } from '../types'
import { brandNamesOf, day, formatPageBody, formatPageHead, inputText, projectOf } from './gather'
import { checkTags } from './rules'

/** Page text sent with a reply draft: enough for facts, short of the full page. */
const REPLY_PAGE_TEXT_MAX = 4000

/** Words in the answer part. Reddit replies that run longer read as marketing. */
export const REPLY_ANSWER_MAX_WORDS = 220

/**
 * Communities assists (FR-17.6). CiteFox never posts (FR-17.7): every draft is
 * text the user copies and posts themselves.
 */
export const COMMUNITY_ASSISTS: readonly AssistDefinition[] = [
  {
    id: 'communities.reply',
    title: 'Draft a helpful reply',
    expectedSeconds: 10,
    acceptsInstruction: true,
    needsProject: true,
    minItems: 2,
    maxItems: 2,
    task: `Draft a reply the user can post themselves in this Reddit thread. CiteFox never posts; the user copies the draft.
Give exactly two items, in this order:
1. tag "answer": answer the thread's question first, plainly and specifically, as a helpful person would. Use facts from the page under "Page to point to" where they fit. Do not name the user's brand or website in the first sentence, and do not sell. At most ${REPLY_ANSWER_MAX_WORDS} words.
2. tag "disclosure": one or two sentences that say who the user is, naming the brand (for example "Full disclosure: I work at <brand>."), and, only if it helps the reader, the one page link under "Page to point to".
Follow the subreddit's rules on self-promotion: no hard sell, no discount codes, no calls to sign up, no links other than that one page, and never pretend to be an unrelated customer.
Write in the thread's language. Use the thread excerpt to answer what was actually asked; if there is no excerpt, answer the buyer prompts listed below.
Put the subreddit name in summary as "Draft reply for <subreddit>". In caution, remind the user to read the subreddit's rules before posting.`,
    gather(context) {
      const thread = threadOf(context)
      const opened = projectOf(context)
      const brands = brandNamesOf(opened.db)
      const lines = [
        `Thread: ${thread.title ?? '(no title saved)'}`,
        `Subreddit: ${thread.subreddit ?? '(unknown)'}`,
        `Thread link: ${thread.url}`,
        `Can the user reply: ${thread.replyState === 'open' ? 'yes, the thread is open' : 'not checked yet'}`,
        '',
        'Thread excerpt (title and top post, from public Reddit data):',
        thread.excerpt ?? '(not read yet: Check threads reads the post text)',
        '',
        'Buyer prompts whose Google AI Overview cites this thread:',
        ...thread.prompts.map((line) => `- ${line}`),
        '',
        `Who the user is: someone who works at ${opened.project.name} (${opened.project.domain}).`,
        `Brand names: ${brands.join(', ') || opened.project.name}`,
        ''
      ]
      const page = pageFor(context, thread.pageIds)
      if (page === null) {
        lines.push('Page to point to: (none saved)')
      } else {
        lines.push(`Page to point to: ${page.url}`)
        const snapshot = getLatestSnapshot(opened.db, page.id)
        if (snapshot !== null) {
          lines.push(
            formatPageHead(page, snapshot),
            '',
            formatPageBody(snapshot, REPLY_PAGE_TEXT_MAX)
          )
        }
      }
      return lines.join('\n')
    },
    check(reply, context) {
      const tags = reply.items.map((item) => item.tag?.toLowerCase() ?? '')
      const tagged =
        checkTags(reply, ['answer', 'disclosure'], 'Tag the items "answer" and "disclosure".') ??
        (tags[0] === 'answer' && tags[1] === 'disclosure'
          ? null
          : 'Give the answer first and the disclosure second.')
      if (tagged !== null) return tagged
      const opened = projectOf(context)
      const names = [...brandNamesOf(opened.db), opened.project.name]
      const [answer, disclosure] = reply.items
      const domain = opened.project.domain.toLowerCase()
      const mentionsUser = (text: string): boolean =>
        brandNamed(text, names) || text.toLowerCase().includes(domain)
      const firstSentence = (answer?.text ?? '').split(/(?<=[.!?])\s/u)[0] ?? ''
      if (mentionsUser(firstSentence)) {
        return 'Answer the question first: leave the brand out of the first sentence.'
      }
      if (wordCount(answer?.text ?? '') > REPLY_ANSWER_MAX_WORDS) {
        return `Keep the answer under ${REPLY_ANSWER_MAX_WORDS} words.`
      }
      if (!mentionsUser(disclosure?.text ?? '')) {
        return 'Say who the user is in the disclosure, naming the brand.'
      }
      const links = reply.items.flatMap((item) =>
        [item.text, item.detail ?? ''].flatMap(
          (text) => text.match(/https?:\/\/[^\s)\]>"']+/giu) ?? []
        )
      )
      const ownHost = hostOf(`https://${domain}`)
      if (links.length > 1 || links.some((link) => !isOwnLink(link, ownHost))) {
        return `Link at most once, and only to a page on ${opened.project.domain}.`
      }
      return null
    }
  }
]

interface ThreadFacts {
  url: string
  title: string | null
  subreddit: string | null
  excerpt: string | null
  replyState: ReturnType<typeof replyStateOf>
  /** One readable line per answer citing it. */
  prompts: string[]
  pageIds: string[]
}

/** The cited thread named by `inputs.threadUrl`, from saved checks and the Check threads cache. */
function threadOf(context: AssistContext): ThreadFacts {
  const opened = projectOf(context)
  const raw = inputText(context, 'threadUrl', 2000)
  if (raw === null) {
    throw new AssistInputError('Pick a thread first.', 'Select Draft a helpful reply on a thread.')
  }
  // The same thread can be linked as reddit.com, old.reddit.com or with a slug: match the post id.
  const wantedUrls = new Set([raw, normalizeUrl(raw) ?? raw])
  const wantedId = redditThreadOf(raw)?.threadId ?? null
  const matches = (ref: AioReference): boolean =>
    ref.sourceType === 'reddit' &&
    (wantedUrls.has(ref.normalizedUrl) ||
      (wantedId !== null && redditThreadOf(ref.normalizedUrl)?.threadId === wantedId))
  const evidence = loadEvidence(opened.db, opened.project.domain, {
    projectId: opened.project.id,
    pageId: null,
    marketId: null,
    depth: 1
  })
  const citing = evidence.answers.filter((answer) => answer.references.some(matches))
  const reference = citing.flatMap((answer) => answer.references).find(matches)
  if (reference === undefined) {
    throw new AssistInputError(
      'That thread is not cited in the latest checks.',
      'Press Check now, then pick a thread from the Reddit list.'
    )
  }
  const cached = listRedditThreads(opened.db).get(reference.normalizedUrl)
  const replyState = replyStateOf(cached)
  if (replyState === 'archived' || replyState === 'locked') {
    throw new AssistInputError(
      `This thread is ${replyState}, so Reddit takes no new replies.`,
      'Pick an open thread.'
    )
  }
  const markets = new Map(evidence.markets.map((market) => [market.id, market]))
  const prompts = [
    ...new Set(
      citing.map((answer) => {
        const market = markets.get(answer.aio.marketId)
        const where = market ? `${market.country} · ${market.language}` : answer.aio.marketId
        return `"${answer.aio.text}" (${where}, checked ${day(answer.aio.checkedAt)})`
      })
    )
  ]
  return {
    url: reference.normalizedUrl,
    title: reference.title ?? cached?.title ?? null,
    subreddit: redditThreadOf(reference.normalizedUrl)?.subreddit ?? cached?.subreddit ?? null,
    excerpt: cached?.error === null ? cached.excerpt : null,
    replyState,
    prompts,
    pageIds: [...new Set(citing.map((answer) => answer.aio.pageId))]
  }
}

/** The page the screen is on, else the first page whose answers cite the thread. */
function pageFor(
  context: AssistContext,
  citingPageIds: readonly string[]
): ReturnType<typeof getPage> {
  const opened = projectOf(context)
  for (const pageId of [context.request.pageId, ...citingPageIds]) {
    if (pageId === null) continue
    const page = getPage(opened.db, pageId, opened.project.id)
    if (page !== null) return page
  }
  return null
}

function isOwnLink(link: string, ownHost: string): boolean {
  const host = hostOf(link)
  return host.length > 0 && (host === ownHost || host.endsWith(`.${ownHost}`))
}
