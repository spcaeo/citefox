import { useLayoutEffect, useRef, useState, type JSX } from 'react'
import type { SetupDraft, SetupSectionId, SetupSectionResult } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { Button, Confirm } from '../../ui'
import { applyBrandFill } from '../setupApply'
import { contextFromDraft, rulesOf } from '../setupDraft'
import type { SetupStepProps } from '../steps/types'
import { withList } from './draftOps'
import { itemsFromRows } from './merge'

const NO_READ = 'CiteFox AI could not fill this step again. Try again.'

function isText(section: SetupSectionId): section is 'summary' | 'topic' {
  return section === 'summary' || section === 'topic'
}

/** The draft with one section emptied, its edited prompt dropped too. */
function cleared(draft: SetupDraft, section: SetupSectionId): SetupDraft {
  const prompts = { ...draft.prompts }
  delete prompts[section]
  const next = { ...draft, prompts }
  if (section === 'summary') return { ...next, summary: '', summaryOrigin: 'ai' }
  if (section === 'topic') return { ...next, topic: '', topicOrigin: 'ai' }
  return withList(next, section, () => [])
}

/** The draft with one section replaced by Claude's fresh answer. */
function filled(
  draft: SetupDraft,
  section: SetupSectionId,
  result: SetupSectionResult
): SetupDraft {
  if (isText(section)) {
    const text = (result.text ?? result.rows[0]?.name ?? '').trim()
    return section === 'summary'
      ? { ...draft, summary: text, summaryOrigin: 'ai' }
      : { ...draft, topic: text, topicOrigin: 'ai' }
  }
  return withList(draft, section, () => itemsFromRows(result.rows))
}

/**
 * "Start over this step" (owner feedback 2026-10-25), at the right of the step
 * heading: after a confirm, every answer on this step goes (edits, own items,
 * edited prompts) and Claude fills the step again: step 4 by reading the site
 * again, the others one section after the other so each sees the one before.
 * Nothing changes until all of it came back, so a failure keeps the step.
 * Without Claude the step is only emptied.
 * Other steps are not touched.
 */
export function StartOverStep({
  step,
  sections
}: {
  step: SetupStepProps
  sections: readonly SetupSectionId[]
}): JSX.Element {
  const { onDraft, announce } = step
  const client = step.sections
  const [asking, setAsking] = useState(false)
  const [done, setDone] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(step.draft)
  useLayoutEffect(() => {
    latest.current = step.draft
  })

  async function run(): Promise<void> {
    setAsking(false)
    setError(null)
    setDone(0)
    let draft = sections.reduce(cleared, latest.current)
    try {
      const estimate = await client.sectionEstimate({ section: sections[0] ?? 'summary' })
      if (!estimate.available) {
        onDraft((now) => sections.reduce(cleared, now))
        announce('This step is empty again. Add your own, or use your own ChatGPT.')
        return
      }
      // Step 4 reads the site again, as step 3 did: its answers come from the pages.
      if (step.rereadSite) {
        const fill = await step.rereadSite()
        if ((fill.summary ?? '').trim().length === 0) throw new Error(fill.message || NO_READ)
        onDraft((now) => applyBrandFill(sections.reduce(cleared, now), fill))
        setDone(sections.length)
        announce('This step was filled again from your site.')
        return
      }
      const results: [SetupSectionId, SetupSectionResult][] = []
      for (const [index, section] of sections.entries()) {
        const result = await client.sectionRun({
          section,
          context: contextFromDraft(draft),
          mode: 'redo',
          instruction: null,
          current: [],
          prompt: null,
          ...rulesOf(draft)
        })
        if (isText(section) && !result.text) throw new Error(result.warnings[0] ?? NO_READ)
        draft = filled(draft, section, result)
        results.push([section, result])
        setDone(index + 1)
      }
      // Nothing changes until every section came back, so a failure keeps the step as it was.
      onDraft((now) =>
        results.reduce(
          (next, [section, result]) => filled(next, section, result),
          sections.reduce(cleared, now)
        )
      )
      announce('This step was filled again from scratch.')
    } catch (cause) {
      const message = errorText(cause, 'CiteFox AI could not fill this step again. Try again.', {
        sentence: true
      })
      setError(message)
      announce(message)
    } finally {
      setDone(null)
    }
  }

  const busy = done !== null
  return (
    <div className="osc-start-over">
      <Button
        variant="secondary"
        size="sm"
        busy={busy}
        busyLabel={`Starting over… ${done ?? 0} of ${sections.length}`}
        onClick={() => setAsking(true)}
      >
        Start over this step
      </Button>
      {error ? (
        <p className="osc-start-over-error" role="alert">
          {error}
        </p>
      ) : null}
      {asking ? (
        <Confirm
          title="Start over this step?"
          body={
            <p>
              Everything on this step goes, including your edits and your own items, and CiteFox AI
              fills it again from scratch. Your other steps stay as they are.
            </p>
          }
          confirmLabel="Start over this step"
          onCancel={() => setAsking(false)}
          onConfirm={() => void run()}
        />
      ) : null}
    </div>
  )
}
