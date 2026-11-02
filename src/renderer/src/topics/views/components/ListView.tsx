import { useMemo, useState, type JSX } from 'react'
import { errorText } from '../../../components/errorText'
import { createGridCsvExport } from '../../../grid/adapters'
import type { GridCsvExport } from '../../../grid/types'
import { Button, IconButton, ListGrid, ToolButton } from '../../../ui'
import { matchText, searchesCsv, type Search } from '../model'
import type { ViewEnv } from '../types'
import { searchColumns } from './columns'
import { kindFilter, kindMatches } from './kindFilter'

/**
 * Left out first, in this order, while the window is too narrow for every column, so the
 * default view never scrolls sideways: Type (the Questions · Keywords filter covers it),
 * Stage (the Tree groups by it), Best page (AI) (a hint; the Columns menu brings it
 * back), then the Questions screen's topic or page.
 */
const NARROW_DROPS: readonly string[] = ['type', 'stage', 'best', 'source']

/**
 * The List view (TopicList): every search in one flat list, best win odds first; sort
 * any column, filter Questions or Keywords, tick rows for Get fix brief, Change target
 * (the page those searches should be cited from), Move to topic… and Export. The ticked
 * rows are in the URL (`sel`).
 */
export function ListView({
  env,
  label,
  selection,
  onSelectionChange,
  onMove,
  fileName,
  writeCsv: given
}: {
  env: ViewEnv
  label: string
  selection: readonly string[]
  onSelectionChange: (ids: readonly string[]) => void
  /** Moves the ticked searches to another topic (the shared Move questions dialog). */
  onMove: (searches: readonly Search[]) => void
  /** The CSV's file name without the date, such as `example-att-gateway`. */
  fileName: string
  /** Tests pass a fake. */
  writeCsv?: GridCsvExport
}): JSX.Element {
  const writeCsv = useMemo(() => given ?? createGridCsvExport(), [given])
  const [note, setNote] = useState<string | null>(null)
  const rows = useMemo(
    () =>
      matchText(
        env.searches.filter((search) => kindMatches(search, env.type)),
        env.q
      ),
    [env.searches, env.type, env.q]
  )
  const columns = useMemo(
    () =>
      searchColumns({
        site: env.site,
        source: env.questionsScreen ?? false,
        citedLabel: `Page ${env.words.engine ?? 'Google'} cited`
      }),
    [env.site, env.questionsScreen, env.words.engine]
  )

  async function exportRows(picked: readonly Search[]): Promise<void> {
    setNote(null)
    try {
      const result = await writeCsv(searchesCsv(picked, fileName, new Date(), env.words))
      if (result.ok) setNote(`Saved ${result.rowCount} rows to ${result.fileName}.`)
      else if (result.reason === 'failed') setNote(result.message)
    } catch (cause) {
      setNote(errorText(cause, 'Could not export these rows.'))
    }
  }

  return (
    <div className="tv-stack">
      <ListGrid
        label={label}
        engine={env.engine}
        noun={['search', 'searches']}
        rows={rows}
        rowKey={(row) => row.id}
        rowLabel={(row) => `${row.ref} ${row.text}`}
        columns={columns}
        narrowDrops={NARROW_DROPS}
        search={{
          text: (row) => `${row.ref} ${row.text}`,
          placeholder: `Search ${env.searches.length} searches`
        }}
        searchValue={env.q}
        onSearchChange={env.setQ}
        filter={kindFilter(env)}
        columnsMenu
        initialSort={[{ key: 'odds', dir: 'desc' }]}
        pageSize={50}
        selection={selection}
        onSelectionChange={onSelectionChange}
        bulk={({ selected, clear }) => (
          <>
            {env.chooseOwner ? (
              <IconButton
                icon="target"
                label="Change target"
                tip
                size="sm"
                onClick={() => env.chooseOwner?.(selected)}
              />
            ) : null}
            <IconButton
              icon="folder"
              label="Move to topic…"
              tip
              size="sm"
              onClick={() => {
                onMove(selected)
                clear()
              }}
            />
            <ToolButton kind="csv" onClick={() => void exportRows(selected)} />
            <Button size="sm" variant="primary" onClick={() => env.openBrief(selected)}>
              Get fix brief
            </Button>
          </>
        )}
        onActivate={env.openSearch}
        empty={<p className="tv-empty">No searches match.</p>}
      />
      {note ? (
        <p className="tv-note-line" role="status">
          {note}
        </p>
      ) : null}
    </div>
  )
}
