import type { IpcInvokeChannel } from '@shared/ipc'

/**
 * What the browser demo (site/demo, Docs/DEMO.md) does with each IPC invoke.
 *
 * - `read`: answered from the recorded snapshot (snapshot.json), which the real
 *   handlers produced on the TextBolt demo project (`npm run demo:record`).
 * - `quiet`: a small change the screens make on their own or that only affects
 *   this browser (the guide's progress, a saved column layout, the theme). It is
 *   answered like a read, without the demo notice, and nothing is stored.
 * - everything else is `blocked`: it needs the real app (a check, a key, email,
 *   a file, an AI call, any saved change). The demo shows one friendly message.
 *
 * A channel not listed here is blocked, so a new channel never runs by accident.
 * A read is listed only when the recorded tour (tests/demo/crawl.ts) makes it;
 * add a step to the tour before adding a read.
 * src/renderer/demo/bridge.test.ts checks every read has an answer.
 */

export type DemoPolicy = 'read' | 'quiet' | 'blocked'

export const DEMO_READS: readonly IpcInvokeChannel[] = [
  'account:get',
  'alerts:get',
  'alerts:listRules',
  'allpages:citations',
  'allpages:citedPages',
  'allpages:list',
  'app:getInfo',
  'buyerProfile:get',
  'checks:getPrompt',
  'checks:listActive',
  'communities:get',
  'competitors:list',
  'competitors:overview',
  'competitors:siteTypes',
  'connections:activityLog',
  'connections:getOverview',
  'connections:projectClaude',
  'deliveries:list',
  'email:getSettings',
  'engines:get',
  'engines:question',
  'engines:spend',
  'engines:summary',
  'exports:getAuto',
  'favicons:get',
  'fixes:briefs',
  'fixes:ledger',
  'fixes:list',
  'fixes:listProject',
  'fixes:pageFixCount',
  'fixes:searches',
  'gaps:get',
  'gaps:getStates',
  'grid:getScreenView',
  'grid:getSummaryBoard',
  'grid:listViews',
  'guide:get',
  'history:list',
  'history:listProject',
  'keys:list',
  'llm:calls',
  'llm:usage',
  'notices:list',
  'onboarding:getState',
  'pageChanges:list',
  'pages:get',
  'pages:getRead',
  'pages:list',
  'pages:pinned',
  'pages:search',
  'permissions:list',
  'products:get',
  'products:page',
  'projectRules:list',
  'projectSettings:get',
  'projectSettings:markets',
  'projectSettings:usage',
  'projects:get',
  'projects:list',
  'prompts:list',
  'prompts:listSets',
  'prompts:versions',
  'questions:get',
  'questions:list',
  'queue:getStatus',
  'reports:getBranding',
  'reports:getSender',
  'reports:list',
  'reports:metrics',
  'reports:review',
  'results:get',
  'results:history',
  'schedule:getProject',
  'schedule:listDue',
  'scores:listPages',
  'scores:listProjects',
  'search:questions',
  'sentiment:get',
  'settings:get',
  'setup:page',
  'setup:status',
  'sitemaps:get',
  'start:get',
  'start:status',
  'status:getCapsule',
  'structure:clusterSummary',
  'structure:get',
  'templates:list',
  'templates:steps',
  'templates:usage',
  'templates:versions',
  'topics:folders',
  'topics:list',
  'topics:results',
  'tracking:changes',
  'tray:getLine',
  'updates:get',
  'videos:get',
  'visibility:overview'
]

export const DEMO_QUIET: readonly IpcInvokeChannel[] = [
  'guide:update',
  'guide:signal',
  'guide:restart',
  'grid:setScreenView',
  'grid:setSummaryBoard',
  'settings:update',
  'updates:check',
  'updates:dismiss',
  'projects:switch'
]

const READS: ReadonlySet<string> = new Set(DEMO_READS)
const QUIET: ReadonlySet<string> = new Set(DEMO_QUIET)

export function demoPolicy(channel: IpcInvokeChannel): DemoPolicy {
  if (READS.has(channel)) return 'read'
  if (QUIET.has(channel)) return 'quiet'
  return 'blocked'
}

/** The one message every blocked action shows. */
export const DEMO_BLOCKED_MESSAGE =
  'This is a demo with sample data. Download CiteFox to run real checks.'
