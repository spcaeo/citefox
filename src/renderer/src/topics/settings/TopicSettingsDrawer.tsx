import { useCallback, useEffect, useState, type JSX } from 'react'
import { intervalDaysText, type TopicSummary } from '@shared/domain'
import { errorText } from '../../components/errorText'
import { closeDrawersThen } from '../../shell/drawers'
import { topicHash } from '../../shell/routes'
import { formatMoment } from '../../utils/dates'
import {
  Chip,
  IconButton,
  Drawer,
  DrawerFacts,
  DrawerField,
  DrawerFields,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection,
  SegmentedControl,
  showUndo
} from '../../ui'
import { bandText } from '../clusters/model'
import { notifyTopicsChanged } from '../clusters/events'
import type { ClustersSource } from '../clusters/source'
import type { PageEnginesSource } from '../../projectSettings/track/source'
import { duplicateTopics, removeTopics } from './actions'
import { addQuestionsToTopicHash, INTERVALS, settingsPatch, type TopicSettingsForm } from './model'
import { useTopicEngines } from './TopicEngines'
import './topic-settings.css'

export type TopicSettingsSource = Pick<
  ClustersSource,
  'topics:list' | 'topics:update' | 'topics:duplicate' | 'topics:merge'
>

const SOURCE_LABEL: Readonly<Record<TopicSummary['source'], string>> = {
  seed: 'Buyer problem',
  questions: 'Own questions',
  competitor: "Competitor's page"
}

function formFrom(topic: TopicSummary): TopicSettingsForm {
  return {
    name: topic.name,
    paused: topic.status === 'paused',
    intervalDays: topic.intervalDays as TopicSettingsForm['intervalDays']
  }
}

/** "Oct 19, 3:12 PM" on the computer's own clock, or "Not yet". */
function day(iso: string | null): string {
  if (iso === null) return 'Not yet'
  return formatMoment(iso)
}

/**
 * Topic settings (`drawer=topic-settings&ts.topic=<id>`), over Topics or the
 * topic itself: rename, pause or resume scheduled checks, how often it is
 * checked, its own engines, duplicate, delete. Save writes only what changed and offers Undo;
 * Delete acts at once with Undo (questions and history are kept).
 */
export function TopicSettingsDrawer({
  projectId,
  topicId,
  source,
  engines = null,
  onClose,
  onDeleted,
  onDuplicated
}: {
  projectId: string
  topicId: string
  source: TopicSettingsSource
  /** The topic's own engines. Absent: the Engines section is left out. */
  engines?: PageEnginesSource | null
  onClose: () => void
  /** After Delete: leave the topic's own page if it is open. */
  onDeleted: () => void
  /** After Duplicate: open the copy. */
  onDuplicated: (topicId: string) => void
}): JSX.Element {
  const [topic, setTopic] = useState<TopicSummary | null>(null)
  const [missing, setMissing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [form, setForm] = useState<TopicSettingsForm | null>(null)
  const [busy, setBusy] = useState<'save' | 'delete' | 'duplicate' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    source['topics:list']({ projectId }).then(
      ({ topics }) => {
        if (cancelled) return
        const found = topics.find((item) => item.id === topicId && item.status !== 'removed')
        setTopic(found ?? null)
        setMissing(found === undefined)
        setForm(found ? formFrom(found) : null)
        setLoadError(null)
      },
      (cause: unknown) => {
        if (!cancelled) setLoadError(errorText(cause, 'Could not load the topic.'))
      }
    )
    return () => {
      cancelled = true
    }
  }, [source, projectId, topicId, attempt])

  const own = useTopicEngines(engines, projectId, topicId)
  const patch = topic && form ? settingsPatch(topic, form) : null
  const changed = patch !== null && Object.keys(patch).length > 0
  const dirty = changed || own.dirty
  const nameError = form !== null && form.name.trim().length === 0 ? 'Give the topic a name.' : null

  const save = useCallback(async () => {
    if (!topic || !form || !patch || !dirty || nameError || own.invalid) return
    setBusy('save')
    setError(null)
    try {
      if (changed) await source['topics:update']({ projectId, topicId, ...patch })
      const enginesBefore = own.dirty ? await own.save() : undefined
      notifyTopicsChanged()
      const before = settingsPatch({ ...topic, ...applied(patch) }, formFrom(topic))
      showUndo({
        message: `Saved ${form.name.trim()}.`,
        undo: async () => {
          if (changed) await source['topics:update']({ projectId, topicId, ...before })
          if (enginesBefore !== undefined) await own.restore(enginesBefore)
          notifyTopicsChanged()
        },
        testId: 'topic-undo'
      })
      onClose()
    } catch (cause) {
      setError(errorText(cause, 'Could not save the topic.'))
      setBusy(null)
    }
  }, [topic, form, patch, dirty, changed, nameError, own, source, projectId, topicId, onClose])

  const remove = useCallback(async () => {
    if (!topic) return
    setBusy('delete')
    setError(null)
    try {
      await removeTopics(source, projectId, [topic])
      onDeleted()
    } catch (cause) {
      setError(errorText(cause, 'Could not delete the topic.'))
      setBusy(null)
    }
  }, [topic, source, projectId, onDeleted])

  const duplicate = useCallback(async () => {
    if (!topic) return
    setBusy('duplicate')
    setError(null)
    try {
      const made = await duplicateTopics(source, projectId, [topic])
      const id = made.topicIds[0]
      if (id !== undefined) onDuplicated(id)
    } catch (cause) {
      setError(errorText(cause, 'Could not duplicate the topic.'))
      setBusy(null)
    }
  }, [topic, source, projectId, onDuplicated])

  const name = topic?.name ?? 'Topic'
  const unavailable = missing
    ? { message: 'That topic is not available to you. It may have been deleted.' }
    : loadError
      ? { message: loadError, onRetry: () => setAttempt((n) => n + 1) }
      : undefined

  return (
    <Drawer
      id="topic-settings"
      title="Topic settings"
      trail={topic ? [{ label: topic.name, href: topicHash(topic.id) }] : []}
      subtitle={
        topic ? `${name} · rename, pause or delete it.` : 'Rename, pause or delete a topic.'
      }
      status={
        topic ? (
          <>
            {topic.status === 'paused' ? <Chip tone="warn">Paused</Chip> : null}
            <IconButton
              icon="plus"
              label="Add questions"
              tip
              disabled={busy !== null}
              onClick={() => closeDrawersThen(addQuestionsToTopicHash(topic.id))}
            />
            <IconButton
              icon="copy"
              label="Duplicate topic"
              tip
              disabled={busy !== null}
              aria-busy={busy === 'duplicate' || undefined}
              onClick={() => void duplicate()}
            />
          </>
        ) : undefined
      }
      loading={topic === null && !unavailable}
      {...(unavailable ? { error: unavailable } : {})}
      dirty={dirty}
      busy={busy !== null}
      closeDisabled={busy === 'save' || busy === 'delete'}
      onClose={onClose}
      testId="topic-settings-drawer"
      footer={{
        summary: error ? (
          <span className="ui-drawer-error" role="alert">
            {error}
          </span>
        ) : dirty ? (
          'Saving changes nothing that was checked. Undo is offered after.'
        ) : (
          'No changes yet.'
        ),
        ...(topic
          ? {
              danger: {
                label: 'Delete topic',
                icon: 'trash',
                busy: busy === 'delete',
                disabled: busy !== null,
                onClick: () => void remove()
              },
              primary: {
                label: 'Save changes',
                busy: busy === 'save',
                disabled: !dirty || nameError !== null || own.invalid !== null || busy !== null,
                onClick: () => void save()
              }
            }
          : {})
      }}
    >
      {topic && form ? (
        <DrawerGrid>
          <DrawerMain>
            <DrawerSection
              title="Name"
              description="How the topic shows in Topics, Questions and reports."
            >
              <DrawerFields>
                <DrawerField
                  label="Topic name"
                  error={nameError}
                  counter={`${form.name.length} / 120`}
                >
                  {({ id, describedBy }) => (
                    <input
                      id={id}
                      aria-describedby={describedBy}
                      className="ui-input"
                      value={form.name}
                      maxLength={120}
                      data-autofocus=""
                      onChange={(event) => setForm({ ...form, name: event.target.value })}
                    />
                  )}
                </DrawerField>
              </DrawerFields>
            </DrawerSection>
            <DrawerSection
              title="Checks"
              description="Paused topics are left out of scheduled checks. Check now still works."
            >
              <DrawerFields columns={2}>
                <DrawerField label="Scheduled checks">
                  <SegmentedControl
                    label="Scheduled checks"
                    value={form.paused ? 'paused' : 'on'}
                    onChange={(value) => setForm({ ...form, paused: value === 'paused' })}
                    options={[
                      { value: 'on', label: 'On' },
                      { value: 'paused', label: 'Paused' }
                    ]}
                  />
                </DrawerField>
                <DrawerField
                  label="Check every"
                  hint="Each check searches every question once per market."
                >
                  {({ id, describedBy }) => (
                    <select
                      id={id}
                      aria-describedby={describedBy}
                      className="ui-input"
                      value={form.intervalDays}
                      disabled={form.paused}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          intervalDays: Number(
                            event.target.value
                          ) as TopicSettingsForm['intervalDays']
                        })
                      }
                    >
                      {INTERVALS.map((days) => (
                        <option key={days} value={days}>
                          {intervalDaysText(days)}
                        </option>
                      ))}
                    </select>
                  )}
                </DrawerField>
              </DrawerFields>
            </DrawerSection>
            {own.section}
          </DrawerMain>
          <DrawerRail label="About this topic">
            <DrawerSection title="At a glance">
              <div className="ts-facts">
                <DrawerFacts
                  label="About this topic"
                  items={[
                    { label: 'Questions', value: <span className="num">{topic.questions}</span> },
                    { label: 'Keywords', value: <span className="num">{topic.keywords}</span> },
                    {
                      label: 'Goal',
                      value: bandText(topic.bands.questions),
                      hint: 'of questions cited'
                    },
                    { label: 'Started from', value: SOURCE_LABEL[topic.source] },
                    { label: 'Last check', value: day(topic.checkedAt) }
                  ]}
                />
              </div>
            </DrawerSection>
          </DrawerRail>
        </DrawerGrid>
      ) : null}
    </Drawer>
  )
}

/** The summary fields a patch changes, to work out what Undo puts back. */
function applied(patch: ReturnType<typeof settingsPatch>): Partial<TopicSummary> {
  return {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.intervalDays !== undefined ? { intervalDays: patch.intervalDays } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {})
  }
}
