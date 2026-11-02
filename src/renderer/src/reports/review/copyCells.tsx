import type { JSX, MouseEvent, ReactNode } from 'react'
import { pageKey } from '@shared/metrics'
import { pathOf } from '@shared/report/review'
import { CopyText, DomainText, UrlText } from '../../ui'
import { openReportDetail, pageDetail } from './drill'
import './copy-cells.css'

/**
 * The owner's copy/open rule for every Reports screen (Docs/REPORT-SPEC.md "Copy and
 * open"): a page, URL or site shows Copy + Open in a new tab on hover or focus; a
 * question or quote shows Copy. Sections use these instead of printing plain text, so
 * a new section gets the rule by using them.
 */

/**
 * One of your pages, shown as its path. When the report knows the page (or `known` is
 * not given) the path is a link that opens the page drawer; Copy and Open stay at the end.
 */
export function ReportPage({
  url,
  known,
  label,
  drill = true,
  plain = false,
  cut
}: {
  url: string
  /** Pages the report knows, by page key; others show the path without the drawer link. */
  known?: ReadonlySet<string>
  /** What is shown. Default: the path. */
  label?: string
  /** False: no drawer link (the row itself already opens it). */
  drill?: boolean
  /** The label is a title, not a path: the UI font. */
  plain?: boolean
  cut?: 'middle' | 'end'
}): JSX.Element {
  const shown = label ?? pathOf(url)
  const opens = drill && (known === undefined || known.has(pageKey(url)))
  if (!opens || !/^https?:\/\//i.test(url)) {
    return <UrlText url={url} label={shown} icon={false} plain={plain} cut={cut ?? 'end'} />
  }
  return (
    <UrlText url={url} label={shown} icon={false} plain={plain}>
      <button
        type="button"
        className={plain ? 'rv-link' : 'rv-link rv-path'}
        onClick={(event: MouseEvent) => {
          event.stopPropagation()
          openReportDetail(pageDetail(url))
        }}
      >
        {shown}
      </button>
    </UrlText>
  )
}

/** A web address: Copy + Open. A title, when there is one, is shown in the UI font. */
export function ReportLink({
  url,
  title,
  own
}: {
  url: string
  title?: string | null
  own?: boolean
}): JSX.Element {
  if (!/^https?:\/\//i.test(url)) return <CopyText text={url} />
  return title ? (
    <UrlText url={url} label={title} plain own={own} cut="end" />
  ) : (
    <UrlText url={url} own={own} cut="end" />
  )
}

/** A site: icon, domain, Copy + Open; your own site keeps the highlighter. */
export function ReportSite({
  domain,
  own = false,
  you = false
}: {
  domain: string
  own?: boolean
  /** Adds the short "you" note after your own site. */
  you?: boolean
}): JSX.Element {
  return <DomainText domain={domain} own={own} kind={own && you ? 'you' : undefined} />
}

/**
 * A question, quote or anchor text: Copy at the end. `children` is the question's own
 * button or link that opens its drawer; it keeps its own focus. `label` is plain
 * content shown in place of the text, such as the text in quotes.
 */
export function ReportText({
  text,
  children,
  label,
  inRow = false,
  className
}: {
  text: string
  children?: ReactNode
  label?: ReactNode
  /** The row around it opens the drawer and takes the focus: the text is not a second tab stop. */
  inRow?: boolean
  className?: string
}): JSX.Element {
  const classes = ['rv-copy', className ?? ''].filter(Boolean).join(' ')
  if (children !== undefined) {
    return <CopyText text={text} label={children} interactiveLabel className={classes} />
  }
  if (inRow) {
    return <CopyText text={text} label={label ?? text} interactiveLabel className={classes} />
  }
  return <CopyText text={text} label={label} className={classes} />
}
