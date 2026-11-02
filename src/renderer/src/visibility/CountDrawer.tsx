import type { JSX } from 'react'
import { DrillDrawer } from '../drill/DrillDrawer'
import { ScreenDrawerLevel } from '../shell/DrawerLevel'
import type { DrillTarget } from '../drill/types'
import type { CountItem } from './citations'

/**
 * Compatibility wrapper over the shared drill drawer for flat lists (links,
 * checks). Lists exactly the rows that opened it; the heading states that
 * count. New code builds an `ItemDrill` and calls `useDrill().open`.
 */
export function CountDrawer({
  title,
  description,
  items,
  noun,
  primaryLabel = 'Item',
  id = `count:${title}`,
  targets,
  onClose
}: {
  title: string
  description: string
  items: readonly CountItem[]
  /**
   * Row noun, singular and plural, such as ['check', 'checks']. Unset keeps the
   * old heading "Title · N" and calls the rows items.
   */
  noun?: readonly [string, string]
  /** Header of the first column. Default "Item". */
  primaryLabel?: string
  /** NFR-14 id of the control that opened it. */
  id?: string
  /** Where each item opens, by item id. */
  targets?: Readonly<Record<string, DrillTarget>>
  onClose: () => void
}): JSX.Element {
  return (
    <ScreenDrawerLevel onClose={onClose}>
      <DrillDrawer
        drill={{
          kind: 'items',
          id,
          title: noun ? title : `${title} · ${items.length}`,
          omitCount: noun === undefined,
          description,
          noun: noun ?? ['item', 'items'],
          primaryLabel,
          items: items.map((item) => ({
            id: item.id,
            primary: item.primary,
            mono: true,
            secondary: item.secondary,
            target: targets?.[item.id] ?? null
          })),
          scope: {
            pageId: null,
            marketId: null,
            runId: null,
            marketLabel: '',
            checkDateLabel: '',
            brand: '',
            domain: ''
          }
        }}
        onClose={onClose}
      />
    </ScreenDrawerLevel>
  )
}
