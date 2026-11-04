import { useMemo, useState, type JSX } from 'react'
import {
  TOPIC_PROFILE_SECTIONS,
  TOPIC_PROFILE_SECTION_HINT,
  TOPIC_PROFILE_SECTION_LABEL,
  type TopicProfilePoint,
  type TopicProfileSection
} from '@shared/domain'
import type { TopicDraftPatch, TopicProfileSuggestions } from '@shared/ipc'
import { AiMenu, Button, Chip, ListGrid, Panel, type ListColumn, type MenuItem } from '../../../ui'
import { formatMoment } from '../../../utils/dates'
import { AiCard } from '../components/AiCard'
import { LineEditor } from '../components/LineEditor'
import { StepFrame } from '../components/StepFrame'
import { READS_SITE, useAiRun } from '../hooks/useAiRun'
import { profilePoints, questionTarget, questionsOf, stepProblem } from '../utils/draft'
import { usePrimary, type StepProps } from './shared'

type Editing = { mode: 'add' } | { mode: 'edit'; point: TopicProfilePoint } | null

const SECTION_CHOICES = TOPIC_PROFILE_SECTIONS.map((section) => ({
  value: section,
  label: TOPIC_PROFILE_SECTION_LABEL[section]
}))

function profilePatch(
  points: readonly Pick<TopicProfilePoint, 'id' | 'section' | 'text' | 'foundIn' | 'verify'>[],
  note: 'edited' | 'filled_gaps'
): TopicDraftPatch {
  return {
    profile: {
      points: points.map((point) => ({
        id: point.id,
        section: point.section,
        text: point.text,
        foundIn: point.foundIn,
        verify: point.verify
      })),
      note
    }
  }
}

function writtenLabel(iso: string | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const minutes = Math.round((Date.now() - date.getTime()) / 60000)
  if (minutes < 2) return 'Just now'
  return formatMoment(iso)
}

/** Buyer profile (Seed-Profile.png): points by section, versioned, with section AI menus. */
export function ProfileStep(props: StepProps): JSX.Element {
  const { draft, project, client, patch, flush, replace } = props
  const primary = usePrimary(props)
  const ai = useAiRun<TopicProfileSuggestions>()
  const [rewriting, setRewriting] = useState(false)
  const [filter, setFilter] = useState('all')
  const [editing, setEditing] = useState<Editing>(null)
  const [undoVersion, setUndoVersion] = useState<number | null>(null)
  const points = profilePoints(draft)
  const profile = draft.profile
  const current = profile?.versions.find((version) => version.version === profile.current)
  const previous = profile && profile.current > 1 ? profile.current - 1 : null
  const newCount = points.filter((point) => point.isNew).length
  const rows = filter === 'new' ? points.filter((point) => point.isNew) : points
  const marketLabels = project.markets
    .filter((market) => draft.marketIds.includes(market.id))
    .map((market) => market.label)

  function savePoints(next: readonly TopicProfilePoint[], note: 'edited' | 'filled_gaps'): void {
    setUndoVersion(profile?.current ?? null)
    patch(profilePatch(next, note))
  }

  function runSection(
    section: TopicProfileSection | null,
    action: 'discover' | 'explain' | 'rewrite' | 'shorter'
  ): void {
    const label = section ? TOPIC_PROFILE_SECTION_LABEL[section] : 'your profile'
    const titles = {
      discover: section ? `Discover more: ${label}` : 'Fill gaps from your site',
      explain: `Sources: ${label}`,
      rewrite: `Rewrite: ${label}`,
      shorter: `Shorter: ${label}`
    }
    ai.run({
      id: `${action}:${section ?? 'all'}`,
      title: titles[action],
      seconds: action === 'discover' ? (section ? 15 : 30) : 5,
      reads: READS_SITE,
      call: async (instruction) => {
        const saved = (await flush()) ?? draft
        if ((action === 'rewrite' || action === 'shorter') && section) {
          return client['topics:rewriteSection']({
            projectId: project.id,
            draftId: saved.id,
            section,
            mode: action,
            instruction
          })
        }
        return client['topics:discoverProfileSection']({
          projectId: project.id,
          draftId: saved.id,
          section,
          action: action === 'explain' ? 'explain' : 'discover',
          instruction
        })
      }
    })
  }

  function applySuggestions(ids: readonly string[]): void {
    const answer = ai.result
    if (!answer) return
    const picked = answer.suggestions.filter((item) => ids.includes(item.id))
    const replaced = new Map(
      picked.filter((item) => item.replacesPointId).map((item) => [item.replacesPointId, item])
    )
    const next: TopicProfilePoint[] = points.map((point) => {
      const swap = replaced.get(point.id)
      return swap
        ? { ...point, text: swap.text, foundIn: swap.foundIn, verify: swap.verify }
        : point
    })
    for (const item of picked) {
      if (item.replacesPointId) continue
      next.push({
        id: item.id,
        section: item.section,
        text: item.text,
        foundIn: item.foundIn,
        verify: item.verify,
        isNew: true
      })
    }
    savePoints(next, answer.action === 'discover' ? 'filled_gaps' : 'edited')
  }

  async function rewriteAll(): Promise<void> {
    setRewriting(true)
    try {
      const saved = (await flush()) ?? draft
      replace(
        await client['topics:writeProfile']({
          projectId: project.id,
          draftId: saved.id,
          rewrite: true
        })
      )
    } catch (cause) {
      primary.setError(
        cause instanceof Error ? cause.message : 'CiteFox AI could not rewrite the profile.'
      )
    } finally {
      setRewriting(false)
    }
  }

  const columns = useMemo<ListColumn<TopicProfilePoint>[]>(
    () => [
      {
        id: 'point',
        label: 'Point',
        width: 'fill',
        sort: (row) => row.text,
        render: (row) => (
          <span className="tw-cell-text">
            <span className="tw-clamp" title={row.text}>
              {row.text}
            </span>
            {row.verify ? (
              <Chip tone="warn" size="sm" label="Re-check">
                Re-check
              </Chip>
            ) : null}
          </span>
        )
      },
      {
        id: 'found',
        label: 'Found in',
        width: 200,
        sort: (row) => row.foundIn ?? '',
        render: (row) => (
          <span className={row.foundIn?.startsWith('/') ? 'mono tw-clamp' : 'tw-clamp'}>
            {row.foundIn ?? 'CiteFox AI'}
          </span>
        )
      },
      {
        id: 'new',
        label: 'New',
        hideLabel: true,
        width: 64,
        render: (row) =>
          row.isNew ? (
            <Chip tone="fox" size="sm">
              New
            </Chip>
          ) : null
      }
    ],
    []
  )

  function rowMenu(row: TopicProfilePoint): MenuItem[] {
    return [
      {
        id: 'edit',
        label: 'Edit',
        icon: 'pencil',
        onSelect: () => setEditing({ mode: 'edit', point: row })
      },
      {
        id: 'move',
        label: 'Move to another section',
        icon: 'layers',
        onSelect: () => setEditing({ mode: 'edit', point: row })
      },
      {
        id: 'rewrite',
        label: 'Rewrite',
        hint: '5 s',
        tone: 'ai',
        icon: 'sparkle',
        onSelect: () => runSection(row.section, 'rewrite')
      },
      {
        id: 'source',
        label: 'Show the source',
        icon: 'eye',
        onSelect: () => runSection(row.section, 'explain')
      },
      {
        id: 'remove',
        label: 'Remove',
        icon: 'trash',
        tone: 'danger',
        onSelect: () =>
          savePoints(
            points.filter((point) => point.id !== row.id),
            'edited'
          )
      }
    ]
  }

  const problem = stepProblem(draft, 'profile')
  const hasQuestions = questionsOf(draft).some((question) => question.source === 'claude')
  const target = questionTarget(draft.depth.questions)
  const answer = ai.result
  const nextStep = draft.generate === 'keywords' ? 'keywords' : 'questions'

  return (
    <StepFrame
      steps={props.steps}
      current={props.step}
      onStep={props.goTo}
      title="Buyer profile"
      headerEnd={
        <p className="tw-help">Check it sounds like the person who types these questions.</p>
      }
      footer={{
        onBack: props.back,
        note:
          primary.error ??
          problem ??
          (hasQuestions
            ? 'Next: your saved questions'
            : `Next: CiteFox AI writes ${target} questions · about 40 s`),
        noteTone: primary.error || problem ? 'warn' : 'neutral',
        primary: {
          label: hasQuestions ? 'Next: questions' : 'Write questions',
          busy: primary.busy,
          disabled: Boolean(problem),
          onClick: () =>
            void primary.advance(
              nextStep,
              hasQuestions
                ? undefined
                : (draftId) =>
                    client['topics:generateQuestions']({ projectId: project.id, draftId })
            )
        }
      }}
    >
      <div className="tw-grid">
        <div className="tw-main tw-profile">
          {editing ? (
            <LineEditor
              title={editing.mode === 'add' ? 'Add a point' : 'Edit point'}
              label="Point"
              initialText={editing.mode === 'edit' ? editing.point.text : ''}
              choiceLabel="Section"
              choices={SECTION_CHOICES}
              initialChoice={editing.mode === 'edit' ? editing.point.section : 'who'}
              multiline={false}
              onCancel={() => setEditing(null)}
              onSave={(text, choice) => {
                const section = (choice ?? 'who') as TopicProfileSection
                if (editing.mode === 'edit') {
                  savePoints(
                    points.map((point) =>
                      point.id === editing.point.id ? { ...point, text, section } : point
                    ),
                    'edited'
                  )
                } else {
                  savePoints(
                    [
                      ...points,
                      {
                        id: `pp-new-${points.length + 1}`,
                        section,
                        text,
                        foundIn: null,
                        verify: null,
                        isNew: true
                      }
                    ],
                    'edited'
                  )
                }
                setEditing(null)
              }}
            />
          ) : null}
          <ListGrid
            label="Buyer profile points"
            noun={['point', 'points']}
            rows={rows}
            rowKey={(row) => row.id}
            rowLabel={(row) => row.text}
            columns={columns}
            search={{ text: (row) => `${row.text} ${row.foundIn ?? ''}` }}
            filter={{
              label: 'Show',
              value: filter,
              onChange: setFilter,
              options: [
                { value: 'all', label: 'All' },
                { value: 'new', label: `New in v${profile?.current ?? 1}`, count: newCount }
              ]
            }}
            actions={
              <Button variant="ghost" icon="plus" onClick={() => setEditing({ mode: 'add' })}>
                Add point
              </Button>
            }
            group={{
              key: (row) => ({ key: row.section, label: TOPIC_PROFILE_SECTION_LABEL[row.section] }),
              order: TOPIC_PROFILE_SECTIONS,
              meta: (_rows, key) => {
                const section = key as TopicProfileSection
                return (
                  <span className="tw-gmeta">
                    <span>{TOPIC_PROFILE_SECTION_HINT[section]}</span>
                    <AiMenu
                      size="sm"
                      label={`AI actions for ${TOPIC_PROFILE_SECTION_LABEL[section]}`}
                      actions={[
                        {
                          id: 'discover',
                          label: 'Discover more from your site',
                          seconds: 15,
                          icon: 'compass',
                          onSelect: () => runSection(section, 'discover')
                        },
                        {
                          id: 'rewrite',
                          label: 'Rewrite this section',
                          seconds: 5,
                          icon: 'wand',
                          onSelect: () => runSection(section, 'rewrite')
                        },
                        {
                          id: 'shorter',
                          label: 'Make it shorter',
                          seconds: 5,
                          onSelect: () => runSection(section, 'shorter')
                        },
                        {
                          id: 'explain',
                          label: 'Explain the sources',
                          seconds: 5,
                          icon: 'bulb',
                          onSelect: () => runSection(section, 'explain')
                        }
                      ]}
                    />
                  </span>
                )
              }
            }}
            bulk={({ selected, clear }) => (
              <>
                <Button
                  size="sm"
                  icon="trash"
                  onClick={() => {
                    const gone = new Set(selected.map((row) => row.id))
                    savePoints(
                      points.filter((point) => !gone.has(point.id)),
                      'edited'
                    )
                    clear()
                  }}
                >
                  Remove
                </Button>
              </>
            )}
            rowMenu={rowMenu}
            summary={() =>
              `${points.length} points in ${new Set(points.map((p) => p.section)).size} sections · version ${profile?.current ?? 1}`
            }
            empty={<p className="tw-muted">No profile yet. Go back and write it.</p>}
            pageSize="all"
            maxBodyHeight={520}
          />
        </div>
        <aside className="tw-rail" aria-label="Profile version and suggestions">
          <Panel title={`Version ${profile?.current ?? 1}`} actions={<Chip tone="ok">Saved</Chip>}>
            <dl className="tw-kv">
              <div>
                <dt>Written</dt>
                <dd>
                  {writtenLabel(current?.writtenAt)}
                  {newCount > 0 ? ' · changes marked New' : ''}
                </dd>
              </div>
              <div>
                <dt>Template</dt>
                <dd className="mono">{current?.templateName ?? 'Your edits'}</dd>
              </div>
              <div>
                <dt>Markets</dt>
                <dd>One profile for {marketLabels.join(', ') || 'your markets'}</dd>
              </div>
            </dl>
            <div className="tw-rail-foot">
              {previous ? (
                <Button size="sm" onClick={() => patch({ profileVersion: previous })}>
                  Use version {previous}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                icon="sparkle"
                busy={rewriting}
                onClick={() => void rewriteAll()}
              >
                Rewrite all
              </Button>
            </div>
          </Panel>
          {ai.phase === 'idle' ? (
            <Panel title="Fill gaps from your site" tone="inset">
              <p className="tw-muted">
                CiteFox AI reads your site again and adds what the profile misses.
              </p>
              <div className="tw-rail-foot">
                <Button size="sm" icon="sparkle" onClick={() => runSection(null, 'discover')}>
                  Fill gaps
                </Button>
                <span className="tw-note">30 s · no searches</span>
              </div>
            </Panel>
          ) : (
            <AiCard
              state={ai}
              info={answer?.info ?? null}
              meta={
                answer && answer.suggestions.length > 0
                  ? `${answer.suggestions.length} ${answer.suggestions.length === 1 ? 'addition' : 'additions'} across ${new Set(answer.suggestions.map((s) => s.section)).size} sections`
                  : undefined
              }
              body={answer?.explanation ?? undefined}
              items={answer?.suggestions.map((item) => ({
                id: item.id,
                label: TOPIC_PROFILE_SECTION_LABEL[item.section],
                text: item.text,
                detail: item.verify ? `[Re-check] ${item.verify}` : item.foundIn
              }))}
              recheckCount={answer?.toVerify ?? 0}
              {...(answer && answer.suggestions.length > 0
                ? {
                    onApply: applySuggestions,
                    onUndo: () => {
                      if (undoVersion !== null) patch({ profileVersion: undoVersion })
                    }
                  }
                : {})}
            />
          )}
        </aside>
      </div>
    </StepFrame>
  )
}
