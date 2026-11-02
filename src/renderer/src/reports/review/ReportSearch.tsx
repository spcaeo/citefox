import { useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { pathOf, searchReport, type ReviewReport } from '@shared/report/review'
import { IconButton, SearchBox } from '../../ui'
import { openReportDetail, pageDetail, questionDetail, siteDetail } from './drill'

interface Hit {
  key: string
  group: 'Questions' | 'Sites' | 'Pages'
  label: string
  sub: string
  open: () => void
}

/**
 * One search for the whole report, in its header: questions, sites and your pages.
 * Picking a result opens its drawer over the screen.
 */
export function ReportSearch({ report }: { report: ReviewReport }): JSX.Element {
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const [shown, setShown] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const found = searchReport(report, text)
  const hits: Hit[] = [
    ...found.questions.map((item) => ({
      key: `q:${item.id}`,
      group: 'Questions' as const,
      label: item.text,
      sub: item.topic,
      open: () => openReportDetail(questionDetail(item.id))
    })),
    ...found.sites.map((site) => ({
      key: `s:${site.domain}`,
      group: 'Sites' as const,
      label: site.own ? `${site.domain} (you)` : site.domain,
      sub: `${site.now.n} ${site.now.n === 1 ? 'question' : 'questions'} · ${site.kindLabel}`,
      open: () => openReportDetail(siteDetail(site.domain))
    })),
    ...found.pages.map((page) => ({
      key: `p:${page.url}`,
      group: 'Pages' as const,
      label: page.title ?? page.path,
      sub: pathOf(page.url),
      open: () => openReportDetail(pageDetail(page.url))
    }))
  ]
  const pick = (hit: Hit | undefined): void => {
    if (hit === undefined) return
    hit.open()
    setText('')
    setActive(0)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => Math.min(hits.length - 1, index + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(0, index - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      pick(hits[active])
    } else if (event.key === 'Escape') {
      setText('')
    }
  }
  const open = text.trim().length > 0
  return (
    <div className={`rv-find${shown ? ' rv-find-open' : ''}`} role="search">
      {/* A narrow window: the search icon, which opens the box (Docs/DESIGN-GUIDELINES.md §2). */}
      <IconButton
        icon="search"
        size="sm"
        tip
        label="Search this report"
        className="rv-find-toggle"
        aria-expanded={shown}
        onClick={() => {
          setShown(true)
          window.setTimeout(() => input.current?.focus(), 0)
        }}
      />
      <SearchBox
        className="rv-find-box"
        label="Search questions, sites, pages"
        value={text}
        inputRef={input}
        onChange={(value) => {
          setText(value)
          setActive(0)
        }}
        inputProps={{
          'aria-label': 'Search this report',
          'aria-expanded': open,
          'aria-controls': 'rv-find-list',
          onBlur: () => {
            if (text.trim() === '') setShown(false)
          },
          onKeyDown
        }}
      />
      {open ? (
        <div className="rv-find-pop" id="rv-find-list" role="listbox" aria-label="Search results">
          {hits.length === 0 ? (
            <p className="rv-muted rv-find-empty">Nothing in this report matches.</p>
          ) : (
            hits.map((hit, index) => (
              <div key={hit.key}>
                {index === 0 || hits[index - 1]?.group !== hit.group ? (
                  <p className="rv-find-group">{hit.group}</p>
                ) : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  className={`rv-find-hit${index === active ? ' on' : ''}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(hit)}
                >
                  <span className="rv-find-label">{hit.label}</span>
                  <span className="rv-muted rv-find-sub">{hit.sub}</span>
                </button>
              </div>
            ))
          )}
          {found.total > hits.length ? (
            <p className="rv-muted rv-find-empty">
              Showing {hits.length} of {found.total}. Type more to narrow it down.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
