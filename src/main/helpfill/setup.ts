import { cleanHost } from '@shared/competitor-hosts'
import {
  HELPFILL_PASTE_MAX,
  type HelpFillEstimate,
  type HelpFillPrompt,
  type HelpFillResult,
  type HelpFillSetupPromptRequest,
  type HelpFillSetupReadRequest,
  type HelpFillSetupSite
} from '@shared/ipc'
import { connectionOf } from '../assist/label'
import { claudePausedReason, planProjectClaude } from '../engine/claude'
import type { EngineHost } from '../engine/host'
import { IpcRequestError } from '../ipc-request'
import { getLatestClaudeCheckup } from '../storage'
import { lastOkCallOn } from '../storage/llm-calls'
import { businessBlock, marketBlock } from '../prompts/blocks'
import { PROJECT_KIND } from './kinds/project'
import { settleRows } from './merge'
import { buildHelpFillPrompt } from './prompt'
import { readReply } from './reader'
import type { HelpFillContext } from './types'

/**
 * `helpfill:setup*` (Docs/HELPFILL.md, New project): the helper before the project
 * exists. The context is the site as typed on the form (domain, brand names, the
 * default market), so the prompt holds only what the user gave and the reply is
 * read with the `project` kind's five sections. Nothing is opened or written.
 */

/** "Read my website" (`projects:fillFromWebsite`): a site read, a switching read, up to 3 web searches. */
const FILL_CALLS = 5
const FILL_USD = 0.05

export function estimateSetup(host: EngineHost): HelpFillEstimate {
  const callText = `Up to ${FILL_CALLS} AI calls`
  const connected =
    host.claude !== undefined ||
    planProjectClaude(host.storage, host.settings(), null).connection !== null
  if (!connected) {
    return {
      kind: PROJECT_KIND.kind,
      available: false,
      calls: FILL_CALLS,
      costText: callText,
      reason: 'Needs CiteFox AI connected.'
    }
  }
  const onPlan = connectionOf(host, null) === 'claude-code'
  // Claude Code whose latest checkup failed (onboarding step 2 found none): the read cannot run.
  const checkup =
    onPlan && host.claude === undefined ? getLatestClaudeCheckup(host.storage.db) : null
  const paused = claudePausedReason(host, null)
  if (paused !== null) {
    return {
      kind: PROJECT_KIND.kind,
      available: false,
      calls: FILL_CALLS,
      costText: `${callText} · on your AI plan`,
      reason: paused
    }
  }
  // A failed checkup counts only until Claude Code answers a real call after it.
  const okSince = checkup === null ? null : lastOkCallOn(host.storage.db, 'claude-code')
  if (checkup !== null && !checkup.result.ready && !(okSince !== null && okSince > checkup.ranAt)) {
    return {
      kind: PROJECT_KIND.kind,
      available: false,
      calls: FILL_CALLS,
      costText: `${callText} · on your AI plan`,
      reason: 'CiteFox AI is not ready.'
    }
  }
  return {
    kind: PROJECT_KIND.kind,
    available: true,
    calls: FILL_CALLS,
    costText: onPlan
      ? `${callText} · on your AI plan`
      : `${callText} · about $${FILL_USD.toFixed(2)}`,
    reason: null
  }
}

export function promptSetup(host: EngineHost, request: HelpFillSetupPromptRequest): HelpFillPrompt {
  const built = buildHelpFillPrompt(
    PROJECT_KIND,
    setupContext(request.site),
    PROJECT_KIND.chatbotCount,
    host.knownSecrets()
  )
  // A new project tracks nothing yet; the builder's "Already tracked: no items yet." says nothing.
  const prompt = built.prompt.replace(/^Already tracked: no .+ yet\.\n/mu, '')
  return { kind: PROJECT_KIND.kind, ...built, prompt }
}

export function readSetup(request: HelpFillSetupReadRequest): HelpFillResult {
  const context = setupContext(request.site)
  const read = readReply(request.text, PROJECT_KIND.sections)
  return settleRows(PROJECT_KIND, context, read.rows, read.warnings)
}

/** The site as a help-fill context: its business and market blocks, nothing tracked. */
export function setupContext(site: HelpFillSetupSite): HelpFillContext {
  const brands = site.brandNames.map((name) => name.trim()).filter((name) => name.length > 0)
  return {
    projectId: 'new-project',
    domain: site.domain,
    brands,
    target: null,
    // Lines with no value ("What it does: not given.") are left out by the prompt builder.
    blocks: [
      businessBlock({ domain: site.domain, summary: null, brandNames: brands }),
      ...(site.market === null
        ? []
        : [
            marketBlock({
              country: site.market.country,
              language: site.market.language,
              location: site.market.location
            })
          ])
    ],
    pagePaths: [],
    targetQuestions: [],
    projectQuestions: [],
    promptId: null,
    subject: null
  }
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>

const HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/u

function rec(value: unknown, channel: string, keys: readonly string[]): Rec {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  const record = value as Rec
  for (const key of Object.keys(record)) if (!keys.includes(key)) throw new IpcRequestError(channel)
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) throw new IpcRequestError(channel)
  }
  return record
}

function short(value: unknown, channel: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new IpcRequestError(channel)
  return value
}

function siteOf(value: unknown, channel: string): HelpFillSetupSite {
  const r = rec(value, channel, ['domain', 'brandNames', 'market'])
  const domain = cleanHost(short(r.domain, channel, 253))
  if (!HOST.test(domain)) throw new IpcRequestError(channel, 'Enter the website’s domain first.')
  if (!Array.isArray(r.brandNames) || r.brandNames.length > 20) throw new IpcRequestError(channel)
  const brandNames = r.brandNames.map((name) => short(name, channel, 100))
  let market: HelpFillSetupSite['market'] = null
  if (r.market !== null) {
    const m = rec(r.market, channel, ['country', 'language', 'location'])
    const country = short(m.country, channel, 2).toUpperCase()
    const language = short(m.language, channel, 12)
    if (!/^[A-Z]{2}$/u.test(country) || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(language)) {
      throw new IpcRequestError(channel)
    }
    const location = m.location === null ? null : short(m.location, channel, 120)
    market = { country, language, location }
  }
  return { domain, brandNames, market }
}

export function parseSetupPrompt(value: unknown): HelpFillSetupPromptRequest {
  const c = 'helpfill:setupPrompt'
  const r = rec(value, c, ['site'])
  return { site: siteOf(r.site, c) }
}

export function parseSetupRead(value: unknown): HelpFillSetupReadRequest {
  const c = 'helpfill:setupRead'
  const r = rec(value, c, ['site', 'text'])
  return { site: siteOf(r.site, c), text: short(r.text, c, HELPFILL_PASTE_MAX) }
}
