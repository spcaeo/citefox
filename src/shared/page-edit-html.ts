import type { PageBlockKind, PageEditResult } from './ipc'
import { docRows, tableCells, type DocRow, type EditState } from './page-edit'

/**
 * The page with its edits as one HTML file for a writer: struck text is to
 * remove, yellow text is to add, each change with its reason underneath. Kept
 * changes read as normal text; undone ones are left out. No scripts, no remote
 * files: it opens anywhere and prints cleanly.
 */
export function pageEditHtml(
  edit: PageEditResult,
  state: EditState,
  searches: readonly string[],
  /** A moment as the computer shows it ("Oct 29, 3:12 PM"): the renderer's formatMoment. */
  when: (iso: string) => string
): string {
  const rows = docRows(edit, state)
  const title = `Page edits · ${pathOf(edit.url)}`
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(title)}</title>`,
    `<style>${STYLE}</style>`,
    '</head><body>',
    '<header>',
    `<p class="meta">Page: ${/^https?:\/\//iu.test(edit.url) ? `<a href="${esc(edit.url)}">${esc(edit.url)}</a>` : esc(edit.url)} · Read ${esc(when(edit.readAt))}</p>`,
    edit.summary ? `<p class="summary">${esc(edit.summary)}</p>` : '',
    '<p class="legend"><del>Struck text</del> = remove · <ins>Yellow text</ins> = add · grey notes say why</p>',
    searches.length === 0
      ? ''
      : `<details open><summary>Searches this page should win (${searches.length})</summary><ol>${searches
          .map((search) => `<li>${esc(search)}</li>`)
          .join('')}</ol></details>`,
    '</header>',
    '<main>',
    body(rows),
    '</main>',
    `<footer>Made with CiteFox · ${esc(when(edit.savedAt))}</footer>`,
    '</body></html>'
  ].join('\n')
}

/** `att-email-to-text-alternative-edits.html`. */
export function pageEditFileName(url: string): string {
  const slug =
    pathOf(url)
      .replace(/^\/+|\/+$/gu, '')
      .split('/')
      .pop()
      ?.replace(/[^a-z0-9-]+/giu, '-')
      .replace(/^-+|-+$/gu, '')
      .toLowerCase() ?? ''
  return `${slug || 'home'}-edits.html`
}

/**
 * The same page as Markdown, for docs tools and writers: ~~struck~~ is to remove,
 * <mark>marked</mark> is to add (it shows yellow where Markdown allows HTML, and
 * reads plainly elsewhere), and each change's reason follows in italics.
 */
export function pageEditMarkdown(
  edit: PageEditResult,
  state: EditState,
  searches: readonly string[],
  when: (iso: string) => string
): string {
  const lines: string[] = [
    `# Page edits · ${pathOf(edit.url)}`,
    '',
    `Page: ${edit.url} · Read ${when(edit.readAt)}`,
    ''
  ]
  if (edit.summary) lines.push(edit.summary, '')
  lines.push('~~Struck text~~ = remove · <mark>Marked text</mark> = add · *Why:* lines say why', '')
  if (searches.length > 0) {
    lines.push(`## Searches this page should win (${searches.length})`, '')
    searches.forEach((search, index) => lines.push(`${index + 1}. ${search}`))
    lines.push('')
  }
  lines.push('---', '')
  let inList = false
  for (const row of docRows(edit, state)) {
    const why = row.type === 'block' ? row.cut?.why : row.open ? row.change.why : undefined
    const mark = row.type === 'block' ? (row.cut ? 'cut' : null) : row.open ? 'add' : null
    if (row.kind !== 'li' && inList) lines.push('')
    inList = row.kind === 'li'
    lines.push(mdRow(row.kind, row.text, mark))
    if (why) lines.push(row.kind === 'li' ? `  *Why: ${why}*` : `*Why: ${why}*`)
    if (!inList) lines.push('')
  }
  lines.push('', `Made with CiteFox · ${when(edit.savedAt)}`, '')
  return lines.join('\n')
}

/** `att-email-to-text-alternative-edits.md`. */
export function pageEditMdFileName(url: string): string {
  return pageEditFileName(url).replace(/\.html$/u, '.md')
}

function mdRow(kind: PageBlockKind, text: string, mark: 'cut' | 'add' | null): string {
  const wrap = (value: string): string =>
    mark === 'cut' ? `~~${value}~~` : mark === 'add' ? `<mark>${value}</mark>` : value
  switch (kind) {
    case 'h1':
      return `# ${wrap(text)}`
    case 'h2':
      return `## ${wrap(text)}`
    case 'h3':
      return `### ${wrap(text)}`
    case 'h4':
      return `#### ${wrap(text)}`
    case 'li':
      return `- ${wrap(text)}`
    case 'quote':
      return `> ${wrap(text)}`
    case 'code':
    case 'table':
      // Code and tables keep their own syntax; a mark goes on the line before.
      return mark === null
        ? kind === 'code'
          ? `\`\`\`\n${text}\n\`\`\``
          : text
        : `${mark === 'cut' ? '~~Remove this:~~' : '<mark>Add this:</mark>'}\n\n${kind === 'code' ? `\`\`\`\n${text}\n\`\`\`` : text}`
    default:
      return wrap(text)
  }
}

function body(rows: readonly DocRow[]): string {
  const out: string[] = []
  let list: string[] = []
  const flush = (): void => {
    if (list.length > 0) out.push(`<ul>${list.join('')}</ul>`)
    list = []
  }
  for (const row of rows) {
    const html = rowHtml(row)
    if (row.kind === 'li') list.push(html)
    else {
      flush()
      out.push(html)
    }
  }
  flush()
  return out.join('\n')
}

function rowHtml(row: DocRow): string {
  const inner = row.kind === 'table' ? table(row.text) : esc(row.text)
  const why = row.type === 'block' ? row.cut?.why : row.open ? row.change.why : undefined
  const marked =
    row.type === 'block' && row.cut !== null
      ? `<del>${inner}</del>`
      : row.type === 'added' && row.open
        ? `<ins>${inner}</ins>`
        : inner
  const note = why ? `<span class="why">${esc(why)}</span>` : ''
  return wrap(row.kind, marked, note)
}

function wrap(kind: PageBlockKind, inner: string, note: string): string {
  switch (kind) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
      return `<${kind}>${inner}</${kind}>${note}`
    case 'li':
      return `<li>${inner}${note}</li>`
    case 'quote':
      return `<blockquote>${inner}</blockquote>${note}`
    case 'code':
      return `<pre>${inner}</pre>${note}`
    case 'table':
      return `<div class="table">${inner}</div>${note}`
    default:
      return `<p>${inner}</p>${note}`
  }
}

function table(text: string): string {
  const [head, ...rest] = tableCells(text)
  if (head === undefined) return esc(text)
  const cells = (row: string[], tag: 'th' | 'td'): string =>
    `<tr>${row.map((cell) => `<${tag}>${esc(cell)}</${tag}>`).join('')}</tr>`
  return `<table><thead>${cells(head, 'th')}</thead><tbody>${rest.map((row) => cells(row, 'td')).join('')}</tbody></table>`
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || '/'
  } catch {
    return url
  }
}

function esc(text: string): string {
  return text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
}

const STYLE = `
body{margin:48px auto;max-width:760px;padding:0 24px;color:#202020;font:16px/1.65 Inter,-apple-system,system-ui,sans-serif}
header{margin-bottom:32px;padding-bottom:20px;border-bottom:1px solid #e0e0e0}
.meta,.legend,footer{color:#646464;font-size:13px}
.summary{font-size:17px}
details{margin-top:12px;font-size:14px}
h1{font-size:32px;line-height:1.2}
h2{margin-top:32px;font-size:24px;line-height:1.3}
h3{font-size:19px}
del{color:#8d8d8d;text-decoration-color:#b42318}
ins{background:#fff3b0;text-decoration:none}
.why{display:block;margin:2px 0 14px;color:#646464;font-size:13px}
blockquote{margin:0;padding-left:16px;border-left:3px solid #e0e0e0}
pre{overflow:auto;padding:12px;background:#f6f6f6;border-radius:6px}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{padding:6px 10px;border:1px solid #e0e0e0;text-align:left}
footer{margin-top:48px;padding-top:12px;border-top:1px solid #e0e0e0}
@media print{details{display:block}}
`
