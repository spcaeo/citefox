import type { JSX } from 'react'
import type { ChangeLedger, ChangeRow } from '@shared/ipc'
import { changeStatusLabel } from '@shared/fix-loop'
import { pluralize } from '@shared/pluralize'
import type { AssistClient } from '../../assist/client'
import { useAiContext } from '../../assistant/context/useAiContext'
import { citedRows, nextFixNumber, pageName } from '../../changes/model'
import { ScreenDrawerLevel } from '../../shell/DrawerLevel'
import {
  Drawer,
  DrawerFacts,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection,
  UrlText,
  useAssistMenu
} from '../../ui'
import { pathOf } from '../model'

/**
 * "Draft the fix" for one page of the next round (`?draft=<pageId>`, a drawer kept
 * in the screen's own URL value): the section's one AI menu runs
 * `progress.draftFix` on that page. "Log as a fix" hands the draft to the fix
 * drawer; nothing is written to the page.
 */
export function DraftPanel(props: {
  ledger: ChangeLedger
  row: ChangeRow
  projectId: string
  assistClient?: AssistClient
  onClose: () => void
  /** Closes this drawer and opens the fix drawer on the page, with the draft. */
  onLog: (text: string) => void
}): JSX.Element {
  return (
    <ScreenDrawerLevel onClose={props.onClose}>
      <DraftDrawer {...props} />
    </ScreenDrawerLevel>
  )
}

function DraftDrawer({
  ledger,
  row,
  projectId,
  assistClient,
  onClose,
  onLog
}: {
  ledger: ChangeLedger
  row: ChangeRow
  projectId: string
  assistClient?: AssistClient
  onClose: () => void
  onLog: (text: string) => void
}): JSX.Element {
  const fixNumber = nextFixNumber(ledger.rows, row.pageId)
  const { menu, card } = useAssistMenu({
    label: `AI actions for ${pathOf(row.url)}`,
    scope: {
      projectId,
      pageId: row.pageId,
      marketId: row.now?.marketId ?? null,
      ...(assistClient ? { client: assistClient } : {})
    },
    footer: 'Uses the checks already saved. No new searches.',
    actions: [
      {
        assistId: 'progress.draftFix',
        label: `Draft Fix ${fixNumber}`,
        seconds: 10,
        inputs: { fixNumber },
        applyLabel: 'Log as a fix',
        onApply: (result, ids) => {
          const chosen = result.items.filter((item) => ids.length === 0 || ids.includes(item.id))
          onLog(chosen.map((item) => item.text).join('\n\n'))
        }
      }
    ]
  })
  const cited = citedRows(row.now).length
  useAiContext({
    pageId: row.pageId,
    entities: [{ kind: 'page', id: row.pageId, label: pageName(row) }],
    capabilities: ['draft-fix']
  })
  return (
    <Drawer
      id="draft-fix"
      title={`Draft the fix · ${pageName(row)}`}
      subtitle="CiteFox AI drafts the next fix from this page’s latest check."
      focusOnOpen="close"
      onClose={onClose}
      footer={{
        cancel: 'Close',
        primary: { label: 'Log a fix', icon: 'plus', onClick: () => onLog('') }
      }}
    >
      <DrawerGrid>
        <DrawerMain>
          <DrawerSection title={`Fix ${fixNumber}`} actions={menu}>
            {card ?? (
              <p className="muted">
                Open the AI menu to draft Fix {fixNumber}. Log it as a fix to track what it changes.
              </p>
            )}
          </DrawerSection>
        </DrawerMain>
        <DrawerRail label="The page">
          <DrawerSection title="The page">
            <DrawerFacts
              label="The page"
              items={[
                {
                  label: 'Page',
                  value: <UrlText url={row.url} label={pathOf(row.url)} site={ledger.domain} />
                },
                { label: 'Status', value: changeStatusLabel(row.status) },
                {
                  label: 'Latest check',
                  value: row.now
                    ? `Cited for ${pluralize(cited, 'question')} of ${row.now.rows.length}`
                    : 'Not checked since it went live'
                }
              ]}
            />
          </DrawerSection>
        </DrawerRail>
      </DrawerGrid>
    </Drawer>
  )
}
