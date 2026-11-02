import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { emptyGuideProgress } from '@shared/guide'
import { isHelpTopicId } from '@shared/help-topics'
import { EXPLAINERS, LESSONS, STEPS, stepsOf } from './constants'
import type { GuideFacts, GuideScreen } from './types'
import { lessonFor, stepStatus } from './utils/engine'
import { NO_FACTS } from './utils/facts'
import { routeSignals, sameRoute, screenOfHash } from './utils/screens'

/**
 * The lessons as a whole: one short lesson per screen, every step points at an
 * element its own screen really draws, opens on that screen, and steps that need
 * data the project may not have yet say so or step aside instead of breaking.
 * tests/e2e/guide.spec.ts walks them in the app and screenshots each one.
 */

const ROOT = join(process.cwd(), 'src/renderer/src')

/** Every renderer source file under `dir` that is not a test. */
function sources(dir = ''): string[] {
  const files: string[] = []
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = dir ? `${dir}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...sources(path))
    else if (/\.tsx?$/u.test(entry.name) && !/\.test(-helper)?\.tsx?$/u.test(entry.name)) {
      files.push(path)
    }
  }
  return files
}

const FILES = sources().filter((file) => !file.startsWith('guide/constants'))
const TEXT = new Map(FILES.map((file) => [file, readFileSync(join(ROOT, file), 'utf8')]))

/** Pieces every screen draws: the shell (top bar, sidebar), shared components and ui. */
const SHARED = ['shell/', 'components/', 'ui/', 'engines/', 'guide/']

/** Where each screen's own code lives. */
const SCREEN_DIRS: Readonly<Record<GuideScreen, readonly string[]>> = {
  summary: ['overview/'],
  topics: ['topics/'],
  topic: ['topics/'],
  prompt: ['promptDetail/', 'sites/'],
  questions: ['questions/', 'topics/views/'],
  competitors: ['competitors/'],
  citations: ['citations/', 'allPages/', 'overview/board/'],
  fixes: ['fixes/', 'changes/'],
  history: ['history/'],
  reports: ['reports/'],
  alerts: ['alerts/'],
  pages: ['allPages/'],
  settings: ['settings/', 'reports/branding/']
}

/** The source a screen draws: its own folders plus the shared pieces. */
function screenCode(screen: GuideScreen): string {
  const dirs = [...SCREEN_DIRS[screen], ...SHARED]
  return FILES.filter((file) => dirs.some((dir) => file.startsWith(dir)))
    .map((file) => TEXT.get(file) ?? '')
    .join('\n')
}

/** Template strings in `code` (`Pin ${name} to Summary`) as patterns for the names they make. */
function templates(code: string): RegExp[] {
  // Only templates that start with words of their own (`nav-${…}`), so `${a}` matches nothing.
  const found = [...code.matchAll(/`([^`$\n]{4,}\$\{[^`\n]*)`/gu)]
  return found.map((match) => {
    const parts = (match[1] as string).split(/\$\{[^}]*\}/u)
    const escaped = parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
    return new RegExp(`^${escaped.join('.+')}$`, 'u')
  })
}

/**
 * What a selector names that a screen must draw, with each form the code writes it
 * in: a `data-guide` name, another `data-*` value, an accessible name, an id.
 */
function missingOn(screen: GuideScreen, selector: string): string[] {
  const code = screenCode(screen)
  const patterns = templates(code)
  const missing: string[] = []
  for (const match of selector.matchAll(/data-guide(\^?)="([^"]+)"/gu)) {
    const full = match[2] as string
    // `mark-competitor:twilio.com` is drawn as `mark-competitor:${domain}`.
    const at = full.indexOf(':')
    const prefix = match[1] === '^' || at >= 0
    const name = at >= 0 ? full.slice(0, at + 1) : full
    const forms = prefix
      ? [`data-guide={\`${name}`, `guide={\`${name}`]
      : [`data-guide="${name}"`, `guide="${name}"`, `guide: '${name}'`, `'${name}'`]
    const drawn =
      forms.some((form) => code.includes(form)) ||
      (!prefix && patterns.some((pattern) => pattern.test(name)))
    if (!drawn) missing.push(`data-guide ${full}`)
  }
  for (const match of selector.matchAll(/\[(data-(?!guide)[a-z-]+)="([^"]+)"\]/gu)) {
    const [, attr, value] = match as unknown as [string, string, string]
    if (attr === 'data-line-key' || attr === 'data-col') continue
    if (!code.includes(attr) || !code.includes(`"${value}"`)) missing.push(`${attr} ${value}`)
  }
  for (const match of selector.matchAll(/aria-label="([^"]+)"/gu)) {
    const label = match[1] as string
    const literal = [`"${label}"`, `'${label}'`].some((form) => code.includes(form))
    // A tree group's toggle is named `${open ? 'Close' : 'Open'} ${group.label}`.
    const toggle = /^Open /u.test(label) && code.includes("${open ? 'Close' : 'Open'}")
    if (!literal && !toggle && !patterns.some((pattern) => pattern.test(label))) {
      missing.push(`name ${label}`)
    }
  }
  // `#topic-views-list` is the Tabs panel id `<panelId>-<view>`, or a plain id.
  for (const match of selector.matchAll(/#([a-z][\w-]*)/gu)) {
    const id = match[1] as string
    if (id === 'main') continue
    const panel = /^(.+?)-(tab-)?([a-z]+)$/u.exec(id)
    const found =
      code.includes(`"${id}"`) ||
      code.includes(`'${id}'`) ||
      (panel !== null && code.includes(`'${panel[1]}'`) && code.includes(`'${panel[3]}'`))
    if (!found) missing.push(`id ${id}`)
  }
  return missing
}

const FULL: GuideFacts = {
  hasResults: true,
  topic: { id: 't1', name: 'Text alerts', marketId: null, targetPage: null },
  prompt: { id: 'q6', label: 'Q6' },
  citesOwn: 3,
  noPage: { id: 'q2', label: 'Q2' },
  rival: { domain: 'twilio.com', answers: 4, promptId: 'q4' },
  pageFix: { improve: 'pf1', owner: 'pf2', create: 'pf3' },
  loggedFix: 'fix1',
  topics: 2,
  competitors: 1
}

const SCREENS: readonly GuideScreen[] = Object.keys(SCREEN_DIRS) as GuideScreen[]

describe('guide lessons', () => {
  test('one short lesson per screen: 3 to 5 steps, all on its screen; ids are unique', () => {
    for (const screen of SCREENS) {
      expect(
        LESSONS.some((lesson) => lesson.screen === screen),
        screen
      ).toBe(true)
      expect(EXPLAINERS[screen], screen).toBeTruthy()
    }
    for (const lesson of LESSONS) {
      const steps = stepsOf(lesson.id)
      expect(steps.length, lesson.id).toBeGreaterThanOrEqual(3)
      expect(steps.length, lesson.id).toBeLessThanOrEqual(5)
      for (const step of steps) expect(step.screen, step.id).toBe(lesson.screen)
    }
    const ids = STEPS.map((step) => step.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(LESSONS.map((lesson) => lesson.id)).size).toBe(LESSONS.length)
  })

  test('the new Reports parts each have a lesson or a step', () => {
    const ids = STEPS.map((step) => step.id)
    // By goal / By report, the new kinds, grouped tabs, branding in Settings › Reports.
    for (const id of ['reports', 'report-kinds', 'report-tabs', 'branding-mode']) {
      expect(ids).toContain(id)
    }
    expect(STEPS.find((step) => step.id === 'report-kinds')?.anchor).toBe('[data-card="pitch"]')
  })

  test("every step and pointer names an element its own screen's code really draws", () => {
    const missing: string[] = []
    for (const step of STEPS) {
      const selectors = [
        step.anchor,
        ...(step.hints ?? []).map((hint) => hint.anchor),
        ...(step.target?.(FULL) ?? [])
      ]
      for (const selector of selectors) {
        for (const name of missingOn(step.screen, selector)) missing.push(`${step.id}: ${name}`)
      }
    }
    expect(missing).toEqual([])
    // The check itself catches a name nothing draws, or one drawn on another screen.
    expect(missingOn('summary', '[data-guide="no-such-control"]')).not.toEqual([])
    expect(missingOn('summary', 'button[aria-label="No such button"]')).not.toEqual([])
    expect(missingOn('summary', '#no-such-id')).not.toEqual([])
    expect(missingOn('summary', '[data-guide="pagefix-copy"]')).not.toEqual([])
  })

  test('steps point at controls by data attribute, accessible name or id, never by visible words', () => {
    for (const step of STEPS) {
      for (const selector of [step.anchor, ...(step.target?.(FULL) ?? [])]) {
        expect(selector, step.id).not.toMatch(/:has-text|:contains|text=/u)
      }
    }
  })

  test('with the data it needs, every step opens on its own screen and in its own lesson', () => {
    for (const step of STEPS) {
      const route = step.route(FULL)
      expect(route, step.id).not.toBeNull()
      expect(screenOfHash(route ?? ''), step.id).toBe(step.screen)
      expect(lessonFor(step.screen, route ?? ''), step.id).toBe(step.lesson)
    }
  })

  test('the first run: the Summary lesson needs no results', () => {
    for (const step of stepsOf('summary')) {
      expect(step.route(NO_FACTS)).toBe('#/overview')
      expect(stepStatus(step, emptyGuideProgress('p1'), NO_FACTS)).toBe('todo')
    }
  })

  test('Fix a page opens the page fix drawer in Fixes, then its Page edits tab', () => {
    const route = (id: string): string | null =>
      STEPS.find((step) => step.id === id)?.route(FULL) ?? null
    expect(route('fix-list')).toBe('#/fixes')
    expect(route('fix-read-brief')).toBe('#/fixes?pf=pf1')
    expect(route('fix-review-edits')).toBe('#/fixes?pf=pf1&pft=edits')
    expect(route('work-live-since')).toBe('#/fixes?view=changes')
    expect(route('work-detail')).toBe('#/fixes?view=changes&row=fix1')
    expect(route('report-kinds')).toBe('#/reports?layout=reports')
    expect(route('report-tabs')).toBe('#/reports?report=visibility')
    expect(route('branding-mode')).toBe('#/settings?tab=reports')
    // Steps inside a drawer sit over it and need their exact route.
    for (const step of STEPS.filter((item) => item.layer === 'drawer')) {
      expect(step.exact, step.id).toBe(true)
      expect(step.screen).toBe('fixes')
    }
  })

  test('no page fix and no logged fix yet: the steps say so kindly or step aside', () => {
    const empty = {
      ...FULL,
      pageFix: { improve: null, owner: null, create: null },
      loggedFix: null
    }
    const progress = emptyGuideProgress('p1')
    const status = (id: string): string => {
      const step = STEPS.find((item) => item.id === id)
      if (!step) throw new Error(id)
      return stepStatus(step, progress, empty)
    }
    const list = STEPS.find((step) => step.id === 'fix-list')
    expect(status('fix-list')).toBe('todo')
    expect(list?.note?.(empty)).toMatch(/^Nothing to fix right now\./u)
    expect(list?.note?.(FULL)).toBeNull()
    for (const id of ['fix-kinds', 'fix-open', 'fix-read-brief', 'fix-review-edits']) {
      expect(status(id), id).toBe('unavailable')
    }
    const work = STEPS.find((step) => step.id === 'work-live-since')
    expect(status('work-live-since')).toBe('todo')
    expect(work?.note?.(empty)).toMatch(/^No fix logged yet\./u)
    expect(status('work-detail')).toBe('unavailable')
    // Only an owner fix: the improve-only steps step aside, I published this stays.
    const owner = { ...empty, pageFix: { improve: null, owner: 'pf2', create: null } }
    const ownerStatus = (id: string): string =>
      stepStatus(STEPS.find((item) => item.id === id) ?? STEPS[0]!, progress, owner)
    expect(ownerStatus('fix-page-edits')).toBe('unavailable')
    expect(ownerStatus('fix-published')).toBe('todo')
  })

  test('calm copy: one-line titles, at most two short sentences, no provider names', () => {
    for (const step of STEPS) {
      expect(step.title.length, step.id).toBeLessThanOrEqual(36)
      const sentences = step.body.split(/(?<=[.!?])\s+/u)
      expect(sentences.length, step.id).toBeLessThanOrEqual(2)
      expect(step.body.length, step.id).toBeLessThanOrEqual(140)
      expect(step.body).not.toMatch(/cloro|serpapi|claude|jina|anthropic/iu)
    }
    for (const lesson of LESSONS) {
      expect(lesson.blurb.length, lesson.id).toBeLessThanOrEqual(70)
    }
  })

  test('every lesson links its help topic', () => {
    for (const lesson of LESSONS) expect(isHelpTopicId(lesson.help), lesson.id).toBe(true)
  })
})

describe('what a route counts as done', () => {
  test('a question, its sources, a page fix and its Page edits tab, a report', () => {
    expect(routeSignals('#/pages/t1/prompt/q6')).toEqual(['prompt-opened'])
    expect(routeSignals('#/pages/t1/prompt/q6?view=sources')).toEqual([
      'prompt-opened',
      'sources-viewed'
    ])
    expect(routeSignals('#/fixes?pf=pf1')).toEqual(['page-fix-opened'])
    expect(routeSignals('#/fixes?pf=pf1&pft=edits')).toEqual([
      'page-fix-opened',
      'page-edits-opened'
    ])
    expect(routeSignals('#/pages?drawer=page-fix&pfx.id=pf1&pfx.tab=edits')).toEqual([
      'page-fix-opened',
      'page-edits-opened'
    ])
    expect(routeSignals('#/overview?pf=pf1')).toEqual([])
    expect(routeSignals('#/reports?report=pitch')).toEqual(['report-opened'])
    expect(routeSignals('#/reports?layout=reports')).toEqual([])
  })

  test('the same route in any key order', () => {
    expect(sameRoute('#/fixes?pft=edits&pf=pf1', '#/fixes?pf=pf1&pft=edits')).toBe(true)
    expect(sameRoute('#/fixes?pf=pf1', '#/fixes')).toBe(false)
    expect(sameRoute('#/fixes', '#/fixes')).toBe(true)
  })
})
