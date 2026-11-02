import { useId, useState, type JSX } from 'react'
import type { PlaygroundAioPromptResult, PlaygroundAioResult } from '@shared/ipc'
import { DrillButton, DrillLink, DrillNumber } from '../drill'
import { aioDrill, COVERAGE_LEVELS, coverageDrill, sameUrl } from './drills'
import type { CoverageView } from './output'
import { SiteIcon } from '../siteIcon/SiteIcon'
import { SectionHead, UrlText } from '../ui'

/** The coverage matrix of a run. Each level count and the prompt count open those rows. */
export function CoverageMatrix({ view }: { view: CoverageView }): JSX.Element {
  const all = coverageDrill(view, null)
  return (
    <section aria-labelledby="matrix-h">
      <SectionHead
        id="matrix-h"
        title="Coverage matrix"
        actions={
          <span className="faint pg-levels">
            {COVERAGE_LEVELS.map((level, index) => (
              <span key={level}>
                {index > 0 ? ' · ' : ''}
                {level}{' '}
                <DrillNumber
                  drill={coverageDrill(view, level)}
                  label={`${view.counts[level]} ${view.counts[level] === 1 ? 'question' : 'questions'} with ${level} coverage`}
                />
              </span>
            ))}
          </span>
        }
      />
      <p role="status">
        <DrillNumber
          drill={all}
          label={`${view.rows.length} ${view.rows.length === 1 ? 'question' : 'questions'} in the coverage matrix`}
          suffix={view.rows.length === 1 ? ' question' : ' questions'}
        />
      </p>
      <div className="pg-scroll">
        <table className="pg-table">
          <caption className="sr-only">
            Coverage matrix for the {view.rows.length} buyer questions.
          </caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Question</th>
              <th scope="col">Coverage</th>
              <th scope="col">Where covered now</th>
              <th scope="col">Main gap</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr key={row.n}>
                <td className="mono">{row.n}</td>
                <td>{row.prompt}</td>
                <td>
                  <DrillButton
                    drill={coverageDrill(view, row.coverage)}
                    untracked
                    className={`tag cov-${row.coverage.toLowerCase()} pg-tag-btn`}
                    label={`${row.coverage}: show every question at this level`}
                  >
                    {row.coverage}
                  </DrillButton>
                </td>
                <td>{row.where}</td>
                <td>{row.gap}</td>
                <td>{row.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>
        {view.findings.length} {view.findings.length === 1 ? 'finding' : 'findings'}
      </h3>
      <ul>
        {view.findings.map((finding) => (
          <li key={finding}>{finding}</li>
        ))}
      </ul>
    </section>
  )
}

/**
 * The live AI Overview checks of a run. The cited count opens those prompts,
 * a prompt's position jumps to the page in its sources, and every source opens
 * in the browser.
 */
export function AioPanel({
  result,
  pageUrl
}: {
  result: PlaygroundAioResult
  pageUrl: string
}): JSX.Element {
  const all = aioDrill(result, pageUrl, 'all')
  const cited = aioDrill(result, pageUrl, 'cited')
  return (
    <div className="tpl-editor-title">
      <h2>
        <DrillNumber
          drill={all}
          label={`${result.prompts.length} ${result.prompts.length === 1 ? 'AI Overview' : 'AI Overviews'} checked`}
          suffix={result.prompts.length === 1 ? ' AI Overview' : ' AI Overviews'}
        />
      </h2>
      <p>
        Page cited in{' '}
        <DrillNumber
          drill={cited}
          label={`Page cited in ${cited.items.length} ${cited.items.length === 1 ? 'question' : 'questions'}`}
        />{' '}
        of {result.prompts.length}
      </p>
      {result.prompts.map((prompt, index) => (
        <AioCard
          key={`${index}-${prompt.prompt}`}
          prompt={prompt}
          index={index}
          pageUrl={pageUrl}
        />
      ))}
    </div>
  )
}

function AioCard({
  prompt,
  index,
  pageUrl
}: {
  prompt: PlaygroundAioPromptResult
  index: number
  pageUrl: string
}): JSX.Element {
  const base = useId()
  const [marked, setMarked] = useState(false)
  const ownId = `${base}-own`

  function showOwn(): void {
    const row = document.getElementById(ownId)
    if (!row) return
    row.scrollIntoView?.({ block: 'nearest' })
    row.focus()
    setMarked(true)
  }

  return (
    <section className="card" aria-labelledby={`aio-${index}`}>
      <h3 id={`aio-${index}`}>{prompt.prompt}</h3>
      <p>
        {prompt.ok ? (
          <>
            <span className={prompt.cited ? 'tag tag-edited' : 'tag'}>
              {prompt.cited ? 'Page cited' : 'Not cited'}
            </span>{' '}
            {prompt.position === null ? (
              'No position on this page'
            ) : (
              <button
                type="button"
                className="m3-link"
                aria-label={`Position ${prompt.position}: show the page in the sources`}
                onClick={showOwn}
              >
                Position {prompt.position}
              </button>
            )}
            {' · '}
            Key · {prompt.keyLabel}
          </>
        ) : (
          prompt.message
        )}
      </p>
      <section aria-labelledby={`aio-text-${index}`}>
        <h3 id={`aio-text-${index}`}>AI Overview</h3>
        <p>{prompt.summary ?? 'No overview text.'}</p>
      </section>
      <section aria-labelledby={`src-${index}`}>
        <h3 id={`src-${index}`}>Sources Google listed</h3>
        <p role="status">
          {prompt.citedSources.length} {prompt.citedSources.length === 1 ? 'source' : 'sources'}
        </p>
        <ol className="pg-sources" aria-labelledby={`src-${index}`}>
          {prompt.citedSources.map((source) => {
            const own = sameUrl(source.url, pageUrl)
            return (
              <li
                key={`${source.position}-${source.domain}`}
                id={own ? ownId : undefined}
                tabIndex={own ? -1 : undefined}
                className={own && marked ? 'pg-source pg-source-marked' : 'pg-source'}
              >
                <span className={own ? 'pg-source-pos pg-own' : 'pg-source-pos'}>
                  {source.position}
                </span>
                <SiteIcon domain={source.domain} />
                <DrillLink
                  target={{ kind: 'url', url: source.url }}
                  className={own ? 'pg-own' : undefined}
                >
                  {source.domain}
                </DrillLink>
                <UrlText url={source.url} icon={false} className="faint" />
                {own ? <span className="tag tag-edited">This page</span> : null}
              </li>
            )
          })}
        </ol>
      </section>
    </section>
  )
}
