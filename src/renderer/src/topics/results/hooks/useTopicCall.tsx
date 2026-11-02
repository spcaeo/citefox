import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import type {
  DraftFixResult,
  ExplainCitationResult,
  TopicCallInfo,
  TopicSummaryResult,
  WhyNotCitedResult
} from '@shared/ipc'
import { WRITE_WITH_URL } from '@shared/ipc'
import { errorText } from '../../../components/errorText'
import { currentClientMode } from '../../../onboarding/flags'
import { SuggestionCard, type SuggestionItem } from '../../../ui'
import { topicResultsSource, type TopicResultsSource } from '../source'

/** A topic Claude step the results screens run: each one reads saved data and spends no search. */
export type TopicCallKind = 'whyNotCited' | 'explain' | 'draftFix' | 'summary'

export interface TopicCallRequest {
  kind: TopicCallKind
  /** Card title, such as "Why Q6 isn't cited". */
  title: string
  /** The prompt, for Why and Draft. */
  promptId?: string | null
}

export interface TopicCall {
  start: (request: TopicCallRequest) => void
  /** The open suggestion card, or null. */
  card: JSX.Element | null
  /** The prompt the open card is about. */
  promptId: string | null
  /** "about 8 s" per kind, from `topics:describeStep` (shipped estimate until it answers). */
  seconds: Readonly<Record<TopicCallKind, number>>
}

const STEP: Readonly<
  Record<TopicCallKind, 'why_not_cited' | 'explain_citation' | 'draft_fix' | 'topic_summary'>
> = {
  whyNotCited: 'why_not_cited',
  explain: 'explain_citation',
  draftFix: 'draft_fix',
  summary: 'topic_summary'
}

const SHIPPED: Readonly<Record<TopicCallKind, number>> = {
  whyNotCited: 8,
  explain: 5,
  draftFix: 15,
  summary: 6
}

type Done =
  | { kind: 'whyNotCited'; value: WhyNotCitedResult }
  | { kind: 'explain'; value: ExplainCitationResult }
  | { kind: 'draftFix'; value: DraftFixResult }
  | { kind: 'summary'; value: TopicSummaryResult }

function footnote(info: TopicCallInfo): string {
  const seconds = Math.max(1, Math.round(info.durationMs / 1000))
  return `CiteFox AI · about ${seconds} s · no searches`
}

function content(done: Done): { body: ReactNode; items: SuggestionItem[]; note: string } {
  switch (done.kind) {
    case 'whyNotCited':
      return {
        body: done.value.summary,
        items: [
          ...done.value.reasons.map((reason, index) => ({
            id: `reason-${index}`,
            text: reason.text,
            detail: reason.evidence
          })),
          ...done.value.citedInstead.map((item) => ({
            id: `instead-${item.domain}`,
            label: 'Cited instead',
            text: item.domain,
            detail: item.whyItWins
          }))
        ],
        note: footnote(done.value.info)
      }
    case 'explain':
      return {
        body: done.value.text,
        items: done.value.facts.map((fact, index) => ({ id: `fact-${index}`, text: fact })),
        note: footnote(done.value.info)
      }
    case 'draftFix':
      return {
        body: (
          <>
            <span className="tr-call-draft">{done.value.draft}</span>{' '}
            <a href={done.value.writeWithUrl || WRITE_WITH_URL} target="_blank" rel="noreferrer">
              Write with 1000AIOverviews
              <span className="sr-only"> (opens in your browser, sends no data)</span>
            </a>
          </>
        ),
        items: done.value.steps.map((step, index) => ({ id: `step-${index}`, text: step })),
        note: footnote(done.value.info)
      }
    case 'summary':
      return {
        body: done.value.line,
        items: done.value.nextActions.map((action, index) => ({
          id: `next-${index}`,
          label: 'Next',
          text: action.text,
          detail: action.verify ? `[Re-check] ${action.verify}` : null
        })),
        note: footnote(done.value.info)
      }
  }
}

/**
 * Runs the topic's Claude steps (`topics:whyNotCited`, `topics:draftFix`,
 * `topics:topicSummary`) from a menu and shows the answer as one dismissible
 * SuggestionCard. They read saved data, spend no search and change nothing.
 * A reply that arrives after Close, a newer run or unmount is dropped.
 */
export function useTopicCall(scope: {
  projectId: string
  topicId: string
  marketId: string | null
  /** The check a pinned view reads; null is the latest. */
  runId?: string | null
  source?: TopicResultsSource
}): TopicCall {
  const source = useMemo(
    () => scope.source ?? topicResultsSource(currentClientMode()),
    [scope.source]
  )
  const { projectId, topicId, marketId, runId } = scope
  const [request, setRequest] = useState<TopicCallRequest | null>(null)
  const [state, setState] = useState<
    { phase: 'running' } | { phase: 'done'; done: Done } | { phase: 'error'; message: string }
  >({ phase: 'running' })
  const [seconds, setSeconds] = useState<Readonly<Record<TopicCallKind, number>>>(SHIPPED)
  const seq = useRef(0)

  useEffect(() => {
    let cancelled = false
    const kinds = Object.keys(STEP) as TopicCallKind[]
    Promise.allSettled(
      kinds.map((kind) => source.describeStep({ projectId, step: STEP[kind] }))
    ).then((answers) => {
      if (cancelled) return
      const next = { ...SHIPPED }
      answers.forEach((answer, index) => {
        const kind = kinds[index]
        if (kind && answer.status === 'fulfilled') next[kind] = answer.value.label.expectedSeconds
      })
      setSeconds(next)
    })
    return () => {
      cancelled = true
      seq.current += 1
    }
  }, [source, projectId])

  const run = useCallback(
    (next: TopicCallRequest) => {
      const ticket = ++seq.current
      setState({ phase: 'running' })
      const prompt = { projectId, topicId, promptId: next.promptId ?? '', marketId }
      const call: Promise<Done> =
        next.kind === 'whyNotCited'
          ? source.whyNotCited(prompt).then((value) => ({ kind: 'whyNotCited', value }))
          : next.kind === 'explain'
            ? source
                .explainCitation({ ...prompt, runId: runId ?? null })
                .then((value) => ({ kind: 'explain', value }))
            : next.kind === 'draftFix'
              ? source.draftFix(prompt).then((value) => ({ kind: 'draftFix', value }))
              : source
                  .topicSummary({ projectId, topicId, marketId, force: true })
                  .then((value) => ({ kind: 'summary', value }))
      call.then(
        (done) => {
          if (ticket === seq.current) setState({ phase: 'done', done })
        },
        (cause: unknown) => {
          if (ticket === seq.current) {
            setState({ phase: 'error', message: errorText(cause, 'CiteFox AI could not answer.') })
          }
        }
      )
    },
    [source, projectId, topicId, marketId, runId]
  )

  const start = useCallback(
    (next: TopicCallRequest) => {
      setRequest(next)
      run(next)
    },
    [run]
  )

  let card: JSX.Element | null = null
  if (request) {
    const close = (): void => {
      seq.current += 1
      setRequest(null)
    }
    const shown = state.phase === 'done' ? content(state.done) : null
    card = (
      <SuggestionCard
        title={request.title}
        status={state.phase === 'done' ? 'ready' : state.phase}
        runningText={`CiteFox AI is working… about ${seconds[request.kind]} s · no searches`}
        error={state.phase === 'error' ? state.message : null}
        onRetry={() => run(request)}
        onClose={close}
        {...(shown ? { body: shown.body, items: shown.items, footnote: shown.note } : {})}
      />
    )
  }

  return { start, card, promptId: request?.promptId ?? null, seconds }
}
