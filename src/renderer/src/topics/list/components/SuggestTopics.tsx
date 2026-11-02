import { useEffect, useRef, type JSX } from 'react'
import { pathOf } from '../../clusters'
import {
  AssistProgress,
  Button,
  EmptyState,
  IconButton,
  ToolButton,
  SectionHead,
  useAssistProgress
} from '../../../ui'
import type { SuggestTopics as Suggest } from '../hooks/useSuggestTopics'
import { countText } from '../model'

/**
 * Suggest topics (Docs/TOPICS-SPEC.md §8.1): Claude's ideas from the site, the buyer
 * profile and the competitors. Each shows an example question, about how many
 * questions it brings and the page that fits. Ticked ideas become topics with draft
 * questions; nothing is searched until Check now.
 */
export function SuggestTopics({
  domain,
  suggest,
  onClose
}: {
  domain: string
  suggest: Suggest
  onClose: () => void
}): JSX.Element {
  const progress = useAssistProgress(suggest.phase === 'asking', 'topics:suggestTopics')
  const picked = suggest.ideas.filter((idea) => suggest.ticked.has(idea.id))
  const questions = picked.reduce((sum, idea) => sum + idea.questions.length, 0)
  const busy = suggest.phase === 'asking' || suggest.phase === 'creating'
  const sectionRef = useRef<HTMLElement>(null)

  // Opened below the topics list: bring it into view so the press shows something.
  useEffect(() => {
    sectionRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])

  return (
    <section ref={sectionRef} className="tl-suggest" aria-labelledby="tl-suggest-title">
      <SectionHead
        id="tl-suggest-title"
        title={`Suggested topics for ${domain}`}
        description="From your site, buyer profile and competitors. Nothing is searched."
        actions={<IconButton icon="x" size="sm" tip label="Close suggestions" onClick={onClose} />}
      />
      {suggest.phase === 'asking' ? (
        <AssistProgress
          progress={progress}
          title="CiteFox AI is suggesting topics"
          reads="uses your site and saved data, no searches"
          expectedSeconds={20}
        />
      ) : suggest.phase === 'idle' ? (
        <EmptyState
          compact
          icon="sparkle"
          title="Ask CiteFox AI for topic ideas"
          body="It reads your site, buyer profile and competitors. No searches."
          action={
            <Button size="sm" icon="sparkle" onClick={() => suggest.ask(false)}>
              Suggest topics
            </Button>
          }
        />
      ) : suggest.ideas.length === 0 ? (
        <EmptyState
          compact
          icon="sparkle"
          title={suggest.phase === 'error' ? 'No suggestions this time' : 'No more ideas to show'}
          body={suggest.message ?? 'Ask again for different topics.'}
          action={
            <Button size="sm" onClick={() => suggest.ask(suggest.phase !== 'error')}>
              Suggest others
            </Button>
          }
        />
      ) : (
        <>
          <ul className="tl-ideas">
            {suggest.ideas.map((idea) => {
              const id = `tl-idea-${idea.id}`
              return (
                <li key={idea.id} className="tl-idea">
                  <input
                    id={id}
                    type="checkbox"
                    checked={suggest.ticked.has(idea.id)}
                    disabled={busy}
                    onChange={() => suggest.toggle(idea.id)}
                  />
                  <label htmlFor={id} className="tl-idea-body">
                    <span className="tl-idea-name">{idea.name}</span>
                    <span className="tl-idea-example">e.g. “{idea.example}”</span>
                    <span className="tl-idea-meta">
                      ~{countText(idea.questions.length, 'question')} · fits{' '}
                      {idea.fitsUrl === null ? 'a new page' : pathOf(idea.fitsUrl)}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
          <div className="tl-suggest-foot">
            <p className="tl-suggest-count" role="status">
              {suggest.message !== null && suggest.phase !== 'creating' ? (
                <span className={suggest.phase === 'error' ? 'tl-error' : undefined}>
                  {suggest.message}
                </span>
              ) : (
                <>
                  <strong>
                    {countText(picked.length, 'topic')}, ~{countText(questions, 'question')}
                  </strong>{' '}
                  <span className="faint">· you review them first</span>
                </>
              )}
            </p>
            <div className="tl-suggest-actions">
              <ToolButton
                kind="refresh"
                label="Suggest others"
                disabled={busy}
                onClick={() => suggest.ask(true)}
              />
              <Button
                size="sm"
                variant="primary"
                disabled={picked.length === 0}
                busy={suggest.phase === 'creating'}
                onClick={() => void suggest.create()}
              >
                {picked.length === 0
                  ? 'Create topics'
                  : picked.length === 1
                    ? 'Create 1 topic'
                    : `Create ${picked.length} topics`}
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
