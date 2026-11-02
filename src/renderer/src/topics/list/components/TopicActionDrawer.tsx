import { useState, type JSX } from 'react'
import { errorText } from '../../../components/errorText'
import { ScreenDrawerLevel } from '../../../shell/DrawerLevel'
import { topicHash } from '../../../shell/routes'
import { Drawer, DrawerFacts, DrawerGrid, DrawerMain, DrawerRail, DrawerSection } from '../../../ui'
import { stageLabel, type ClustersSource } from '../../clusters'
import { mergeTopics } from '../../settings/actions'
import { countText, splitPreview, type TopicLine } from '../model'

/** What a finished action tells the screen: its message, and how to undo a delete. */
export interface ActionDone {
  message: string
  /** The topic a delete removed, for Undo. */
  deleted?: { id: string; name: string }
  /** The window-wide toast already said it (with Undo), so the screen adds no status line. */
  toasted?: boolean
}

/** Questions listed by name before the rest are counted. */
const LISTED_MAX = 12

/**
 * Merge or split a topic (`#/topics?action=<merge|split>&topic=<id>`), a drawer
 * on the screen's own URL value: what moves where, then one call. Questions move
 * with their history and nothing is searched. Merge with no other topic says so
 * and offers a new topic instead.
 */
export function TopicActionDrawer({
  action,
  line,
  lines,
  projectId,
  source,
  onClose,
  onDone,
  onNewTopic
}: {
  action: 'merge' | 'split'
  line: TopicLine
  /** Every listed topic (merge picks one of the others). */
  lines: readonly TopicLine[]
  projectId: string
  source: ClustersSource
  onClose: () => void
  onDone: (done: ActionDone) => void
  /** Merge with no other topic: start a new empty one instead. */
  onNewTopic?: () => void
}): JSX.Element {
  const others = lines.filter((other) => other.id !== line.id)
  const [into, setInto] = useState<string>(others[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const split = splitPreview(line)
  const target = others.find((other) => other.id === into) ?? null

  async function run(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      if (action === 'merge') {
        if (target === null) throw new Error('Pick a topic to merge into.')
        // The toast offers Undo (the topic comes back with its questions).
        onDone({ message: await mergeTopics(source, projectId, [line], target), toasted: true })
        return
      }
      const result = await source['topics:split']({ projectId, topicId: line.id })
      onDone({ message: result.message })
    } catch (cause) {
      setError(errorText(cause, 'That did not work. Try again.'))
      setSaving(false)
    }
  }

  const trail = [{ label: line.name, href: topicHash(line.id) }]
  const errorLine = error ? (
    <span className="ui-drawer-error" role="alert">
      {error}
    </span>
  ) : null

  if (action === 'split') {
    return (
      <ScreenDrawerLevel onClose={onClose}>
        <Drawer
          id="topic-split"
          title="Split by stage"
          trail={trail}
          subtitle={`${line.name} · each other stage becomes its own topic, with its checks.`}
          busy={saving}
          closeDisabled={saving}
          onClose={onClose}
          testId="topic-split-drawer"
          footer={{
            summary: errorLine ?? (
              <>
                <strong className="num">{countText(split.topics.length, 'new topic')}</strong> ·
                questions keep their history · No new searches
              </>
            ),
            primary: {
              label: `Split into ${split.topics.length + 1} topics`,
              busy: saving,
              disabled: split.topics.length === 0,
              onClick: () => void run()
            }
          }}
        >
          <DrawerGrid className="tl-action">
            <DrawerMain>
              <DrawerSection
                title="New topics"
                count={split.topics.length}
                description={
                  split.keep === null
                    ? 'This topic has no stages to split by.'
                    : 'One per stage, named after this topic.'
                }
              >
                {split.topics.length > 0 ? (
                  <ul className="tl-split" aria-label="New topics">
                    {split.topics.map((topic) => (
                      <li key={topic.stage}>
                        <span>{topic.name}</span>
                        <span className="tl-choice-note num">
                          {countText(topic.questions, 'question')}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="faint">Give its questions two or more stages first.</p>
                )}
              </DrawerSection>
            </DrawerMain>
            <DrawerRail label="What stays">
              <DrawerSection title="What stays">
                <p>
                  {split.keep === null
                    ? `${countText(split.kept, 'question')} stay in ${line.name}.`
                    : `${countText(split.kept, 'question')} stay in ${line.name} (${stageLabel(split.keep)} and no stage).`}
                </p>
              </DrawerSection>
            </DrawerRail>
          </DrawerGrid>
        </Drawer>
      </ScreenDrawerLevel>
    )
  }

  const alone = others.length === 0
  const moving = line.rows.length
  return (
    <ScreenDrawerLevel onClose={onClose}>
      <Drawer
        id="topic-merge"
        title="Merge into another topic"
        trail={trail}
        subtitle={`${line.name} · its questions move into the topic you pick, with their checks. Then ${line.name} is removed.`}
        dirty={!alone && into !== (others[0]?.id ?? '')}
        busy={saving}
        closeDisabled={saving}
        onClose={onClose}
        testId="topic-merge-drawer"
        footer={
          alone
            ? {
                summary: 'Nothing to merge into yet.',
                ...(onNewTopic
                  ? {
                      secondary: { label: 'New topic', icon: 'plus' as const, onClick: onNewTopic }
                    }
                  : {}),
                cancel: 'Close'
              }
            : {
                summary: errorLine ?? (
                  <>
                    Moves <strong className="num">{countText(moving, 'question')}</strong> with
                    their history · No new searches
                  </>
                ),
                primary: {
                  label: 'Merge topics',
                  busy: saving,
                  disabled: target === null,
                  onClick: () => void run()
                }
              }
        }
      >
        {alone ? (
          <DrawerGrid className="tl-action">
            <DrawerSection span={12} title="Merging needs two topics" testId="merge-needs-two">
              <p>
                {line.name} is the only topic, so there is nothing to merge it into yet. Start
                another topic first, then merge.
              </p>
            </DrawerSection>
          </DrawerGrid>
        ) : (
          <DrawerGrid className="tl-action">
            <DrawerMain>
              <DrawerSection title="Merge into" count={others.length}>
                <fieldset className="tl-choices">
                  <legend className="sr-only">Merge into</legend>
                  {others.map((other) => (
                    <label key={other.id} className="tl-choice">
                      <input
                        type="radio"
                        name="into"
                        value={other.id}
                        checked={into === other.id}
                        onChange={() => setInto(other.id)}
                      />
                      <span>{other.name}</span>
                      <span className="tl-choice-note num">
                        {countText(other.questionRows.length, 'question')}
                      </span>
                    </label>
                  ))}
                </fieldset>
              </DrawerSection>
              <DrawerSection title="Questions that move" count={moving}>
                <ul className="tl-moving" aria-label="Questions that move">
                  {line.rows.slice(0, LISTED_MAX).map((row) => (
                    <li key={row.promptId}>{row.text}</li>
                  ))}
                </ul>
                {moving > LISTED_MAX ? (
                  <p className="faint">and {countText(moving - LISTED_MAX, 'more question')}</p>
                ) : null}
              </DrawerSection>
            </DrawerMain>
            <DrawerRail label="Before and after">
              <DrawerSection title="Before and after">
                <DrawerFacts
                  label="Before and after"
                  items={[
                    {
                      label: line.name,
                      value: <span className="num">{line.rows.length} → 0</span>,
                      hint: 'then removed'
                    },
                    ...(target
                      ? [
                          {
                            label: target.name,
                            value: (
                              <span className="num">
                                {target.rows.length} → {target.rows.length + moving}
                              </span>
                            )
                          }
                        ]
                      : [])
                  ]}
                />
              </DrawerSection>
            </DrawerRail>
          </DrawerGrid>
        )}
      </Drawer>
    </ScreenDrawerLevel>
  )
}
