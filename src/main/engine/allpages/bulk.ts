import { intervalLabel, type IntervalDays, type PageSummary } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import type {
  BulkActionRequest,
  BulkActionResult,
  BulkCostTiming,
  BulkEstimate,
  BulkSkip,
  StoppedPage
} from '@shared/ipc'
import { IpcRequestError } from '../../ipc-request'
import { estimateCheckSearches } from '../../queue/estimate'
import { changeGroupPages } from '../../storage/group-records'
import {
  addPageMarket,
  listPageMarketSchedules,
  listPages,
  setPagePinned,
  setPageStatus,
  updateStoredPage
} from '../../storage/pages'
import { readProjectProfile } from '../../storage/project-profile'
import type { CheckRequest } from '../checks/prepare'
import { projectSearchBudget } from '../checks/glance'
import type { AllPagesPass } from './pass'
import { enabledPromptCounts, searchesLeftFor } from './rows'
import { addPagesToGroup, groupExists, readMemberships } from './structure'

const WORKING = new Set(['tracked', 'setting_up', 'paused'])

/** What a bulk action needs to know about each selected page. */
interface Candidate {
  page: PageSummary
  prompts: number
  marketIds: readonly string[]
  /** True when the page has an active prompt set with an enabled prompt. */
  ready: boolean
}

interface Plan {
  eligible: Candidate[]
  skipped: BulkSkip[]
  minSearches: number
  maxSearches: number
  timing: BulkCostTiming
}

/** FR-20.3. Every bulk action shows its search cost before it runs. */
export function estimateBulk(pass: AllPagesPass, request: BulkActionRequest): BulkEstimate {
  const plan = planBulk(pass, request)
  const left = searchesLeftFor(
    pass,
    projectSearchBudget(pass.storage, pass.project.id, pass.db, pass.scorePass)
  )
  return {
    action: request.action,
    selected: request.pageIds.length,
    eligible: plan.eligible.length,
    skipped: plan.skipped,
    minSearches: plan.minSearches,
    maxSearches: plan.maxSearches,
    timing: plan.timing,
    searchesLeft: left,
    summary: estimateSummary(request, plan, left)
  }
}

export interface BulkRunDeps {
  createId: () => string
  startCheck: (request: CheckRequest) => void
}

export function runBulk(
  pass: AllPagesPass,
  request: BulkActionRequest,
  deps: BulkRunDeps
): BulkActionResult {
  const plan = planBulk(pass, request)
  const at = pass.now.toISOString()
  const skipped = plan.skipped.reduce((sum, skip) => sum + skip.count, 0)
  const pages = plan.eligible.map((item) => item.page)
  const done = (
    changed: number,
    message: string,
    jobId: string | null = null
  ): BulkActionResult => ({
    action: request.action,
    changed,
    skipped,
    message,
    jobId
  })
  const { db, project } = pass
  switch (request.action) {
    case 'track': {
      const fallback = readProjectProfile(db)?.market?.id ?? null
      db.transaction(() => {
        for (const item of plan.eligible) {
          let defaultMarketId = item.page.defaultMarketId
          if (item.marketIds.length === 0) {
            const marketId = defaultMarketId ?? fallback
            if (marketId === null) continue
            addPageMarket(db, { pageId: item.page.id, marketId, addedAt: at, baselineRunId: null })
            defaultMarketId = marketId
          }
          updateStoredPage(db, item.page.id, project.id, {
            status:
              item.page.status === 'paused' || item.page.setupStep === 'check'
                ? 'tracked'
                : 'setting_up',
            ...(defaultMarketId !== null ? { defaultMarketId } : {})
          })
        }
      })()
      return done(
        pages.length,
        `${pluralize(pages.length, 'page')} set to track. Pages that were not set up start at Read page; paused pages resume.`
      )
    }
    case 'check': {
      const [first, ...rest] = pages.map((page) => page.id)
      if (first === undefined) return done(0, 'No selected page is set up to check yet.')
      const jobId = `job-${deps.createId()}`
      deps.startCheck({
        projectId: project.id,
        pageIds: [first, ...rest],
        marketIds: null,
        promptIds: null,
        jobId
      })
      return done(
        pages.length,
        `Checking ${pluralize(pages.length, 'page')} now in every market they track: about ${range(plan)} searches. Progress shows in the tray.`,
        jobId
      )
    }
    case 'add_market': {
      const marketId = requireMarket(pass, request)
      db.transaction(() => {
        for (const page of pages) {
          addPageMarket(db, { pageId: page.id, marketId, addedAt: at, baselineRunId: null })
        }
      })()
      return done(
        pages.length,
        `Added the market to ${pluralize(pages.length, 'page')}. Each is checked there at its next check.`
      )
    }
    case 'change_schedule': {
      const intervalDays = requireInterval(request)
      db.transaction(() => {
        for (const page of pages) updateStoredPage(db, page.id, project.id, { intervalDays })
      })()
      return done(
        pages.length,
        `${pluralize(pages.length, 'page')} now checked ${intervalLabel(intervalDays).toLowerCase()}.`
      )
    }
    case 'pause': {
      db.transaction(() => {
        for (const page of pages) updateStoredPage(db, page.id, project.id, { status: 'paused' })
      })()
      return done(pages.length, `Paused ${pluralize(pages.length, 'page')}. History is kept.`)
    }
    case 'resume': {
      db.transaction(() => {
        for (const page of pages) updateStoredPage(db, page.id, project.id, { status: 'tracked' })
      })()
      return done(
        pages.length,
        `Resumed ${pluralize(pages.length, 'page')}. Each is checked again at its next check.`
      )
    }
    case 'stop': {
      const previous: StoppedPage[] = pages.map((page) => ({
        pageId: page.id,
        previousStatus: page.status
      }))
      db.transaction(() => {
        for (const page of pages) setPageStatus(db, page.id, 'removed', project.id)
      })()
      return {
        ...done(
          pages.length,
          `Stopped tracking ${pluralize(pages.length, 'page')}. History stays; no more searches are used.`
        ),
        previous
      }
    }
    case 'pin': {
      db.transaction(() => {
        for (const page of pages) setPagePinned(db, page.id, true, project.id, at)
      })()
      return done(pages.length, `Pinned ${pluralize(pages.length, 'page')} to the sidebar.`)
    }
    case 'remove_from_group': {
      const groupId = requireGroup(pass, request)
      changeGroupPages(
        db,
        groupId,
        [],
        pages.map((page) => page.id),
        at
      )
      return done(pages.length, `Removed ${pluralize(pages.length, 'page')} from the group.`)
    }
    case 'add_to_group': {
      const groupId = requireGroup(pass, request)
      const added = addPagesToGroup(
        db,
        groupId,
        pages.map((page) => page.id),
        pass.now.toISOString()
      )
      return done(added, `Added ${pluralize(added, 'page')} to the group.`)
    }
    case 'export':
      return done(pages.length, `${pluralize(pages.length, 'row')} ready to export.`)
  }
}

function planBulk(pass: AllPagesPass, request: BulkActionRequest): Plan {
  const { db, project } = pass
  const wanted = new Set(request.pageIds)
  const enabled = enabledPromptCounts(db)
  const markets = listPageMarketSchedules(db)
  const candidates: Candidate[] = listPages(db, project.id)
    .filter((page) => wanted.has(page.id))
    .map((page) => ({
      page,
      prompts: enabled.get(page.id) ?? page.promptCount,
      marketIds: (markets.get(page.id) ?? []).map((market) => market.marketId),
      ready: (enabled.get(page.id) ?? 0) > 0
    }))
  const missing = request.pageIds.length - candidates.length
  const skips = new Map<string, number>()
  const skip = (reason: string): void => {
    skips.set(reason, (skips.get(reason) ?? 0) + 1)
  }
  if (missing > 0) skips.set('no longer in this project', missing)
  const groupTarget =
    request.action === 'add_to_group' || request.action === 'remove_from_group'
      ? requireGroup(pass, request)
      : null
  const groupMembers = groupTarget === null ? null : readMemberships(db).groups
  const eligible: Candidate[] = []
  let min = 0
  let max = 0
  let timing: BulkCostTiming = 'none'
  const perCheck = (
    item: Candidate,
    marketCount = Math.max(1, item.marketIds.length)
  ): { minSearches: number; maxSearches: number } =>
    estimateCheckSearches({
      prompts: item.prompts,
      markets: marketCount,
      samples: item.page.samples
    })
  for (const item of candidates) {
    const status = item.page.status
    switch (request.action) {
      case 'track': {
        if (status === 'tracked' || status === 'setting_up') {
          skip('already tracked')
          continue
        }
        const cost = perCheck(item)
        min += cost.minSearches
        max += cost.maxSearches
        timing = 'first_checks'
        break
      }
      case 'check': {
        if (!WORKING.has(status)) {
          skip('not tracked')
          continue
        }
        if (!item.ready || item.marketIds.length === 0) {
          skip('not set up yet')
          continue
        }
        const cost = perCheck(item)
        min += cost.minSearches
        max += cost.maxSearches
        timing = 'now'
        break
      }
      case 'add_market': {
        const marketId = requireMarket(pass, request)
        if (!WORKING.has(status)) {
          skip('not tracked')
          continue
        }
        if (item.marketIds.includes(marketId)) {
          skip('already in that market')
          continue
        }
        const cost = perCheck(item, 1)
        const perMonth = checksPerMonth(item.page.intervalDays)
        min += cost.minSearches * perMonth
        max += cost.maxSearches * perMonth
        timing = 'per_month'
        break
      }
      case 'change_schedule': {
        const intervalDays = requireInterval(request)
        if (status === 'removed') {
          skip('removed')
          continue
        }
        if (item.page.intervalDays === intervalDays) {
          skip(`already ${intervalLabel(intervalDays).toLowerCase()}`)
          continue
        }
        if (status === 'tracked' || status === 'setting_up') {
          const cost = perCheck(item)
          const delta = checksPerMonth(intervalDays) - checksPerMonth(item.page.intervalDays)
          min += cost.minSearches * delta
          max += cost.maxSearches * delta
        }
        break
      }
      case 'pause': {
        if (status !== 'tracked' && status !== 'setting_up') {
          skip(status === 'paused' ? 'already paused' : 'not tracked')
          continue
        }
        const cost = perCheck(item)
        const perMonth = checksPerMonth(item.page.intervalDays)
        min += cost.minSearches * perMonth
        max += cost.maxSearches * perMonth
        timing = 'saved_per_month'
        break
      }
      case 'resume': {
        if (status !== 'paused') {
          skip('not paused')
          continue
        }
        const cost = perCheck(item)
        const perMonth = checksPerMonth(item.page.intervalDays)
        min += cost.minSearches * perMonth
        max += cost.maxSearches * perMonth
        timing = 'per_month'
        break
      }
      case 'stop': {
        if (!WORKING.has(status)) {
          skip('not tracked')
          continue
        }
        if (status !== 'paused') {
          const cost = perCheck(item)
          const perMonth = checksPerMonth(item.page.intervalDays)
          min += cost.minSearches * perMonth
          max += cost.maxSearches * perMonth
          timing = 'saved_per_month'
        }
        break
      }
      case 'pin': {
        if (status === 'removed') {
          skip('removed')
          continue
        }
        if (item.page.pinned) {
          skip('already pinned')
          continue
        }
        break
      }
      case 'remove_from_group': {
        const groupId = groupTarget ?? requireGroup(pass, request)
        const inGroup = groupMembers?.get(item.page.id)?.some((group) => group.id === groupId)
        if (inGroup !== true) {
          skip('not in that group')
          continue
        }
        break
      }
      case 'add_to_group': {
        const groupId = groupTarget ?? requireGroup(pass, request)
        const inGroup = groupMembers?.get(item.page.id)?.some((group) => group.id === groupId)
        if (inGroup === true) {
          skip('already in that group')
          continue
        }
        break
      }
      case 'export':
        break
    }
    eligible.push(item)
  }
  if (request.action === 'change_schedule') {
    timing = min === 0 && max === 0 ? 'none' : min < 0 ? 'saved_per_month' : 'per_month'
    if (min < 0) {
      const saved = { min: Math.abs(max), max: Math.abs(min) }
      min = saved.min
      max = saved.max
    }
  }
  return {
    eligible,
    skipped: [...skips.entries()].map(([reason, count]) => ({ reason, count })),
    minSearches: Math.round(min),
    maxSearches: Math.round(max),
    timing
  }
}

/** Section 8. Checks a month at an interval, as a fraction (14 days is about 2). */
function checksPerMonth(intervalDays: IntervalDays): number {
  return 30 / intervalDays
}

function requireMarket(pass: AllPagesPass, request: BulkActionRequest): string {
  const marketId = request.marketId
  if (marketId === null) throw new IpcRequestError('allpages:run', 'Choose a market')
  const exists = pass.db.prepare(`SELECT 1 FROM markets WHERE id = ?`).get(marketId)
  if (exists === undefined) throw new IpcRequestError('allpages:run', 'That market was not found')
  return marketId
}

function requireInterval(request: BulkActionRequest): IntervalDays {
  if (request.intervalDays === null) {
    throw new IpcRequestError('allpages:run', 'Choose how often to check')
  }
  return request.intervalDays
}

function requireGroup(pass: AllPagesPass, request: BulkActionRequest): string {
  if (request.groupId === null || !groupExists(pass.db, request.groupId)) {
    throw new IpcRequestError('allpages:run', 'That group was not found')
  }
  return request.groupId
}

const PER_MONTH_VERB: Partial<Record<BulkActionRequest['action'], string>> = {
  add_market: 'Adding the market to',
  resume: 'Resuming'
}

function range(plan: Pick<Plan, 'minSearches' | 'maxSearches'>): string {
  return `${plan.minSearches.toLocaleString('en-US')}–${plan.maxSearches.toLocaleString('en-US')}`
}

function estimateSummary(request: BulkActionRequest, plan: Plan, left: number | null): string {
  const count = plan.eligible.length
  const pages = pluralize(count, 'page')
  const leftText = left === null ? '' : ` (${left.toLocaleString('en-US')} left this month)`
  if (count === 0) return 'None of the selected pages can take this action.'
  switch (plan.timing) {
    case 'now':
      return `Checking ${pages} now uses about ${range(plan)} searches${leftText}.`
    case 'first_checks':
      return `Tracking ${pages}: their checks use about ${range(plan)} searches each time${leftText}. Pages that are not set up run no search until setup is done.`
    case 'per_month':
      return `${PER_MONTH_VERB[request.action] ?? 'Changing the schedule of'} ${pages} adds about ${range(plan)} searches a month${leftText}.`
    case 'saved_per_month':
      return request.action === 'stop'
        ? `Stopping ${pages} saves about ${range(plan)} searches a month. History stays; no more searches are used.`
        : `${request.action === 'pause' ? 'Pausing' : 'Changing the schedule of'} ${pages} saves about ${range(plan)} searches a month. No search runs now.`
    case 'none':
      return request.action === 'export'
        ? `Exporting ${pluralize(count, 'row')} runs no search.`
        : request.action === 'stop'
          ? `Stopping ${pages} runs no search. History stays.`
          : `This changes ${pages} and runs no search.`
  }
}
