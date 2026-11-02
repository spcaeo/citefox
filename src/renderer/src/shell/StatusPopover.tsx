import type { JSX } from 'react'
import type { ApiKeyMetadata, ConnectionState, JinaMode } from '@shared/domain'
import type { StatusCapsule } from '@shared/ipc'
import { readinessText, type Readiness } from '@shared/permissions/readiness'
import { Icon } from '../components/Icon'
import { useDialog } from '../components/useDialog'
import { connectionStateLabel } from '../keys/health'
import { formatCount, planLine, serpKeyLines, serpUsageSummary, usageNoun } from '../keys/serpUsage'
import { loginStatusLabel, type OnboardingCheckupResult } from '../onboarding/claudeLogin'
import { openStatusAt, type StatusFocus } from '../status/focus'
import { NoticeList } from '../status/components/NoticeList'
import type { NoticesState } from '../status/live/useNotices'
import type { SetupStatus } from '@shared/ipc'
import { sectionHash } from './routes'
import { withHashTab } from './useHashTab'
import { ClaudeStatusLine } from '../ui/ClaudeStatusChip'

/** cloro is Connections' first tab, so SerpApi links name their tab. */
const SERPAPI_HREF = withHashTab(sectionHash('connections'), 'serpapi')

/**
 * The status capsule's popover (FR-24.1, Mockups/Status.dc.html). Every line
 * opens more: each SerpApi key opens Connections, each state chip its card
 * on Status, and "N issues" the open-issue list. Any link or button that
 * leaves calls `onNavigate`, so the popover never stays open over the new
 * screen. Searches used, limit and left use the same all-keys rule as Status
 * and Settings (`serpUsageSummary`).
 */
export function StatusPopover({
  capsule,
  ready = null,
  keys,
  checkup,
  jinaMode,
  onClose,
  onNavigate = onClose,
  notices = null,
  setup = null
}: {
  capsule: StatusCapsule
  /** The one readiness model; the footer says what the capsule says. */
  ready?: Readiness | null
  keys: readonly ApiKeyMetadata[]
  checkup: OnboardingCheckupResult | null
  jinaMode: JinaMode | null
  /** Escape and the close button. The capsule puts focus back on its button. */
  onClose: () => void
  /** A link or button that opens another screen. Default `onClose`. */
  onNavigate?: () => void
  /** Open "ask me" notices, answered in place (FR-11.4, FR-11.7). */
  notices?: NoticesState | null
  /** Background page setup; a line shows while pages are being set up (FR-20.6). */
  setup?: SetupStatus | null
}): JSX.Element {
  // Not modal: Tab may leave. StatusCapsule puts focus back on its button when it closes.
  const dialog = useDialog<HTMLElement>({ onClose, trap: false, restoreFocus: false })

  const serpLines = serpKeyLines(keys)
  const usage = serpUsageSummary(keys)
  const anthropic = keys.find((key) => key.provider === 'anthropic') ?? null
  const jina = keys.find((key) => key.provider === 'jina') ?? null
  const youtube = keys.find((key) => key.provider === 'youtube') ?? null

  return (
    <section
      ref={dialog}
      id="status-pop"
      className="status-pop"
      role="dialog"
      aria-modal="false"
      aria-labelledby="pop-title"
    >
      <div className="pop-head">
        <div>
          <h2 id="pop-title">Credits and connections</h2>
          <span className="faint">Everything CiteFox needs to run checks</span>
        </div>
        <button
          type="button"
          className="icon-btn"
          id="status-pop-close"
          data-autofocus
          aria-label="Close status"
          onClick={onClose}
        >
          <Icon name="x" size="nav" />
        </button>
      </div>
      <div className="pop-body">
        {notices && (notices.notices.length > 0 || notices.message) ? (
          <section className="sp-sec" aria-labelledby="st-pop-notices">
            <div className="sp-head">
              <span className="sp-ico" aria-hidden="true">
                <Icon name="warning" size="nav" />
              </span>
              <h3 id="st-pop-notices">Decisions waiting</h3>
            </div>
            <NoticeList state={notices} headingLevel={4} label="Decisions waiting for you" />
          </section>
        ) : null}
        {setup && (setup.running > 0 || (setup.waiting > 0 && !setup.paused)) ? (
          <p className="sp-setup" role="status">
            {setup.running > 0
              ? `Setting up ${setup.running} ${setup.running === 1 ? 'page' : 'pages'} · ${setup.waiting} waiting`
              : `${setup.waiting} ${setup.waiting === 1 ? 'page' : 'pages'} waiting for setup`}
            {' · '}
            <button
              type="button"
              className="sp-issues"
              onClick={() => {
                onNavigate()
                openStatusAt('st-setup')
              }}
            >
              Page setup
            </button>
          </p>
        ) : null}
        <Section
          id="st-serp"
          title="SerpApi"
          icon="search"
          state={capsule.serpapi}
          href={SERPAPI_HREF}
          action="Manage keys"
          onNavigate={onNavigate}
        >
          {usage ? (
            <>
              <Usage
                used={usage.used}
                limit={usage.limit}
                left={capsule.searchesLeft}
                noun={usageNoun(usage)}
              />
              {planLine(usage) ? <span className="faint">{planLine(usage)}</span> : null}
            </>
          ) : (
            <span>
              {capsule.searchesLeft === null
                ? 'Searches left are not known yet.'
                : `${formatCount(capsule.searchesLeft)} searches left`}
            </span>
          )}
          {serpLines.length > 0 ? (
            <ul className="sp-keys" aria-label="SerpApi keys">
              {serpLines.map((line) => (
                <li key={line.id}>
                  <a
                    href={SERPAPI_HREF}
                    aria-label={`${line.name}: ${keyUsage(line)}. Manage in Connections`}
                    onClick={onNavigate}
                  >
                    {line.name}
                  </a>{' '}
                  <span className="muted">
                    · {line.dedicated ? 'client key' : 'shared'} · {keyUsage(line)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="faint">Add a SerpApi key to run checks.</span>
          )}
        </Section>
        <Section
          id="st-claude"
          onNavigate={onNavigate}
          title="Claude"
          icon="terminal"
          state={capsule.claudeCode}
          href={withHashTab(sectionHash('connections'), 'claude')}
          action="Manage"
        >
          <ClaudeStatusLine size="sm" named />
          <span className="key-name">Claude Code on this computer</span>
          <span>
            {checkup ? loginStatusLabel(checkup) : connectionStateLabel(capsule.claudeCode)}
          </span>
          {checkup ? (
            <span className="muted">
              {[checkup.binaryPath, checkup.version, checkup.plan].filter(Boolean).join(' · ') ||
                'No path reported'}
            </span>
          ) : null}
          <span className="faint">
            Claude Code doesn&apos;t report how much of your plan is left. CiteFox shows a warning
            if it hits a limit.
          </span>
          {anthropic ? <span>Anthropic API · {anthropic.name}</span> : null}
        </Section>
        <Section
          id="st-jina"
          onNavigate={onNavigate}
          title="Jina Reader"
          icon="file"
          state={capsule.jina}
          href={withHashTab(sectionHash('connections'), 'jina')}
          action="Manage"
        >
          <span className="muted">
            {jina ? '1 key' : 'No key'} ·{' '}
            {jinaMode === 'always'
              ? 'Always'
              : jinaMode === 'never'
                ? 'Never'
                : 'Falls back to no-key mode at lower rate limits.'}
          </span>
        </Section>
        <Section
          id="st-yt"
          onNavigate={onNavigate}
          title="YouTube Data API"
          icon="video"
          state={youtube ? capsule.youtube : 'off'}
          href={withHashTab(sectionHash('connections'), 'youtube')}
          action={youtube ? 'Manage' : 'Add key'}
        >
          <span className="faint">
            {youtube ? youtube.name : 'Add a key to see video views. Optional.'}
          </span>
        </Section>
      </div>
      <div className="pop-foot">
        {(ready?.items.length ?? capsule.issueCount) === 0 ? (
          <span>No issues</span>
        ) : ready && ready.steps > 0 ? (
          <a className="sp-issues" href={sectionHash('permissions')} onClick={onNavigate}>
            {readinessText(ready)}
          </a>
        ) : (
          <button
            type="button"
            className="sp-issues"
            onClick={() => {
              onNavigate()
              openStatusAt('issues')
            }}
          >
            {readinessText(ready ?? { steps: 0, issues: capsule.issueCount })}
          </button>
        )}
        <a href={sectionHash('status')} onClick={onNavigate}>
          Open Status
        </a>
        <a href={sectionHash('connections')} onClick={onNavigate}>
          All connections
        </a>
        <a href={sectionHash('permissions')} onClick={onNavigate}>
          What CiteFox needs
        </a>
      </div>
    </section>
  )
}

/** The Status card each popover section opens (the popover's ids match Status's). */
const STATUS_CARD: Readonly<Record<string, StatusFocus>> = {
  'st-serp': 'st-serp',
  'st-claude': 'st-claude',
  'st-jina': 'st-jina',
  'st-yt': 'st-yt'
}

function keyUsage(line: ReturnType<typeof serpKeyLines>[number]): string {
  if (line.used === null) return 'usage not reported'
  const limit = line.limit === null ? 'no limit' : formatCount(line.limit)
  const left = line.left === null ? '' : ` · ${formatCount(line.left)} left`
  return `${formatCount(line.used)} / ${limit}${left}`
}

function Section({
  id,
  title,
  icon,
  state,
  href,
  action,
  onNavigate,
  children
}: {
  id: string
  title: string
  icon: 'search' | 'terminal' | 'file' | 'video'
  state: ConnectionState
  href: string
  action: string
  onNavigate: () => void
  children: JSX.Element | readonly (JSX.Element | null)[] | (JSX.Element | null)
}): JSX.Element {
  const card = STATUS_CARD[id]
  return (
    <section className="sp-sec" aria-labelledby={id}>
      <div className="sp-head">
        <span className="sp-ico" aria-hidden="true">
          <Icon name={icon} size="nav" />
        </span>
        <h3 id={id}>{title}</h3>
        <button
          type="button"
          className={`chip sm c-${state} sp-chip`}
          aria-label={`${title}: ${connectionStateLabel(state)}. Show on Status`}
          onClick={() => {
            onNavigate()
            if (card) openStatusAt(card)
          }}
        >
          <span className={dotClass(state)} aria-hidden="true" />
          {connectionStateLabel(state)}
        </button>
        <a className="sp-act" href={href} onClick={onNavigate}>
          {action}
        </a>
      </div>
      <div className="sp-lines">{children}</div>
    </section>
  )
}

function Usage({
  used,
  limit,
  left,
  noun
}: {
  used: number
  limit: number | null
  left: number | null
  noun: string
}): JSX.Element {
  const width = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const limitLabel = limit === null ? '—' : limit.toLocaleString('en-US')
  const label = `${used.toLocaleString('en-US')} of ${limitLabel} ${noun}`
  return (
    <>
      <div className="bar" role="img" aria-label={label}>
        <span style={{ width: `${width}%` }} />
      </div>
      <span>
        <span className="mono">{used.toLocaleString('en-US')}</span> of{' '}
        <span className="mono">{limitLabel}</span> {noun}
        {left === null ? null : (
          <>
            {' · '}
            <span className="mono">{left.toLocaleString('en-US')}</span> left
          </>
        )}
      </span>
    </>
  )
}

function dotClass(state: ConnectionState): string {
  if (state === 'ok') return 'sd sd-ok'
  if (state === 'warning') return 'sd sd-warn'
  return 'sd'
}
