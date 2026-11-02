import { Fragment, type JSX } from 'react'
import { brandRuns, type BrandLens } from '@shared/brand-mentions'

/**
 * Plain text with every mention of the project's brand names, aliases and own
 * domain in a yellow `<mark>` (owner feedback: "highlight in yellow wherever our
 * brand name or our url is there"). Text stays text nodes, never HTML.
 */
export function Marked({ text, lens }: { text: string; lens: BrandLens | null }): JSX.Element {
  const runs = brandRuns(text, lens)
  return (
    <>
      {runs.map((run, index) =>
        run.marked ? (
          <mark key={index} className="aio-brand">
            {run.text}
          </mark>
        ) : (
          <Fragment key={index}>{run.text}</Fragment>
        )
      )}
    </>
  )
}
