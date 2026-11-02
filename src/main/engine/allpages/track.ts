import type { PageSummary } from '@shared/domain'
import type {
  IgnoreUrlRequest,
  IgnoreUrlResult,
  TrackUrlRequest,
  TrackUrlResult,
  UndoTrackRequest
} from '@shared/ipc'
import { IpcRequestError } from '../../ipc-request'
import { rejectBlockedLiteral } from '../../pipeline/fetch-guard'
import { setCitationIgnored } from '../../storage/ignored-citations'
import {
  addPageMarket,
  getPage,
  insertPage,
  listPageMarkets,
  listPages,
  updateStoredPage
} from '../../storage/pages'
import { readProjectProfile } from '../../storage/project-profile'
import { readProjectSchedule } from '../../storage/project-schedule'
import { hostMatchesDomain, hostOf, normalizeUrl } from '../checks/url'
import type { EngineHost } from '../host'
import type { AllPagesPass } from './pass'

/**
 * FR-20.5 Track. A cited own URL becomes a page that is being set up, with the
 * project's default market. A page the sitemap already found keeps its row.
 * Undo puts the row back the way it was, or removes a row this call added
 * while it has no data yet.
 */
export function trackCitedUrl(
  host: EngineHost,
  pass: AllPagesPass,
  request: TrackUrlRequest
): TrackUrlResult {
  const channel = 'allpages:trackUrl'
  const { db, project } = pass
  rejectBlockedLiteral(request.url)
  const normalized = normalizeUrl(request.url)
  const profile = readProjectProfile(db)
  if (normalized === null || !ownUrl(request.url, project.domain, profile?.includeSubdomains)) {
    throw new IpcRequestError(channel, `Only pages on ${project.domain} can be tracked here`)
  }
  const marketId = profile?.market?.id ?? null
  if (marketId === null) {
    throw new IpcRequestError(channel, 'Set the project default market first')
  }
  const existing = listPages(db, project.id).find(
    (page) => page.url !== null && normalizeUrl(page.url) === normalized
  )
  const at = pass.now.toISOString()
  if (existing !== undefined) {
    if (existing.status === 'tracked' || existing.status === 'setting_up') {
      return {
        pageId: existing.id,
        message: 'This page is already tracked.',
        previousStatus: existing.status
      }
    }
    db.transaction(() => {
      if (listPageMarkets(db, existing.id).length === 0) {
        addPageMarket(db, { pageId: existing.id, marketId, addedAt: at, baselineRunId: null })
      }
      updateStoredPage(db, existing.id, project.id, {
        status:
          existing.status === 'paused' || existing.setupStep === 'check' ? 'tracked' : 'setting_up',
        defaultMarketId: existing.defaultMarketId ?? marketId
      })
    })()
    return {
      pageId: existing.id,
      message: trackedMessage(existing),
      previousStatus: existing.status
    }
  }
  const settings = host.settings()
  const schedule = readProjectSchedule(db, project.id)
  const page: PageSummary = {
    id: `page-${host.createId()}`,
    projectId: project.id,
    url: request.url,
    title: null,
    label: null,
    folder: folderOf(request.url),
    status: 'setting_up',
    setupStep: 'read',
    intervalDays: schedule.defaultIntervalDays,
    samples: settings.defaultSamples,
    promptCount: settings.defaultPromptCount,
    defaultMarketId: marketId,
    pinned: false,
    score: null,
    promptSetVersion: null
  }
  db.transaction(() => {
    insertPage(db, page)
    addPageMarket(db, { pageId: page.id, marketId, addedAt: at, baselineRunId: null })
  })()
  return { pageId: page.id, message: trackedMessage(page), previousStatus: null }
}

export function undoTrackCitedUrl(
  pass: AllPagesPass,
  request: UndoTrackRequest
): { pageId: string } {
  const channel = 'allpages:undoTrack'
  const { db, project } = pass
  const page = getPage(db, request.pageId, project.id)
  if (page === null) throw new IpcRequestError(channel, 'That page was not found')
  if (request.previousStatus === null) {
    if (page.setupStep !== 'read') {
      throw new IpcRequestError(
        channel,
        'This page has been read since. Remove it from its page instead'
      )
    }
    db.transaction(() => {
      db.prepare(`DELETE FROM page_markets WHERE page_id = ?`).run(page.id)
      db.prepare(`DELETE FROM pages WHERE id = ?`).run(page.id)
    })()
    return { pageId: page.id }
  }
  if (request.previousStatus === 'not_tracked' || request.previousStatus === 'removed') {
    db.prepare(`UPDATE pages SET status = ? WHERE id = ?`).run(request.previousStatus, page.id)
  } else {
    updateStoredPage(db, page.id, project.id, { status: request.previousStatus })
  }
  return { pageId: page.id }
}

/** FR-20.5 Ignore, and its Undo. */
export function ignoreCitedUrl(pass: AllPagesPass, request: IgnoreUrlRequest): IgnoreUrlResult {
  const normalized = normalizeUrl(request.url)
  if (normalized === null) throw new IpcRequestError('allpages:ignoreUrl')
  setCitationIgnored(pass.db, {
    normalizedUrl: normalized,
    url: request.url,
    ignored: request.ignored,
    at: pass.now.toISOString()
  })
  return { normalizedUrl: normalized, ignored: request.ignored }
}

function ownUrl(url: string, domain: string, includeSubdomains: boolean | undefined): boolean {
  const host = hostOf(url)
  return host.length > 0 && hostMatchesDomain(host, domain, includeSubdomains ?? false)
}

function folderOf(url: string): string | null {
  const parts = new URL(url).pathname.split('/').filter((part) => part.length > 0)
  if (parts.length < 2) return null
  return parts[0] ?? null
}

function trackedMessage(page: Pick<PageSummary, 'label' | 'title' | 'url'>): string {
  return `${page.label ?? page.title ?? page.url} is tracked with the project's default market. Finish its setup to run its first check.`
}
