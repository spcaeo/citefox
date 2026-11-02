import type { JSX } from 'react'
import { Markdown } from '../components/Markdown'
import { openDrawer, setDrawerParams } from '../shell/drawers'
import { Drawer, DrawerGrid, DrawerMain, DrawerRail, DrawerSection } from '../ui'
import { HELP_DRAWER, HELP_ID_PARAM } from './openHelp'
import { helpTopic, helpTopics, helpTopicsFor, type HelpTopic } from './topics'
import './help.css'

/** Other topics worth a click next to `topic`: the same screen's first, then every screen's. */
function related(topic: HelpTopic | null): readonly HelpTopic[] {
  const pool = topic === null ? helpTopics() : helpTopicsFor(topic.screen)
  const rest = topic === null ? [] : helpTopics().filter((item) => !pool.includes(item))
  return [...pool, ...rest].filter((item) => item.id !== topic?.id).slice(0, 8)
}

/**
 * One help topic as rendered markdown (`drawer=help&help.id=<id>`), over any screen,
 * with or without an open project. No id or an unknown id lists every topic instead.
 * Links to other topics swap the topic in place; Ask CiteFox opens over it.
 */
export function HelpDrawer({
  id,
  depth,
  onClose
}: {
  id: string | null
  depth: number
  onClose: () => void
}): JSX.Element {
  const topic = helpTopic(id)
  const more = related(topic)
  // A new history entry, so Back returns to the topic before.
  const show = (next: string): void =>
    setDrawerParams(depth, { [HELP_ID_PARAM]: next }, { push: true })
  return (
    <Drawer
      id={HELP_DRAWER}
      title={topic?.title ?? 'Help'}
      subtitle={topic?.summary ?? 'Short answers about every screen in CiteFox.'}
      focusOnOpen="close"
      testId="help-drawer"
      onClose={onClose}
      footer={{
        cancel: 'Close',
        secondary: {
          label: 'Ask CiteFox',
          onClick: () => openDrawer('ask')
        }
      }}
    >
      <DrawerGrid>
        <DrawerMain>
          {topic === null ? (
            <div className="help-index">
              {id ? <p className="help-missing">That help topic was not found.</p> : null}
              <TopicList topics={helpTopics()} onPick={show} />
            </div>
          ) : (
            <article className="help-body" data-help-topic={topic.id}>
              {/* `##` sections are h3 under the drawer's h2 title; `###` questions are h4. */}
              <Markdown baseLevel={2}>{topic.body}</Markdown>
            </article>
          )}
        </DrawerMain>
        {topic !== null && more.length > 0 ? (
          <DrawerRail label="More help">
            <DrawerSection title="More help">
              <TopicList topics={more} onPick={show} />
            </DrawerSection>
          </DrawerRail>
        ) : null}
      </DrawerGrid>
    </Drawer>
  )
}

function TopicList({
  topics,
  onPick
}: {
  topics: readonly HelpTopic[]
  onPick: (id: string) => void
}): JSX.Element {
  return (
    <ul className="help-list">
      {topics.map((item) => (
        <li key={item.id}>
          <button type="button" className="help-link" onClick={() => onPick(item.id)}>
            {item.title}
          </button>
          <span className="help-line">{item.summary}</span>
        </li>
      ))}
    </ul>
  )
}
