import type { JSX, ReactNode } from 'react'
import { META_FLAG_LENGTH, TITLE_FLAG_LENGTH, type PageReadFlag } from '@shared/domain'
import type { PageReadResult } from '@shared/ipc'
import { Panel, UrlText } from '../ui'
import { formatDay } from './model'
import { ReadEligibility } from './ReadEligibility'
import { Compare, ReadFlag } from './readDrills'

function Row({ name, children }: { name: string; children: ReactNode }): JSX.Element {
  return (
    <div className="rd-kv">
      <span className="rd-key">{name}</span>
      <div className="rd-val">{children}</div>
    </div>
  )
}

/**
 * "What Google sees first": the title tag, meta description, H1, the promise
 * they lead with, the canonical, whether Google may show the page in AI
 * Overviews, and the dates. Every flag opens a short explanation with the
 * values side by side.
 */
export function ReadHead({
  result,
  pageUrl
}: {
  result: PageReadResult
  pageUrl: string
}): JSX.Element {
  const titleFlag = result.flags.find((flag) => flag.code === 'title_long') ?? null
  const metaFlag = result.flags.find((flag) => flag.code === 'meta_long') ?? null
  const mismatch = result.flags.find((flag) => flag.code === 'promise_mismatch') ?? null
  const hasMeta = (result.metaDescription ?? '').trim().length > 0
  const allThree = [
    { label: 'Title tag', value: result.title },
    { label: 'H1', value: result.h1 },
    { label: 'Meta description', value: result.metaDescription }
  ]
  return (
    <Panel title="What Google sees first">
      <p className="rd-faint rd-panel-note">From the page&apos;s HTML head and first heading</p>
      <div className="rd-kvs">
        <Row name="Title tag">
          <p>{result.title ?? 'No title tag'}</p>
          <p className="rd-line">
            <span className="mono rd-faint">{result.titleLength} characters</span>
            {titleFlag ? (
              <ReadFlag ok={false} label={titleFlag.message}>
                Google cuts titles at about {TITLE_FLAG_LENGTH} characters. This one is{' '}
                {result.titleLength}.
                <Compare
                  rows={[
                    { label: 'Title tag', value: result.title },
                    { label: 'Google shows', value: titleFlag.preview }
                  ]}
                />
              </ReadFlag>
            ) : result.titleLength <= TITLE_FLAG_LENGTH ? (
              <ReadFlag ok label={`Within about ${TITLE_FLAG_LENGTH} characters`}>
                Google shows titles up to about {TITLE_FLAG_LENGTH} characters in full. This one is{' '}
                {result.titleLength}, so it is not cut.
              </ReadFlag>
            ) : null}
          </p>
          {titleFlag?.preview ? <TitlePreview flag={titleFlag} /> : null}
        </Row>
        <Row name="Meta description">
          <p className={hasMeta ? undefined : 'rd-faint'}>
            {hasMeta ? result.metaDescription : 'Not set on this page'}
          </p>
          <p className="rd-line">
            <span className="mono rd-faint">{result.metaDescriptionLength} characters</span>
            {!hasMeta ? (
              <ReadFlag ok={false} label="No meta description">
                Without one, Google writes its own snippet from the page text. A short description
                in the page&apos;s words keeps the promise you choose.
              </ReadFlag>
            ) : metaFlag ? (
              <ReadFlag ok={false} label={metaFlag.message}>
                Google cuts descriptions at about {META_FLAG_LENGTH} characters. This one is{' '}
                {result.metaDescriptionLength}.
                <Compare rows={[{ label: 'Meta description', value: result.metaDescription }]} />
              </ReadFlag>
            ) : (
              <ReadFlag ok label={`Within about ${META_FLAG_LENGTH} characters`}>
                Google shows descriptions up to about {META_FLAG_LENGTH} characters. This one is{' '}
                {result.metaDescriptionLength}.
              </ReadFlag>
            )}
          </p>
        </Row>
        <Row name="H1">
          <p>{result.h1 ?? 'No H1'}</p>
          <p className="rd-line">
            <ReadFlag
              ok={result.titleMatchesH1 === true}
              label={
                result.titleMatchesH1 ? 'Same as the title tag' : 'Different from the title tag'
              }
            >
              {result.titleMatchesH1
                ? 'The H1 and the title tag make the same promise.'
                : 'The H1 and the title tag say different things. Google may show either, so buyers can see a different promise from the one the page leads with.'}
              <Compare
                rows={[
                  { label: 'Title tag', value: result.title },
                  { label: 'H1', value: result.h1 }
                ]}
              />
            </ReadFlag>
          </p>
        </Row>
        <Row name="Title and H1 vs meta">
          {mismatch ? (
            <>
              <p className="rd-line">
                <ReadFlag ok={false} label="They lead with different promises">
                  <Compare rows={allThree} />
                </ReadFlag>
              </p>
              <p className="rd-muted">{mismatch.message}</p>
            </>
          ) : !hasMeta ? (
            <p className="rd-line">
              <ReadFlag ok={false} label="No meta description to compare">
                Add a meta description so CiteFox can check it leads with the same promise as the
                title and H1.
              </ReadFlag>
            </p>
          ) : (
            <p className="rd-line">
              <ReadFlag ok label="Title, H1, and meta lead with the same promise">
                <Compare rows={allThree} />
              </ReadFlag>
            </p>
          )}
        </Row>
        <Row name="Canonical">
          <p className="mono rd-break">
            {result.canonical ? (
              // The tag's value exactly as the page has it; Copy and Open use the full URL.
              <UrlText url={result.canonical} label={result.canonical} site={pageUrl || null} />
            ) : (
              'No canonical'
            )}
          </p>
          <p className="rd-line">
            <ReadFlag
              ok={result.canonicalMatchesPage === true}
              label={
                result.canonicalMatchesPage ? 'Points to this page' : 'Does not point to this page'
              }
            >
              {result.canonicalMatchesPage
                ? 'The canonical tag names this URL, so Google treats this page as the one to show.'
                : 'The canonical tag names another URL (or none), so Google may credit that URL instead of this page.'}
              <Compare
                rows={[
                  { label: 'Canonical', value: result.canonical, mono: true },
                  { label: 'This page', value: pageUrl, mono: true }
                ]}
              />
            </ReadFlag>
          </p>
        </Row>
        <Row name="Shown in AI Overviews">
          <ReadEligibility eligibility={result.eligibility} />
        </Row>
        <Row name="Dates">
          <p>
            Published{' '}
            <strong>{result.publishedAt ? formatDay(result.publishedAt) : 'unknown'}</strong>
            {' · '}
            Last modified{' '}
            <strong>{result.modifiedAt ? formatDay(result.modifiedAt) : 'unknown'}</strong>
          </p>
        </Row>
      </div>
    </Panel>
  )
}

function TitlePreview({ flag }: { flag: PageReadFlag }): JSX.Element {
  return (
    <div className="rd-preview">
      <span className="rd-faint">
        How Google shows it (cut at about {TITLE_FLAG_LENGTH} characters)
      </span>
      <span>{flag.preview}</span>
      <span className="rd-muted">{flag.message}</span>
    </div>
  )
}
