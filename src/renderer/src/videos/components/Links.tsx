import { Fragment, type JSX } from 'react'
import type { VideoIdea } from '@shared/domain'
import { DrillLink } from '../../drill'
import { ideaPrompts } from '../utils/drill'
import { promptsLabel } from '../utils/model'

/** "Prompts 2, 5" where each number opens that prompt's Prompt detail. */
export function PromptLinks({
  idea,
  className
}: {
  idea: Pick<VideoIdea, 'prompts' | 'promptPositions' | 'pageLabel'>
  className?: string
}): JSX.Element {
  const prompts = ideaPrompts(idea)
  if (prompts.length === 0) {
    return <span className={className}>{promptsLabel(idea.promptPositions)}</span>
  }
  return (
    <span className={className}>
      {prompts.length === 1 ? 'Question ' : 'Questions '}
      {prompts.map((prompt, index) => (
        <Fragment key={prompt.promptId}>
          {index > 0 ? ', ' : null}
          <DrillLink
            className="yt-link"
            target={{ kind: 'prompt', pageId: prompt.pageId, promptId: prompt.promptId }}
            label={`Open question ${prompt.position} in Question detail`}
          >
            {prompt.position}
          </DrillLink>
        </Fragment>
      ))}
    </span>
  )
}

/** The page an idea is based on, opening its Results tab. */
export function PageLink({
  idea,
  className = 'yt-link'
}: {
  idea: Pick<VideoIdea, 'pageId' | 'pageLabel'>
  className?: string
}): JSX.Element {
  if (idea.pageId === '') return <span>{idea.pageLabel}</span>
  return (
    <DrillLink className={className} target={{ kind: 'page', pageId: idea.pageId }}>
      {idea.pageLabel}
    </DrillLink>
  )
}
