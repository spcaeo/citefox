import type { RenderContext } from './context'
import { esc, slugId } from './escape'

/** Table helper: titled tables with a CSV button, top-N rows and "Show all". */

export type CellValue = string | number | null

export interface Column<T> {
  header: string
  /** Cell HTML. Strings from the model must already be escaped. */
  html: (row: T) => string
  /** The plain value written to the CSV. */
  csv: (row: T) => CellValue
  /** `num` right-aligns, `wide` lets prose wrap, `nowrap` keeps one line, `path` is a URL path. */
  kind?: 'num' | 'wide' | 'nowrap' | 'center' | 'path'
  /** Sort key for sortable tables. Defaults to the CSV value. */
  sort?: (row: T) => string | number | null
}

export interface TableSpec<T> {
  /** Unique within the report. The CSV button and embedded data use it. */
  id: string
  title: string
  columns: readonly Column<T>[]
  rows: readonly T[]
  /** Rows shown before "Show all". Default 10. */
  limit?: number
  /** Shown instead of the table when there are no rows. */
  empty?: string
  sortable?: boolean
  /** Adds a filter box above the table. */
  filter?: boolean
  /** The heading above already names the table: show only the row count. */
  quiet?: boolean
  /** The row's value for segment chips (`data-seg`), which show only matching rows. */
  segment?: (row: T) => string
  /** The row's page URL. Adds "Copy all URLs" above the table. */
  url?: (row: T) => string | null
  /** Extra `data-*` attributes on each row (names without the `data-` prefix). */
  rowData?: (row: T) => Readonly<Record<string, string>>
}

export function table<T>(ctx: RenderContext, spec: TableSpec<T>): string {
  const id = uniqueId(ctx, spec.id)
  const titleId = `tbl-${id}-title`
  if (spec.rows.length === 0) {
    return `<div class="tbl-block"><p class="tbl-title">${esc(spec.title)}</p><p class="tbl-empty">${esc(spec.empty ?? 'Nothing to show yet.')}</p></div>`
  }
  const urls = urlList(spec)
  ctx.tables[id] = {
    title: spec.title,
    columns: spec.columns.map((column) => column.header),
    rows: spec.rows.map((row) => spec.columns.map((column) => column.csv(row))),
    ...(urls.length > 0 ? { urls } : {})
  }
  const limit = spec.limit ?? 10
  const collapsible = spec.rows.length > limit
  const head = spec.columns
    .map((column, index) => {
      const cls = column.kind === undefined ? '' : ` class="${column.kind}"`
      const label =
        spec.sortable === true
          ? `<button type="button" class="sort" data-col="${index}">${esc(column.header)}<span class="sort-mark" aria-hidden="true"></span></button>`
          : esc(column.header)
      return `<th scope="col"${cls}>${label}</th>`
    })
    .join('')
  const body = spec.rows
    .map((row, rowIndex) => {
      const cells = spec.columns
        .map((column) => {
          const cls = column.kind === undefined ? '' : ` class="${column.kind}"`
          const key = spec.sortable === true ? sortAttr((column.sort ?? column.csv)(row)) : ''
          return `<td${cls}${key}>${column.html(row)}</td>`
        })
        .join('')
      const extra = rowIndex >= limit ? ' class="extra"' : ''
      const segment = spec.segment === undefined ? '' : ` data-seg="${esc(spec.segment(row))}"`
      const data =
        spec.rowData === undefined
          ? ''
          : Object.entries(spec.rowData(row))
              .map(([name, value]) => ` data-${slugId(name)}="${esc(value)}"`)
              .join('')
      return `<tr${extra}${segment}${data}>${cells}</tr>`
    })
    .join('')
  const filter =
    spec.filter === true
      ? `<label class="tbl-filter"><span class="sr-only">Filter ${esc(spec.title)}</span><input type="search" data-filter="${esc(id)}" placeholder="Filter this table" autocomplete="off"></label>`
      : ''
  const footer = collapsible
    ? `<p class="showing" data-showing="${esc(id)}"><span class="showing-text">Showing ${limit} of ${spec.rows.length}</span> — <button type="button" class="show-all" data-table="${esc(id)}" aria-expanded="false">Show all</button></p>`
    : ''
  const classes = ['tbl-block', collapsible ? 'collapsible collapsed' : '']
    .filter(Boolean)
    .join(' ')
  const sortable = spec.sortable === true ? ' data-sortable="true"' : ''
  return (
    `<div class="${classes}" data-table-wrap="${esc(id)}" data-limit="${limit}">` +
    `<div class="tbl-head">${titleHtml(spec, titleId)}` +
    `${filter}${urls.length > 0 ? urlsButton(id, spec.title) : ''}<button type="button" class="csv-btn" data-table="${esc(id)}" aria-label="${esc(`Download ${spec.title} as CSV`)}">CSV</button></div>` +
    `<div class="scroll"><table aria-labelledby="${titleId}" data-table-id="${esc(id)}"${sortable}>` +
    `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${footer}</div>`
  )
}

function urlList<T>(spec: TableSpec<T>): string[] {
  const pick = spec.url
  if (pick === undefined) return []
  const seen = new Set<string>()
  for (const row of spec.rows) {
    const url = pick(row)
    if (url !== null && /^https?:\/\//i.test(url)) seen.add(url)
  }
  return [...seen]
}

function urlsButton(id: string, title: string): string {
  return `<button type="button" class="urls-btn" data-table="${esc(id)}" aria-label="${esc(`Copy every URL in ${title}`)}">Copy all URLs</button>`
}

function titleHtml<T>(spec: TableSpec<T>, titleId: string): string {
  const rows = `${spec.rows.length} ${spec.rows.length === 1 ? 'row' : 'rows'}`
  if (spec.quiet === true) {
    return `<p class="tbl-title quiet" id="${titleId}"><span class="sr-only">${esc(spec.title)}, </span>${rows}</p>`
  }
  return `<p class="tbl-title" id="${titleId}">${esc(spec.title)} <span class="tbl-count" aria-label="${rows}">${spec.rows.length}</span></p>`
}

function sortAttr(value: string | number | null): string {
  if (value === null) return ' data-sort=""'
  return ` data-sort="${esc(String(value))}"`
}

function uniqueId(ctx: RenderContext, wanted: string): string {
  const base = slugId(wanted)
  let id = base
  let suffix = 2
  while (ctx.tables[id] !== undefined) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  return id
}
