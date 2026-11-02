import { useId, type JSX, type ReactNode } from 'react'
import type { CompetitorLine, OverviewObservations, PassageLine } from '@shared/aio-observations'
import type { BrandLens } from '@shared/brand-mentions'
import { pluralize } from '@shared/pluralize'
import { displayUrl } from '../../../m3/model'
import { siteColumns } from '../../../sites/siteColumns'
import { Chip, ListGrid, UiIcon, UrlText, type ListColumn } from '../../../ui'
import { KIND_TONE } from '../../constants'
import { Marked } from '../aio/Marked'
import { depthText, flashPassage, placeText, sectionText } from './model'

/** Quotes listed per list before "and N more". */
const QUOTES_SHOWN = 5

/** Icon, name and website (with Copy and Open), as every list of sites, then the counts. */
const COMPETITOR_COLUMNS: readonly ListColumn<CompetitorLine>[] = [
  ...siteColumns<CompetitorLine>({
    site: (line) => ({ domain: line.domain, name: line.name }),
    nameLabel: 'Competitor',
    websiteWidth: 176
  }),
  {
    id: 'tier',
    label: 'Tier',
    width: 128,
    sort: (line) => line.tier ?? '',
    render: (line) => line.tier ?? 'no longer listed'
  },
  {
    id: 'named',
    label: 'Named',
    width: 88,
    numeric: true,
    sort: (line) => line.named,
    render: (line) => line.named
  },
  {
    id: 'cited',
    label: 'Cited',
    width: 88,
    numeric: true,
    sort: (line) => line.cited,
    render: (line) => line.cited
  }
]

/**
 * The computed half of "What this overview says about you": no Claude call. Every
 * quote is the overview's own sentence, with the brand marked; "Show" scrolls to the
 * passage in the overview above and flashes its citation chip.
 */
export function ObservedFacts({
  seen,
  lens,
  productName
}: {
  seen: OverviewObservations
  lens: BrandLens
  productName: string | null
}): JSX.Element {
  const best = seen.ownSources[0]
  return (
    <div className="ins-observed">
      <p className="ins-verdict" data-testid="overview-verdict">
        <Marked text={seen.verdict} lens={lens} />
      </p>
      <div className="ins-cols">
        <Part title="Your brand in the text">
          <p className="ins-stat num">
            {seen.mentions.length === 0
              ? `${seen.brand} is not named, and neither is ${lens.ownDomain}.`
              : `Named ${pluralize(seen.mentions.length, 'time')}${seen.firstMention ? `, first in the ${depthText(seen.firstMention)}` : ''}.`}
          </p>
          <Quotes
            lines={seen.mentions.map((mention) => ({
              passageId: mention.passageId,
              section: mention.section,
              label: sectionText(mention.section),
              sentence: mention.sentence
            }))}
            lens={lens}
          />
        </Part>
        <Part title="Your site in the sources">
          <p className="ins-stat num">
            {best
              ? `${seen.ownSources.length} of ${seen.sourceCount} sources are yours; the first is ${placeText(best.position, seen.sourceCount)}.`
              : `None of the ${pluralize(seen.sourceCount, 'source')} is on ${lens.ownDomain}.`}
          </p>
          {seen.ownSources.length > 0 ? (
            <ul className="ins-own">
              {seen.ownSources.map((source) => (
                <li key={source.index} className="ins-own-item">
                  <span className="ins-own-head">
                    {source.url ? (
                      <UrlText
                        url={source.url}
                        label={displayUrl(source.url)}
                        className="ins-url"
                      />
                    ) : (
                      <span className="ins-url">{source.title ?? source.name}</span>
                    )}
                    <Chip size="sm" tone={KIND_TONE[source.kind]}>
                      {source.kind === 'this_page' ? 'This page' : 'Own page'}
                    </Chip>
                    <span className="ins-place num">
                      {placeText(source.position, seen.sourceCount)}
                    </span>
                  </span>
                  {source.passages.length > 0 ? (
                    <span className="ins-for">
                      Cited for{' '}
                      {source.passages.map((passage, index) => (
                        <span key={passage.id}>
                          {index > 0 ? ', ' : null}
                          <button
                            type="button"
                            className="ins-link"
                            aria-label={`Show the passage "${passage.label}" in the overview`}
                            onClick={() => flashPassage(passage.id)}
                          >
                            {passage.label}
                          </button>
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="ins-for">Listed in the sources; no passage points to it.</span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </Part>
      </div>
      <div className="ins-cols">
        <Part title="Named without a link to you">
          {seen.namedNotCited.length === 0 ? (
            <p className="ins-none">
              {seen.mentions.length === 0
                ? 'No mention to check.'
                : 'Every mention sits in a passage that cites your site.'}
            </p>
          ) : (
            <Quotes
              lines={seen.namedNotCited.map((mention) => ({
                passageId: mention.passageId,
                section: mention.section,
                label: sectionText(mention.section),
                sentence: mention.sentence
              }))}
              lens={lens}
            />
          )}
        </Part>
        <Part title="Cited without your name">
          {seen.citedNotNamed.length === 0 ? (
            <p className="ins-none">
              {seen.ownSources.length === 0
                ? 'No passage cites your site.'
                : 'Every passage that cites you also names you.'}
            </p>
          ) : (
            <Quotes lines={seen.citedNotNamed} lens={lens} />
          )}
        </Part>
      </div>
      <Part title="Competitors in this overview">
        {productName ? (
          <p className="ins-stat">Competitors of {productName}, as saved for this page.</p>
        ) : null}
        {seen.competitors.length === 0 ? (
          <p className="ins-none">None of them is named or cited here.</p>
        ) : (
          <ListGrid<CompetitorLine>
            label="Competitors named or cited"
            noun={['competitor', 'competitors']}
            rows={seen.competitors}
            rowKey={(line) => line.name}
            rowLabel={(line) => line.name}
            columns={COMPETITOR_COLUMNS}
            pageSize="all"
            className="ins-grid"
            empty={null}
          />
        )}
      </Part>
      {seen.gaps.map((gap) => (
        <p key={gap.passageId} className="ins-gap" role="note">
          <UiIcon name="warning" size={16} />
          <span>
            Google showed a name here that the search data left out:{' '}
            <q className="ins-quote">
              <Marked text={gap.sentence} lens={lens} />
            </q>{' '}
            <ShowButton line={gap} />
          </span>
        </p>
      ))}
    </div>
  )
}

function Part({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  const id = useId()
  return (
    <section className="ins-part" aria-labelledby={id}>
      <h3 id={id} className="ins-h">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Quotes({ lines, lens }: { lines: readonly PassageLine[]; lens: BrandLens }): JSX.Element {
  const shown = lines.slice(0, QUOTES_SHOWN)
  const more = lines.length - shown.length
  return (
    <ul className="ins-quotes">
      {shown.map((line, index) => (
        <li key={`${line.passageId}-${index}`}>
          <span className="ins-where">{line.label}</span>
          <span className="ins-said">
            <q className="ins-quote">
              <Marked text={line.sentence} lens={lens} />
            </q>{' '}
            <ShowButton line={line} />
          </span>
        </li>
      ))}
      {more > 0 ? <li className="ins-more num">and {more} more</li> : null}
    </ul>
  )
}

function ShowButton({ line }: { line: PassageLine }): JSX.Element {
  return (
    <button
      type="button"
      className="ins-link"
      aria-label={`Show this passage in the overview (${line.label})`}
      onClick={() => flashPassage(line.passageId)}
    >
      Show
    </button>
  )
}
