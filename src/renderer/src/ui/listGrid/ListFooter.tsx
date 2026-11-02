import type { JSX, ReactNode } from 'react'
import { Button } from '../Button'
import { IconButton } from '../IconButton'

/** The 48px footer: count line, Show all / Show fewer, and previous/next page. */
export function ListFooter({
  line,
  matching,
  page,
  pages,
  showAll,
  onShowAll,
  onShowFewer,
  onPage
}: {
  line: ReactNode
  matching: number
  page: number
  pages: number
  /** True while every row shows on one page. */
  showAll: boolean
  /** Null when there is nothing more to show. */
  onShowAll: (() => void) | null
  /** Null when the grid was never paged. */
  onShowFewer: (() => void) | null
  onPage: (page: number) => void
}): JSX.Element {
  return (
    <div className="ui-lg-foot">
      <span className="ui-lg-foot-line num" role="status">
        {line}
      </span>
      <div className="ui-lg-foot-tools">
        {onShowAll ? (
          <Button variant="text" onClick={onShowAll}>
            Show all {matching.toLocaleString('en-US')}
          </Button>
        ) : null}
        {showAll && onShowFewer ? (
          <Button variant="text" onClick={onShowFewer}>
            Show fewer
          </Button>
        ) : null}
        {!showAll ? (
          <div className="ui-lg-pager">
            <IconButton
              icon="chevron-left"
              label="Previous page"
              size="sm"
              disabled={page <= 1}
              onClick={() => onPage(page - 1)}
            />
            <IconButton
              icon="chevron-right"
              label="Next page"
              size="sm"
              disabled={page >= pages}
              onClick={() => onPage(page + 1)}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
