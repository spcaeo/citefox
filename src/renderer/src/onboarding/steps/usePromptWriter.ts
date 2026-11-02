import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { mixTotal, sameMix, type PromptMix, type PromptShape, type SetupDraft } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { errorText } from '../../components/errorText'
import { withList } from '../sections/draftOps'
import { applyMore, applyRedo } from '../sections/merge'
import type { SetupSectionClient } from '../sectionClient'
import { contextFromDraft, rowOf, rulesOf } from '../setupDraft'

export const SHAPE_NOUN: Readonly<Record<PromptShape, [string, string]>> = {
  search: ['short search', 'short searches'],
  question: ['question', 'questions'],
  situation: ['situation', 'situations']
}

/** How many a "✦ 3 more" button asks for. */
export const MORE_COUNT = 3

export interface PromptWriter {
  /** What Claude is writing now: the topic, the prompts, or 3 more of one shape. */
  writing: 'topic' | 'questions' | PromptShape | null
  error: string | null
  /**
   * Writes step 9's topic (when empty) and prompts to `mix`. Prompts already written to
   * this mix (or being written) stay; another mix replaces the AI prompts nobody touched.
   * A mix of 0 only removes them: the user checks their own list.
   */
  write: (mix: PromptMix) => void
  /** ✦ 3 more of one shape, added on top. */
  more: (shape: PromptShape) => void
}

function emptyMix(shape: PromptShape, count: number): PromptMix {
  return { search: 0, question: 0, situation: 0, [shape]: count }
}

/** The AI prompts nobody touched gone; the user's own and edited ones stay. */
function withoutAi(draft: SetupDraft): SetupDraft {
  return withList(draft, 'questions', (items) => applyRedo(items, []).items)
}

/**
 * Step 8 and 9's writer (owner feedback 2026-10-25), owned by OnboardingApp so it keeps
 * running between the two steps: step 8 starts it with the default mix as soon as the
 * step opens, so step 9 is usually ready; Continue writes again only when the mix
 * changed. Only with Claude: without it step 9 offers the ChatGPT way.
 */
export function usePromptWriter({
  sections,
  draftRef,
  onDraft,
  announce
}: {
  sections: SetupSectionClient
  draftRef: RefObject<SetupDraft>
  onDraft: (update: (current: SetupDraft) => SetupDraft) => void
  announce: (message: string) => void
}): PromptWriter {
  const [writing, setWriting] = useState<PromptWriter['writing']>(null)
  const [error, setError] = useState<string | null>(null)
  const ticket = useRef(0)
  // The mix the prompts on screen were written to, and the one being written now.
  const written = useRef<PromptMix | null>(null)
  const inflight = useRef<PromptMix | null>(null)
  const say = useRef(announce)
  useEffect(() => {
    say.current = announce
  })
  useEffect(() => {
    // A draft restored with prompts was written to the mix it saved.
    const start = draftRef.current
    if (start.lists.questions.length > 0) written.current = start.questionsMix ?? start.mix
  }, [draftRef])

  const write = useCallback(
    (mix: PromptMix) => {
      const start = draftRef.current
      if (inflight.current !== null && sameMix(inflight.current, mix)) return
      if (
        inflight.current === null &&
        sameMix(written.current, mix) &&
        start.lists.questions.length > 0
      ) {
        return
      }
      ticket.current += 1
      const mine = ticket.current
      const live = (): boolean => ticket.current === mine
      setError(null)
      if (mixTotal(mix) === 0) {
        inflight.current = null
        written.current = mix
        setWriting(null)
        onDraft(withoutAi)
        return
      }
      inflight.current = mix
      void (async () => {
        try {
          const estimate = await sections.sectionEstimate({ section: 'questions' })
          if (!live() || !estimate.available) return
          let topic = start.topic.trim()
          if (topic.length === 0) {
            setWriting('topic')
            const result = await sections.sectionRun({
              section: 'topic',
              context: contextFromDraft(start),
              mode: 'redo',
              instruction: null,
              current: [],
              prompt: start.prompts.topic ?? null,
              ...rulesOf(start)
            })
            if (!live()) return
            topic = (result.text ?? result.rows[0]?.name ?? '').trim()
            if (topic.length === 0) throw new Error('CiteFox AI could not name a topic. Type one.')
            // The user may have typed one meanwhile: theirs wins.
            onDraft((now) =>
              now.topic.trim().length > 0 ? now : { ...now, topic, topicOrigin: 'ai' }
            )
          }
          setWriting('questions')
          const now = draftRef.current
          const result = await sections.sectionRun({
            section: 'questions',
            context: { ...contextFromDraft({ ...now, topic: now.topic.trim() || topic }), mix },
            mode: 'redo',
            instruction: null,
            current: now.lists.questions.filter((item) => item.origin === 'user').map(rowOf),
            prompt: now.prompts.questions ?? null,
            ...rulesOf(now)
          })
          if (!live()) return
          onDraft((was) =>
            withList(was, 'questions', (items) => applyRedo(items, result.rows).items)
          )
          written.current = mix
          say.current(
            `CiteFox AI wrote ${pluralize(result.rows.length, 'prompt')}. Tick the ones to track.`
          )
        } catch (cause) {
          if (!live()) return
          setError(
            errorText(cause, 'CiteFox AI could not write them. Try again, or add your own.', {
              sentence: true
            })
          )
        } finally {
          if (live()) {
            inflight.current = null
            setWriting(null)
          }
        }
      })()
    },
    [draftRef, onDraft, sections]
  )

  const more = useCallback(
    (shape: PromptShape) => {
      if (inflight.current !== null) return
      ticket.current += 1
      const mine = ticket.current
      const live = (): boolean => ticket.current === mine
      const now = draftRef.current
      setError(null)
      setWriting(shape)
      void (async () => {
        try {
          const result = await sections.sectionRun({
            section: 'questions',
            context: { ...contextFromDraft(now), mix: emptyMix(shape, MORE_COUNT) },
            mode: 'more',
            instruction: null,
            current: now.lists.questions.map(rowOf),
            prompt: now.prompts.questions ?? null,
            ...rulesOf(now)
          })
          if (!live()) return
          const added = result.rows.filter((row) => row.detail === shape)
          const rows = added.length > 0 ? added : result.rows
          onDraft((was) => withList(was, 'questions', (items) => applyMore(items, rows).items))
          const [one, many] = SHAPE_NOUN[shape]
          say.current(
            `CiteFox AI added ${rows.length} ${rows.length === 1 ? one : many} at the top.`
          )
        } catch (cause) {
          if (!live()) return
          setError(
            errorText(cause, 'CiteFox AI could not write more. Try again.', { sentence: true })
          )
        } finally {
          if (live()) setWriting(null)
        }
      })()
    },
    [draftRef, onDraft, sections]
  )

  return { writing, error, write, more }
}
