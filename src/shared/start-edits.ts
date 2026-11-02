/**
 * Pure rules for the user's edits along the first-run journey: plain-words
 * summaries and how active edits change rivals, buyers, pages and questions.
 * Main applies them to the live snapshot, the saved plan and the steps still
 * to run; the screens only render what comes back.
 */

import type {
  SiteStartPage,
  SiteStartPlan,
  StartBuyers,
  StartEdit,
  StartEditRecord,
  StartKnown,
  StartQuestion,
  StartRival,
  StartRivalKind
} from './ipc'

const RIVAL_GROUP: Readonly<Record<StartRivalKind, string>> = {
  competitor: 'competitor',
  switch_from: 'option buyers switch from',
  partner: 'partner'
}

const RIVAL_LIST: Readonly<Record<StartRivalKind, string>> = {
  competitor: 'Competitors',
  switch_from: 'Switch from',
  partner: 'Partners'
}

function clip(text: string, max = 60): string {
  const flat = text.replace(/\s+/gu, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

/** "Removed competitor PagerDuty", "Moved WIN-911 to Partners". */
export function summarizeEdit(edit: StartEdit): string {
  switch (edit.kind) {
    case 'rival':
      if (edit.op === 'add') return `Added ${RIVAL_GROUP[edit.rivalKind]} ${clip(edit.name)}`
      if (edit.op === 'remove') return `Removed ${clip(edit.name)}`
      if (edit.op === 'rename') return `Renamed ${clip(edit.name)} to ${clip(edit.to)}`
      return `Moved ${clip(edit.name)} to ${RIVAL_LIST[edit.rivalKind]}`
    case 'segment':
    case 'trigger': {
      const noun = edit.kind === 'segment' ? 'segment' : 'trigger'
      if (edit.op === 'add') return `Added ${noun} ${clip(edit.text)}`
      if (edit.op === 'remove') return `Removed ${noun} ${clip(edit.text)}`
      return `Changed ${noun} to ${clip(edit.to)}`
    }
    case 'who':
      return 'Changed who buys'
    case 'page':
      return edit.op === 'add'
        ? `Added page ${clip(pathOf(edit.url))}`
        : `Removed page ${clip(pathOf(edit.url))}`
    case 'question':
      if (edit.op === 'add') return `Added a question: ${clip(edit.text, 50)}`
      if (edit.op === 'remove') return 'Dropped a question'
      return `Edited a question: ${clip(edit.text, 50)}`
  }
}

/** Edits still in force, oldest first. */
export function activeEdits(records: readonly StartEditRecord[]): StartEdit[] {
  return records.filter((record) => record.undoneAt === null).map((record) => record.edit)
}

function same(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

export function applyRivalEdits(
  rivals: readonly StartRival[],
  edits: readonly StartEdit[]
): StartRival[] {
  let out = [...rivals]
  for (const edit of edits) {
    if (edit.kind !== 'rival') continue
    if (edit.op === 'add') {
      if (out.some((rival) => same(rival.name, edit.name))) continue
      out = [
        ...out,
        { name: edit.name.trim(), domain: null, kind: edit.rivalKind, reason: 'Added by you' }
      ]
    } else if (edit.op === 'remove') {
      out = out.filter((rival) => !same(rival.name, edit.name))
    } else if (edit.op === 'rename') {
      out = out.map((rival) =>
        same(rival.name, edit.name) ? { ...rival, name: edit.to.trim() } : rival
      )
    } else {
      out = out.map((rival) =>
        same(rival.name, edit.name) ? { ...rival, kind: edit.rivalKind } : rival
      )
    }
  }
  return out
}

function editList(
  list: readonly string[],
  kind: 'segment' | 'trigger',
  edits: readonly StartEdit[]
): string[] {
  let out = [...list]
  for (const edit of edits) {
    if (edit.kind !== kind) continue
    if (edit.op === 'add') {
      if (!out.some((item) => same(item, edit.text))) out = [...out, edit.text.trim()]
    } else if (edit.op === 'remove') {
      out = out.filter((item) => !same(item, edit.text))
    } else {
      out = out.map((item) => (same(item, edit.text) ? edit.to.trim() : item))
    }
  }
  return out
}

export function applyBuyerEdits(buyers: StartBuyers, edits: readonly StartEdit[]): StartBuyers {
  let who = buyers.who
  for (const edit of edits) if (edit.kind === 'who') who = edit.text.trim() || null
  return {
    who,
    segments: editList(buyers.segments, 'segment', edits),
    triggers: editList(buyers.triggers, 'trigger', edits)
  }
}

function urlKey(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/[?#].*$/u, '')
    .replace(/\/$/u, '')
}

/** Removed pages drop out; added pages (resolved by main) join at the end. */
export function applyPageEdits(
  pages: readonly SiteStartPage[],
  edits: readonly StartEdit[],
  added: readonly SiteStartPage[]
): SiteStartPage[] {
  let out = [...pages]
  for (const edit of edits) {
    if (edit.kind !== 'page') continue
    if (edit.op === 'remove') {
      out = out.filter((page) => urlKey(page.url) !== urlKey(edit.url))
    } else {
      const page = added.find((entry) => urlKey(entry.url) === urlKey(edit.url))
      if (page !== undefined && !out.some((entry) => urlKey(entry.url) === urlKey(page.url))) {
        out = [...out, page]
      }
    }
  }
  return out
}

/** Added questions get the id `edit:<n>` from their position among the edits. */
export function applyQuestionEdits(
  questions: readonly StartQuestion[],
  records: readonly StartEditRecord[]
): StartQuestion[] {
  let out = [...questions]
  for (const record of records) {
    if (record.undoneAt !== null) continue
    const edit = record.edit
    if (edit.kind !== 'question') continue
    if (edit.op === 'add') {
      out = [
        ...out,
        { id: `added:${record.id}`, text: edit.text.trim(), stage: null, targetUrl: null }
      ]
    } else if (edit.op === 'remove') {
      out = out.filter((question) => question.id !== edit.id)
    } else {
      out = out.map((question) =>
        question.id === edit.id ? { ...question, text: edit.text.trim() } : question
      )
    }
  }
  return out
}

/** The live snapshot's "What we know" with every active edit applied. */
export function applyKnownEdits(
  known: StartKnown,
  records: readonly StartEditRecord[],
  added: readonly SiteStartPage[]
): StartKnown {
  const edits = activeEdits(records)
  const removed = new Set(
    edits.flatMap((edit) =>
      edit.kind === 'page' && edit.op === 'remove' ? [urlKey(edit.url)] : []
    )
  )
  const extra = added
    .filter((page) =>
      edits.some(
        (edit) => edit.kind === 'page' && edit.op === 'add' && urlKey(edit.url) === urlKey(page.url)
      )
    )
    .map((page) => ({ url: page.url, path: page.path }))
  const pickedPages = [
    ...known.pickedPages.filter((page) => !removed.has(urlKey(page.url))),
    ...extra.filter(
      (page) =>
        !removed.has(urlKey(page.url)) &&
        !known.pickedPages.some((entry) => urlKey(entry.url) === urlKey(page.url))
    )
  ]
  return {
    ...known,
    rivals: applyRivalEdits(known.rivals, edits),
    buyers: known.buyers === null ? null : applyBuyerEdits(known.buyers, edits),
    pickedPages,
    picked: known.picked === null && pickedPages.length === 0 ? null : pickedPages.length,
    questions: applyQuestionEdits(known.questions, records)
  }
}

/** The saved plan with every active edit applied. */
export function applyPlanEdits(
  plan: SiteStartPlan,
  records: readonly StartEditRecord[],
  added: readonly SiteStartPage[]
): SiteStartPlan {
  const edits = activeEdits(records)
  const pages = applyPageEdits(plan.pages, edits, added)
  const urls = new Set(pages.map((page) => urlKey(page.url)))
  const questions = applyQuestionEdits(plan.questions, records)
  return {
    ...plan,
    pages,
    recommendedUrls: plan.recommendedUrls.filter((url) => urls.has(urlKey(url))),
    rivals: applyRivalEdits(plan.rivals, edits),
    buyers: applyBuyerEdits(plan.buyers, edits),
    questions,
    topic: plan.topic === null ? null : { ...plan.topic, questionCount: questions.length }
  }
}
