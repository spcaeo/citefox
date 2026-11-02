import { useEffect, useMemo, useState, type JSX } from 'react'
import {
  TOPIC_STAGE_LABEL,
  TOPIC_STAGES,
  type IntentStage,
  type PromptSource,
  type TopicStage
} from '@shared/domain'
import type { QuestionDetail } from '@shared/ipc'
import { errorText } from '../components/errorText'
import { sourceLabel, stageLabel } from '../pageSetup/labels'
import { wordHint } from '../promptDetail/edit/model'
import { closeDrawersThen } from '../shell/drawers'
import { parseHash, promptHash } from '../shell/routes'
import { notifyTopicsChanged } from '../topics/clusters'
import {
  Button,
  Drawer,
  DrawerFacts,
  DrawerField,
  DrawerFields,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection,
  showUndo,
  Tabs,
  ToolButton,
  UrlText
} from '../ui'
import {
  blockingProblem,
  changeCount,
  editRequest,
  formFrom,
  isPagePrompt,
  withSameEverywhere,
  withText,
  wordingProblems,
  type EditForm
} from './editModel'
import { openMoveQuestions } from './open'
import { copyQuestionText, restoreUndo, updateQuestions } from './ops'
import type { QuestionEditSource } from './source'
import './questionEdit.css'

const INTENT_STAGES: readonly IntentStage[] = [
  'problem',
  'solution',
  'comparison',
  'objection',
  'trigger',
  'unset'
]
const SOURCES: readonly PromptSource[] = [
  'written_by_user',
  'title_meta_h1',
  'trigger_event',
  'objection',
  'detail_check'
]

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; detail: QuestionDetail }

/**
 * Edit one question (`?drawer=question&question=<prompt>&question.src=<page or
 * topic>`), over any screen: its wording per market (one tab each, or one
 * wording for all), its name, stage and source, and whether checks include it.
 * Save writes ONE new version (`questions:edit`), so earlier results stay with
 * the old wording, and the toast offers Undo. Remove is the footer's danger.
 */
export function EditQuestionDrawer({
  source,
  projectId,
  sourceId,
  promptId,
  tab,
  onTab,
  onClose
}: {
  source: QuestionEditSource
  projectId: string
  sourceId: string
  promptId: string
  /** The wording tab (a market id) from the URL. */
  tab: string | null
  onTab: (marketId: string) => void
  onClose: () => void
}): JSX.Element {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [form, setForm] = useState<EditForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.resolve()
      .then(() => source['questions:get']({ projectId, sourceId, promptId }))
      .then(
        (detail) => {
          if (cancelled) return
          setLoad({ status: 'ready', detail })
          setForm(formFrom(detail))
        },
        (cause: unknown) => {
          if (!cancelled) {
            setLoad({ status: 'error', message: errorText(cause, 'Could not open the question.') })
          }
        }
      )
    return () => {
      cancelled = true
    }
  }, [source, projectId, sourceId, promptId, attempt])

  const detail = load.status === 'ready' ? load.detail : null
  const request = useMemo(() => (detail && form ? editRequest(detail, form) : null), [detail, form])
  const changes = changeCount(request)
  const problem = detail && form ? blockingProblem(detail, form) : null
  const shown =
    detail?.wordings.find((wording) => wording.marketId === tab) ?? detail?.wordings[0] ?? null

  async function save(): Promise<void> {
    if (!detail || request === null || problem !== null || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const result = await source['questions:edit'](request)
      notifyTopicsChanged()
      const undo = result.restore ? restoreUndo(source, projectId, [result.restore]) : undefined
      showUndo({
        message: result.changed ? 'Saved the question as a new version.' : result.message,
        effect: result.changed ? 'Earlier results stay with the old wording.' : null,
        ...(undo ? { undo } : {})
      })
      const here = parseHash(window.location.hash)
      if (
        result.changed &&
        here.kind === 'prompt' &&
        here.promptId === result.previousPromptId &&
        here.pageId === detail.sourceId
      ) {
        // Prompt detail of the old version: follow the question to its new id.
        closeDrawersThen(
          promptHash(detail.sourceId, result.promptId, { marketId: here.marketId ?? null })
        )
        return
      }
      onClose()
    } catch (cause) {
      setSaveError(errorText(cause, 'Could not save the question.', { sentence: true }))
    } finally {
      setSaving(false)
    }
  }

  async function remove(): Promise<void> {
    if (!detail) return
    setSaving(true)
    const changed = await updateQuestions(source, projectId, 'remove', [
      { sourceId: detail.sourceId, promptId: detail.promptId }
    ])
    setSaving(false)
    if (changed !== null && changed > 0) onClose()
  }

  const page = detail ? isPagePrompt(detail) : false
  const problems = detail && form ? wordingProblems(detail, form) : {}
  const noun = detail?.topicKind === 'keyword' ? 'keyword' : 'question'

  return (
    <Drawer
      id="question"
      title={noun === 'keyword' ? 'Edit keyword' : 'Edit question'}
      subtitle={
        detail
          ? `${detail.sourceKind === 'topic' ? 'Topic' : 'Page'}: ${detail.sourceName} · saving writes a new version, so past results stay with the old wording`
          : 'Wording, stage and checks for one question'
      }
      status={detail && !detail.enabled ? 'Left out of checks' : undefined}
      loading={load.status === 'loading'}
      error={
        load.status === 'error'
          ? {
              message: load.message,
              onRetry: () => {
                setLoad({ status: 'loading' })
                setAttempt((n) => n + 1)
              }
            }
          : undefined
      }
      dirty={changes > 0}
      busy={saving}
      closeDisabled={saving}
      onClose={onClose}
      testId="question-drawer"
      footer={{
        summary:
          saveError ??
          (problem && changes > 0
            ? problem
            : changes === 0
              ? 'No changes yet · nothing is searched'
              : `${changes} ${changes === 1 ? 'change' : 'changes'} · saved as one new version · nothing is searched`),
        ...(detail
          ? {
              danger: {
                label: `Remove ${noun}`,
                icon: 'trash',
                disabled: saving,
                onClick: () => void remove()
              }
            }
          : {}),
        primary: {
          label: 'Save',
          busy: saving,
          disabled: changes === 0 || problem !== null || (detail?.draftOpen ?? false),
          onClick: () => void save()
        }
      }}
    >
      {detail && form && shown ? (
        <DrawerGrid>
          <DrawerMain>
            <DrawerSection
              title="Wording"
              description={
                detail.wordings.length > 1
                  ? 'How the question is searched in each market.'
                  : `How the question is searched in ${shown.marketLabel}.`
              }
            >
              {detail.wordings.length > 1 ? (
                <Tabs
                  label="Markets"
                  size="sm"
                  value={shown.marketId}
                  onChange={onTab}
                  tabs={detail.wordings.map((wording) => ({
                    id: wording.marketId,
                    label: wording.isDefault
                      ? `${wording.marketLabel} · default`
                      : wording.marketLabel
                  }))}
                />
              ) : null}
              <DrawerFields>
                <DrawerField
                  label={`Wording in ${shown.marketLabel}`}
                  counter={wordHint(form.texts[shown.marketId] ?? '', detail.rules).split(' · ')[0]}
                  hint={wordHint(form.texts[shown.marketId] ?? '', detail.rules)
                    .split(' · ')
                    .slice(1)
                    .join(' · ')}
                  error={problems[shown.marketId] ?? null}
                >
                  {({ id, describedBy }) => (
                    <textarea
                      id={id}
                      aria-describedby={describedBy}
                      className="ui-input qe-textarea"
                      rows={3}
                      data-autofocus
                      disabled={saving || detail.draftOpen}
                      value={form.texts[shown.marketId] ?? ''}
                      onChange={(event) =>
                        setForm(withText(form, shown.marketId, event.target.value))
                      }
                    />
                  )}
                </DrawerField>
                {detail.wordings.length > 1 ? (
                  <label className="qe-check">
                    <input
                      type="checkbox"
                      className="ui-check"
                      checked={form.sameEverywhere}
                      disabled={saving}
                      onChange={(event) =>
                        setForm(withSameEverywhere(form, event.target.checked, shown.marketId))
                      }
                    />
                    Use this wording in every market
                  </label>
                ) : null}
              </DrawerFields>
              {detail.draftOpen ? (
                <p className="qe-warning" role="alert">
                  This page has unsaved edits on its Questions tab. Save or discard them there
                  first.
                </p>
              ) : null}
            </DrawerSection>
            <DrawerSection
              title="Details"
              description="What kind of question this is, and whether checks include it."
            >
              <DrawerFields columns={2}>
                {page ? (
                  <DrawerField label="Name" hint="A short name for lists and reports.">
                    {({ id, describedBy }) => (
                      <input
                        id={id}
                        aria-describedby={describedBy}
                        className="ui-input"
                        value={form.label}
                        maxLength={160}
                        disabled={saving}
                        onChange={(event) => setForm({ ...form, label: event.target.value })}
                      />
                    )}
                  </DrawerField>
                ) : null}
                {page ? (
                  <DrawerField label="Stage" hint="Where the buyer is when they ask it.">
                    {({ id, describedBy }) => (
                      <select
                        id={id}
                        aria-describedby={describedBy}
                        className="ui-input"
                        value={form.intentStage}
                        disabled={saving}
                        onChange={(event) =>
                          setForm({ ...form, intentStage: event.target.value as IntentStage })
                        }
                      >
                        {INTENT_STAGES.map((stage) => (
                          <option key={stage} value={stage}>
                            {stageLabel(stage)}
                          </option>
                        ))}
                      </select>
                    )}
                  </DrawerField>
                ) : detail.topicKind !== null ? (
                  <DrawerField label="Stage" hint="The buyer's journey stage in this topic.">
                    {({ id, describedBy }) => (
                      <select
                        id={id}
                        aria-describedby={describedBy}
                        className="ui-input"
                        value={form.topicStage ?? ''}
                        disabled={saving}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            topicStage: (event.target.value || null) as TopicStage | null
                          })
                        }
                      >
                        <option value="">No stage</option>
                        {TOPIC_STAGES.map((stage) => (
                          <option key={stage} value={stage}>
                            {TOPIC_STAGE_LABEL[stage]}
                          </option>
                        ))}
                      </select>
                    )}
                  </DrawerField>
                ) : null}
                <DrawerField label="Source" hint="Where the question came from.">
                  {({ id, describedBy }) => (
                    <select
                      id={id}
                      aria-describedby={describedBy}
                      className="ui-input"
                      value={form.source}
                      disabled={saving}
                      onChange={(event) =>
                        setForm({ ...form, source: event.target.value as PromptSource })
                      }
                    >
                      {SOURCES.map((item) => (
                        <option key={item} value={item}>
                          {sourceLabel(item)}
                        </option>
                      ))}
                    </select>
                  )}
                </DrawerField>
                <DrawerField
                  label="Checks"
                  hint={form.enabled ? 'Searched at every check.' : 'Kept, but not searched.'}
                >
                  {({ id, describedBy }) => (
                    <select
                      id={id}
                      aria-describedby={describedBy}
                      className="ui-input"
                      value={form.enabled ? 'on' : 'off'}
                      disabled={saving}
                      onChange={(event) =>
                        setForm({ ...form, enabled: event.target.value === 'on' })
                      }
                    >
                      <option value="on">Included in checks</option>
                      <option value="off">Left out of checks</option>
                    </select>
                  )}
                </DrawerField>
              </DrawerFields>
            </DrawerSection>
          </DrawerMain>
          <DrawerRail label="About this question">
            <DrawerSection title="Where it is">
              <div className="qe-where">
                <DrawerFacts
                  label="Where the question is"
                  items={[
                    {
                      label: detail.sourceKind === 'topic' ? 'Topic' : 'Page',
                      value: detail.sourceName
                    },
                    ...(detail.sourceUrl
                      ? [{ label: 'Address', value: <UrlText url={detail.sourceUrl} /> }]
                      : []),
                    {
                      label: 'Markets',
                      value: detail.wordings.map((wording) => wording.marketLabel).join(', ')
                    },
                    { label: 'Kind', value: kindLabel(detail) }
                  ]}
                />
              </div>
            </DrawerSection>
            <DrawerSection title="More" description="Each acts at once and can be undone.">
              <div className="qe-actions">
                <Button
                  size="sm"
                  icon="merge"
                  disabled={saving}
                  onClick={() =>
                    openMoveQuestions([{ sourceId: detail.sourceId, promptId: detail.promptId }])
                  }
                >
                  {detail.sourceKind === 'topic' ? 'Move to another topic…' : 'Move to a topic…'}
                </Button>
                <Button
                  size="sm"
                  icon="layers"
                  disabled={saving}
                  onClick={() =>
                    openMoveQuestions(
                      [{ sourceId: detail.sourceId, promptId: detail.promptId }],
                      'copy'
                    )
                  }
                >
                  Duplicate to…
                </Button>
                <ToolButton
                  kind="copy"
                  label="Copy question"
                  onClick={() => void copyQuestionText(form.texts[shown.marketId] ?? '')}
                />
              </div>
            </DrawerSection>
          </DrawerRail>
        </DrawerGrid>
      ) : null}
    </Drawer>
  )
}

function kindLabel(detail: QuestionDetail): string {
  if (detail.topicKind === 'keyword') return 'Keyword (a short search)'
  if (detail.topicKind === 'question') return 'Topic question'
  return 'Buyer question (8 to 32 words)'
}
