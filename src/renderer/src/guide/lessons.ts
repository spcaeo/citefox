import type { GuideLesson } from './types'
import { hasParam, paramOf } from './utils/screens'

/** True on Fixes with a page fix open (`?pf=`, or the page fix drawer over it). */
function fixOpen(hash: string): boolean {
  return (
    hasParam(hash, 'pf') ||
    new URLSearchParams(hash.split('?')[1] ?? '').getAll('drawer').includes('page-fix')
  )
}

/**
 * One short lesson per screen, in the order to suggest them. Fixes, Reports and
 * Settings have one per part: the open route picks it (`part`).
 */
export const LESSONS: readonly GuideLesson[] = [
  {
    id: 'summary',
    screen: 'summary',
    title: 'Your Summary',
    blurb: 'Your numbers at a glance, and how to find anything.',
    help: 'summary'
  },
  {
    id: 'topic',
    screen: 'topic',
    title: 'A topic page',
    blurb: 'Which searches cite you, and the page that should win.',
    help: 'topics'
  },
  {
    id: 'prompt',
    screen: 'prompt',
    title: 'A question page',
    blurb: 'The AI answer, its sources, and who wins instead.',
    help: 'question-page'
  },
  {
    id: 'fixes',
    screen: 'fixes',
    title: 'What to fix',
    blurb: 'Your to-do list of page fixes, biggest win first.',
    help: 'fixes'
  },
  {
    id: 'fix-brief',
    screen: 'fixes',
    title: 'Fix a page',
    blurb: 'Read the brief, mark the edits, and log it when it is live.',
    help: 'fixes',
    part: fixOpen
  },
  {
    id: 'did-it-work',
    screen: 'fixes',
    title: 'Did it work?',
    blurb: 'A verdict on every fix you logged.',
    help: 'fixes',
    part: (hash) => paramOf(hash, 'view') === 'changes' && !fixOpen(hash)
  },
  {
    id: 'topics',
    screen: 'topics',
    title: 'Your topics',
    blurb: 'Every topic, with one number each.',
    help: 'topics'
  },
  {
    id: 'questions',
    screen: 'questions',
    title: 'Your questions',
    blurb: 'Every question CiteFox checks, in one list.',
    help: 'questions'
  },
  {
    id: 'competitors',
    screen: 'competitors',
    title: 'Competitors',
    blurb: 'Who AI answers cite instead of you.',
    help: 'competitors'
  },
  {
    id: 'citations',
    screen: 'citations',
    title: 'Citations',
    blurb: 'Every page AI answers cite, yours and others.',
    help: 'citations'
  },
  {
    id: 'reports',
    screen: 'reports',
    title: 'Reports',
    blurb: 'Ready reports by goal or by report, to open, download or email.',
    help: 'reports'
  },
  {
    id: 'report',
    screen: 'reports',
    title: 'Read a report',
    blurb: 'Tabs, search, download and email inside a report.',
    help: 'reports',
    part: (hash) => hasParam(hash, 'report')
  },
  {
    id: 'history',
    screen: 'history',
    title: 'Check history',
    blurb: 'Every check, and what moved between two.',
    help: 'history'
  },
  {
    id: 'alerts',
    screen: 'alerts',
    title: 'Alerts',
    blurb: 'Hear when you win or lose a citation.',
    help: 'alerts'
  },
  {
    id: 'pages',
    screen: 'pages',
    title: 'Your pages',
    blurb: 'Every page of your site, and which ones get cited.',
    help: 'pages'
  },
  {
    id: 'settings',
    screen: 'settings',
    title: 'Settings',
    blurb: 'The look, celebrations and this guide.',
    help: 'settings'
  },
  {
    id: 'branding',
    screen: 'settings',
    title: 'Report branding',
    blurb: 'Who your reports are from: agency, company or none.',
    help: 'reports-branding',
    part: (hash) => paramOf(hash, 'tab') === 'reports'
  }
]
