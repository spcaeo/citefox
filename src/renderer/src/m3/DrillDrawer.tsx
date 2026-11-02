import type { JSX } from 'react'
import type { PromptCheckRow } from '@shared/domain'
import { DrillDrawer as Drawer } from '../drill/DrillDrawer'
import { ScreenDrawerLevel } from '../shell/DrawerLevel'
import type { DrillSpec } from './model'

/**
 * Compatibility wrapper over the shared drill drawer (`drill/DrillDrawer`) for
 * screens that still hold their own drawer state with a `DrillSpec`. New code
 * builds a `DrillRequest` (`drill/fromResults`) and calls `useDrill().open`.
 */
export function DrillDrawer({
  pageId,
  marketId = null,
  runId = null,
  drill,
  rows,
  brand,
  domain,
  marketLabel,
  checkDateLabel,
  onClose
}: {
  /** Opens each row's prompt detail. Omitted where the drawer has no page (no links). */
  pageId?: string
  /** The market the rows come from, so prompt links open in it. */
  marketId?: string | null
  /** The check the rows come from. Null is the latest check. */
  runId?: string | null
  drill: DrillSpec
  rows: readonly PromptCheckRow[]
  brand: string
  domain: string
  marketLabel: string
  checkDateLabel: string
  onClose: () => void
}): JSX.Element {
  return (
    <ScreenDrawerLevel onClose={onClose}>
      <Drawer
        drill={{
          kind: 'prompts',
          id: drill.id,
          title: drill.title,
          description: drill.description,
          omitCount: drill.omitCount,
          rows,
          scope: {
            pageId: pageId ?? null,
            marketId,
            runId,
            marketLabel,
            checkDateLabel,
            brand,
            domain
          }
        }}
        onClose={onClose}
      />
    </ScreenDrawerLevel>
  )
}
