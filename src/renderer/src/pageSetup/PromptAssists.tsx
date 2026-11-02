import type { JSX } from 'react'
import type { AssistItem } from '@shared/ipc'
import { AssistPanel } from '../assist/AssistPanel'
import type { AssistClient } from '../assist/client'
import { pageHash } from '../shell/routes'

type Undo = () => Promise<void>

/** "Write more like this" and "Check against the page" above the prompt list. */
export function PromptSetAssists({
  projectId,
  pageId,
  marketId,
  client,
  onAdd
}: {
  projectId: string
  pageId: string
  marketId: string
  client?: AssistClient
  onAdd: (item: AssistItem) => Promise<Undo | void>
}): JSX.Element {
  return (
    <div className="ps-stack" aria-label="CiteFox AI suggestions for this set" role="group">
      <AssistPanel
        assistId="prompts.more"
        projectId={projectId}
        pageId={pageId}
        marketId={marketId}
        buttonLabel="Write more like this"
        addLabel="Add"
        client={client}
        actions={{ add: onAdd }}
      />
      <AssistPanel
        assistId="prompts.checkPage"
        projectId={projectId}
        pageId={pageId}
        marketId={marketId}
        buttonLabel="Check against the page"
        client={client}
      />
      <p className="faint">
        Each row also has a Rephrase button.{' '}
        <a href={pageHash(pageId, 'gaps')}>See what to change in Content gaps</a>
      </p>
    </div>
  )
}

/** One prompt's "Rephrase" assist, opened from its row. Apply edits that prompt. */
export function RephraseAssist({
  projectId,
  pageId,
  marketId,
  promptId,
  client,
  onApply
}: {
  projectId: string
  pageId: string
  marketId: string | null
  promptId: string
  client?: AssistClient
  onApply: (item: AssistItem) => Promise<Undo | void>
}): JSX.Element {
  return (
    <div role="gridcell" className="ps-stack" style={{ flex: '1 1 100%', minWidth: 0 }}>
      <AssistPanel
        assistId="prompts.rephrase"
        projectId={projectId}
        pageId={pageId}
        marketId={marketId}
        promptId={promptId}
        inputs={{ promptId }}
        buttonLabel="Rephrase"
        client={client}
        actions={{ apply: onApply }}
      />
    </div>
  )
}
