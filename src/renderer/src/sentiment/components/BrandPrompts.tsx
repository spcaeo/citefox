import { useState, type JSX } from 'react'
import {
  BRAND_PROMPT_KINDS,
  BRAND_PROMPT_MAX_LENGTH,
  MAX_BRAND_PROMPTS,
  isBrandPromptKind,
  type BrandPrompt,
  type BrandPromptSet,
  type SentimentOverview
} from '@shared/domain'
import type { BrandPromptDraft } from '@shared/ipc'
import { DrillButton, DrillFigure } from '../../drill'
import { AiMenu, Button, IconButton, SectionHead } from '../../ui'
import { BRAND_KIND_LABEL, BRAND_PROMPTS_SECONDS } from '../constants'
import type { SentimentDrills } from '../drills'
import type { ActionResult } from '../types'
import { brandPromptProblem, estimateLabel, languageLabel } from '../utils/model'

/**
 * FR-16.1: prompts that name the brand on purpose. Sentiment only, never
 * visibility. A prompt with an overview in the latest check opens it.
 */
export function BrandPrompts({
  brand,
  set,
  overviews,
  drills,
  busyGenerate,
  busySave,
  onGenerate,
  onSave
}: {
  brand: string
  set: BrandPromptSet
  /** The latest check's overviews (every source), so each prompt opens its own. */
  overviews: readonly SentimentOverview[]
  drills: SentimentDrills
  busyGenerate: boolean
  busySave: boolean
  onGenerate: () => Promise<ActionResult>
  onSave: (prompts: readonly BrandPromptDraft[]) => Promise<ActionResult>
}): JSX.Element {
  const [drafts, setDrafts] = useState<BrandPromptDraft[] | null>(null)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const languages = set.languages.length > 0 ? set.languages : ['en']
  const canWrite = set.prompts.length === 0 || set.missingLanguages.length > 0

  function startEdit(): void {
    setMessage(null)
    setDrafts(
      set.prompts.map((prompt) => ({
        kind: prompt.kind,
        language: prompt.language,
        text: prompt.text
      }))
    )
  }

  function change(index: number, patch: Partial<BrandPromptDraft>): void {
    setDrafts((current) =>
      current === null
        ? current
        : current.map((draft, at) => (at === index ? { ...draft, ...patch } : draft))
    )
  }

  async function save(): Promise<void> {
    if (drafts === null) return
    const cleaned = drafts.map((draft) => ({ ...draft, text: draft.text.trim() }))
    const problem = brandPromptProblem(cleaned, [brand])
    if (problem !== null) {
      setMessage({ text: problem, error: true })
      return
    }
    const result = await onSave(cleaned)
    setMessage(result.message === null ? null : { text: result.message, error: !result.ok })
    if (result.ok) setDrafts(null)
  }

  async function generate(): Promise<void> {
    setMessage(null)
    const result = await onGenerate()
    setMessage(result.message === null ? null : { text: result.message, error: !result.ok })
  }

  return (
    <section className="st-card" aria-labelledby="st-brand-prompts-h">
      <SectionHead
        id="st-brand-prompts-h"
        title="Brand questions"
        description={`These name ${brand} on purpose, so Google talks about the brand. They feed this tab only and never count toward the visibility score.`}
        actions={
          drafts === null && set.prompts.length > 0 ? (
            <IconButton
              icon="pencil"
              size="sm"
              tip
              label="Edit brand questions"
              onClick={startEdit}
            />
          ) : null
        }
        ai={
          drafts === null && canWrite ? (
            <AiMenu
              label="AI actions for brand questions"
              footer="Runs on your AI plan. No searches until the next check."
              actions={[
                {
                  id: 'write',
                  label:
                    set.prompts.length === 0
                      ? 'Write brand questions'
                      : 'Write the missing languages',
                  seconds: BRAND_PROMPTS_SECONDS,
                  disabled: busyGenerate,
                  onSelect: () => void generate()
                }
              ]}
            />
          ) : null
        }
      />
      {busyGenerate ? (
        <p className="st-note" role="status">
          Writing brand questions…
        </p>
      ) : null}
      {set.missingLanguages.length > 0 && set.prompts.length > 0 ? (
        <p className="note note-warn st-small">
          No brand questions in {set.missingLanguages.map(languageLabel).join(', ')} yet, so markets
          in that language skip them.
        </p>
      ) : null}
      {drafts === null ? (
        set.prompts.length === 0 ? (
          <p className="muted">
            No brand questions yet. Write them from the AI menu to see how Google describes {brand}{' '}
            when someone asks about it by name.
          </p>
        ) : (
          <ul className="st-prompt-tags" aria-label="Brand questions">
            {set.prompts.map((prompt) => (
              <li key={prompt.id} className="st-prompt-chip">
                <PromptTag prompt={prompt} overviews={overviews} drills={drills} />
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="st-editor" role="group" aria-label="Edit brand questions">
          {drafts.map((draft, index) => (
            <div key={index} className="st-editor-row">
              <label className="sr-only" htmlFor={`st-bp-kind-${index}`}>
                Kind of brand question {index + 1}
              </label>
              <select
                id={`st-bp-kind-${index}`}
                className="ui-input st-select"
                value={draft.kind}
                onChange={(event) => {
                  const value = event.target.value
                  if (isBrandPromptKind(value)) change(index, { kind: value })
                }}
              >
                {BRAND_PROMPT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {BRAND_KIND_LABEL[kind]}
                  </option>
                ))}
              </select>
              {languages.length > 1 ? (
                <>
                  <label className="sr-only" htmlFor={`st-bp-lang-${index}`}>
                    Language of brand question {index + 1}
                  </label>
                  <select
                    id={`st-bp-lang-${index}`}
                    className="ui-input st-select"
                    value={draft.language}
                    onChange={(event) => change(index, { language: event.target.value })}
                  >
                    {languages.map((language) => (
                      <option key={language} value={language}>
                        {languageLabel(language)}
                      </option>
                    ))}
                  </select>
                </>
              ) : null}
              <label className="sr-only" htmlFor={`st-bp-text-${index}`}>
                Brand question {index + 1}
              </label>
              <input
                id={`st-bp-text-${index}`}
                className="ui-input st-editor-text"
                value={draft.text}
                maxLength={BRAND_PROMPT_MAX_LENGTH}
                onChange={(event) => change(index, { text: event.target.value })}
              />
              <Button
                size="sm"
                variant="ghost"
                icon="trash"
                aria-label={`Remove brand question ${index + 1}`}
                onClick={() =>
                  setDrafts((current) => current?.filter((_, at) => at !== index) ?? current)
                }
              >
                Remove
              </Button>
            </div>
          ))}
          <div className="st-actions">
            <Button
              size="sm"
              icon="plus"
              disabled={drafts.length >= MAX_BRAND_PROMPTS * languages.length}
              onClick={() =>
                setDrafts((current) => [
                  ...(current ?? []),
                  { kind: 'review', language: languages[0] ?? 'en', text: '' }
                ])
              }
            >
              Add a question
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setDrafts(null)
                setMessage(null)
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" size="sm" disabled={busySave} onClick={() => void save()}>
              Save brand questions
            </Button>
          </div>
          <p className="st-note">
            Saving creates the next version. Past checks keep the questions they used.
          </p>
        </div>
      )}
      {set.prompts.length > 0 ? <p className="st-note num">{estimateLabel(set.estimate)}</p> : null}
      {message ? (
        <p
          className={message.error ? 'bridge-alert' : 'st-message'}
          role={message.error ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      ) : null}
    </section>
  )
}

function PromptTag({
  prompt,
  overviews,
  drills
}: {
  prompt: BrandPrompt
  overviews: readonly SentimentOverview[]
  drills: SentimentDrills
}): JSX.Element {
  const kind = (
    <span className="faint">
      {BRAND_KIND_LABEL[prompt.kind]} · {languageLabel(prompt.language)}{' '}
    </span>
  )
  const ids = overviews
    .filter((overview) => overview.source === 'brand' && overview.promptId === prompt.id)
    .map((overview) => overview.id)
  if (ids.length === 0) {
    return (
      <>
        {kind}
        {prompt.text}
      </>
    )
  }
  const drill = drills.overviews(
    {
      id: `brand-prompt:${prompt.id}`,
      title: `Overview for “${prompt.text}”`,
      description:
        'What Google said for this brand question in the latest check: the brands it names, the reason, its claims and sources.',
      everySource: true
    },
    ids
  )
  return (
    <DrillButton drill={drill} className="st-drill st-prompt-tag">
      {kind}
      {prompt.text}
      <span className="faint">
        {' '}
        · <DrillFigure drill={drill} /> {ids.length === 1 ? 'overview' : 'overviews'}
      </span>
    </DrillButton>
  )
}
