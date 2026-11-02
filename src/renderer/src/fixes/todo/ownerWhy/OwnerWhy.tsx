import type { JSX, ReactNode } from 'react'
import type { OwnerVerdict, OwnerWhyResult } from '@shared/ipc'
import type { PageFix } from '@shared/page-fixes'
import { pagesHash } from '../../../shell/routes'
import { BusyLine, Button, DrawerSection, IconButton, LinkButton, UrlText } from '../../../ui'
import { useCopyFeedback } from '../../../ui/useCopyFeedback'
import { formatMoment } from '../../../utils/dates'
import { pathOf } from '../../model'
import { changesText, verdictLine } from './ownerWhyCopy'
import type { OwnerWhyState } from './useOwnerWhy'
import './ownerWhy.css'

/**
 * "Why Google picks <cited page>" on an owner fix: CiteFox AI compares the target
 * and the cited page against the saved overviews of the fix's searches, and says
 * which page should own them and what content to change. Saved per fix, so
 * reopening the drawer shows it with "Compare again".
 */
export function OwnerWhySection({
  fix,
  domain,
  why,
  noAiNotice,
  onEdits
}: {
  fix: PageFix
  domain: string
  why: { state: OwnerWhyState; start: () => void }
  /** Shown instead of a run when CiteFox AI is not connected. */
  noAiNotice: ReactNode
  /** Opens Page edits on the recommended page. Null when there is no tab for it. */
  onEdits: (() => void) | null
}): JSX.Element | null {
  if (why.state.phase === 'off') return null
  const cited = fix.citedUrl ? pathOf(fix.citedUrl) : 'your other page'
  return (
    <DrawerSection
      title={`Why Google picks ${cited}`}
      testId="owner-why"
      guide="pagefix-compare"
      actions={
        why.state.phase === 'done' ? (
          <Button size="sm" variant="ghost" onClick={why.start}>
            Compare again
          </Button>
        ) : null
      }
    >
      <WhyBody fix={fix} domain={domain} why={why} noAiNotice={noAiNotice} onEdits={onEdits} />
    </DrawerSection>
  )
}

function WhyBody({
  fix,
  domain,
  why,
  noAiNotice,
  onEdits
}: {
  fix: PageFix
  domain: string
  why: { state: OwnerWhyState; start: () => void }
  noAiNotice: ReactNode
  onEdits: (() => void) | null
}): JSX.Element | null {
  const { state } = why
  if (state.phase === 'no-ai') return <>{noAiNotice}</>
  if (state.phase === 'done') return <WhyResult why={state.why} domain={domain} onEdits={onEdits} />
  if (state.phase === 'off' || state.phase === 'loading') return null
  const target = fix.page ? pathOf(fix.page.url) : 'the target'
  return (
    <div className="ow-start">
      <p className="muted">
        CiteFox AI reads {target}, the page Google cites and what the AI Overview says for these
        searches. It tells you why Google picks that page, which page should own them, and what
        content to change.
      </p>
      {state.phase === 'running' ? null : (
        <Button variant="primary" size="sm" icon="sparkle" onClick={why.start}>
          {state.phase === 'error' ? 'Try again' : 'Compare the pages'}
        </Button>
      )}
      <BusyLine
        active={state.phase === 'running'}
        label="CiteFox AI is reading both pages and the AI Overviews"
        usual={[15, 60]}
        note="No searches"
        end="Comparison ready"
      />
      {state.phase === 'error' ? (
        <p className="fxt-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </div>
  )
}

function WhyResult({
  why,
  domain,
  onEdits
}: {
  why: OwnerWhyResult
  domain: string
  onEdits: (() => void) | null
}): JSX.Element {
  const cited = pathOf(why.citedUrl)
  const owner = pathOf(why.ownerUrl)
  const copy = useCopyFeedback(changesText(why))
  return (
    <div className="ow-result" data-testid="owner-why-result">
      <div className="ow-verdict" role="status">
        <p className="ow-verdict-line">{verdictLine(why.verdict, why.citedUrl)}</p>
        <p className="ow-reason">{why.reason}</p>
      </div>
      <WhyList title="What the answer needs">
        {why.answerNeeds.map((need, index) => (
          <li key={index}>{need}</li>
        ))}
      </WhyList>
      <WhyList title={`What ${cited} has that the target lacks`}>
        {why.citedHas.map((item, index) => (
          <li key={index}>
            <span className="ow-section">{item.section}</span>
            <span>{item.point}</span>
          </li>
        ))}
      </WhyList>
      <WhyList
        title={
          <>
            What to change on <UrlText url={why.ownerUrl} label={owner} site={domain} />
          </>
        }
        actions={
          <>
            <IconButton
              size="sm"
              icon={copy.state === 'copied' ? 'check' : 'copy'}
              label={copy.state === 'copied' ? 'Copied' : 'Copy the changes'}
              tip
              onClick={copy.copy}
            />
            {onEdits ? (
              <Button size="sm" variant="secondary" onClick={onEdits}>
                Show page edits
              </Button>
            ) : null}
          </>
        }
      >
        {why.toChange.map((item, index) => (
          <li key={index}>
            <span className="ow-section">{item.section}</span>
            <span>{item.change}</span>
            <span className="ow-why">{item.why}</span>
          </li>
        ))}
      </WhyList>
      {why.risk ? <p className="ow-risk">{why.risk}</p> : null}
      <p className="ow-note">
        {why.note} · {formatMoment(why.savedAt)}
      </p>
    </div>
  )
}

function WhyList({
  title,
  actions,
  children
}: {
  title: ReactNode
  actions?: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <div className="ow-block">
      <div className="ow-block-head">
        <h3 className="ow-block-title">{title}</h3>
        {actions ? <div className="ow-block-actions">{actions}</div> : null}
      </div>
      <ul className="ow-list">{children}</ul>
    </div>
  )
}

/**
 * Choose owner: keep Google's pick as the target, or keep the target and strengthen
 * it. Once "Why Google picks" has a verdict, the recommended option is the primary button.
 */
export function OwnerChoice({
  fix,
  domain,
  topicCount,
  busy,
  error,
  verdict,
  comparable,
  onKeepPick,
  onKeepTarget
}: {
  fix: PageFix
  domain: string
  topicCount: number
  busy: boolean
  error: string | null
  /** The comparison's verdict: its option becomes the primary button. Null before one. */
  verdict: OwnerVerdict | null
  /** "Compare the pages" leads until there is a verdict; without it, Google's pick leads. */
  comparable: boolean
  onKeepPick: () => void
  onKeepTarget: () => void
}): JSX.Element {
  const cited = fix.citedUrl ? pathOf(fix.citedUrl) : 'your other page'
  const target = fix.page ? pathOf(fix.page.url) : null
  // After a comparison the recommended option leads; before one, "Compare the pages" does.
  const pickLeads = verdict === null ? !comparable : verdict === 'cited'
  const targetLeads = verdict === 'target'
  return (
    <div className="fxt-owner">
      <p className="muted">
        Google cites <UrlText url={fix.citedUrl ?? ''} label={cited} site={domain} /> for these
        searches
        {target ? (
          <>
            , not the target <UrlText url={fix.page?.url ?? ''} label={target} site={domain} />
          </>
        ) : null}
        . Pick the page that should own them.
      </p>
      <div className="fxt-owner-options">
        {topicCount > 0 ? (
          <Button
            size="sm"
            variant={pickLeads ? 'primary' : 'secondary'}
            busy={busy}
            disabled={busy}
            onClick={onKeepPick}
          >
            Make {cited} the owner
          </Button>
        ) : (
          <LinkButton
            size="sm"
            variant={pickLeads ? 'primary' : 'secondary'}
            href={pagesHash({ attention: 'open' })}
          >
            Move the questions in Pages
          </LinkButton>
        )}
        {target ? (
          <Button
            size="sm"
            variant={targetLeads ? 'primary' : 'secondary'}
            disabled={busy}
            onClick={onKeepTarget}
          >
            Keep {target}, get its fix brief
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className="fxt-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
