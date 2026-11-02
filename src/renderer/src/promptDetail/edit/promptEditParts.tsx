import type { ReactNode } from 'react'
import type { EngineId, Market } from '@shared/domain'
import type { PromptVersions } from '@shared/ipc'
import { IconButton, type MenuItem } from '../../ui'
import { DrawerLevel } from '../../shell/DrawerLevel'
import { currentWording } from './model'
import { PromptEditDrawer } from './PromptEditDrawer'
import type { PromptEditFlow } from './usePromptEditFlow'

export interface PromptEditParts {
  /** Edit question and Re-check now, for the top of "More". */
  items: MenuItem[]
  /** The small pencil after the heading. */
  pencil: ReactNode
  /** The open drawer (`?drawer=pd-edit` or `pd-recheck`), or null. */
  panel: ReactNode
}

/**
 * The pieces of "Edit question" / "Re-check now" that sit in the header: the menu
 * items, the pencil, and the drawer the URL opens. The flow (save, re-check,
 * progress) lives on the screen so it survives the move to the new prompt id.
 */
export function promptEditParts({
  flow,
  pageId,
  promptId,
  title,
  rowText,
  versions,
  markets,
  marketId,
  samples,
  engines = [],
  engine
}: {
  flow: PromptEditFlow
  pageId: string
  promptId: string
  title: string
  /** The wording the latest check shows, when the prompt has a result. */
  rowText: string | null
  versions: PromptVersions | null
  markets: readonly Market[]
  marketId: string
  samples: number
  /** The engines the page checks, for the re-check's engine choice. */
  engines?: readonly EngineId[]
  /** The engine tab on screen. */
  engine?: EngineId
}): PromptEditParts {
  const noun = versions?.rules.kind === 'keyword' ? 'keyword' : 'question'
  const running = flow.recheck.status === 'running'
  const busy = flow.saving || running
  const text = currentWording(versions, marketId) ?? rowText ?? ''
  const texts = versions?.steps[0]?.texts ?? []
  const checked = new Set(texts.map((item) => item.marketId))
  const own = texts.length > 0 ? markets.filter((market) => checked.has(market.id)) : markets
  const items: MenuItem[] = [
    { id: 'edit', label: `Edit ${noun}`, icon: 'pencil', onSelect: () => flow.open('edit') },
    {
      id: 'recheck',
      label: running ? 'Checking…' : 'Check now',
      icon: 'refresh',
      disabled: running,
      onSelect: () => flow.open('recheck')
    }
  ]
  const pencil = (
    <IconButton
      icon="pencil"
      size="sm"
      label={`Edit ${noun}`}
      title={`Edit ${noun}`}
      onClick={() => flow.open('edit')}
    />
  )
  const panel = flow.panel ? (
    <DrawerLevel depth={flow.depth}>
      <PromptEditDrawer
        key={`${promptId}:${flow.panel}`}
        mode={flow.panel}
        pageId={pageId}
        title={title}
        text={text}
        texts={texts}
        steps={versions?.steps ?? []}
        rules={versions?.rules ?? null}
        markets={own}
        marketId={marketId}
        samples={samples}
        searchesLeft={flow.searchesLeft}
        currentPromptId={versions?.currentPromptId ?? null}
        stale={versions !== null && !versions.active}
        busy={busy}
        error={flow.saveError}
        onSave={(request) => void flow.save(request)}
        engines={engines}
        {...(engine ? { engine } : {})}
        onRecheck={(picked, only) => flow.recheckNow(picked, marketId, only)}
        onClose={flow.close}
      />
    </DrawerLevel>
  ) : null
  return { items, pencil, panel }
}
