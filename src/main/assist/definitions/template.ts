import { templateKindInfo } from '@shared/domain'
import type { LlmCallRecord } from '@shared/ipc'
import {
  STORED_GENERATION_KINDS,
  getCachedGeneration,
  listGenerations,
  type GenerationRecord,
  type StoredGenerationKind
} from '../../storage/content-records'
import type { SqliteDatabase } from '../../storage/database'
import { listLlmCalls } from '../../storage/llm-calls'
import { listPages } from '../../storage/pages'
import { AssistInputError, type AssistContext, type AssistDefinition } from '../types'
import { clip, inputText } from './gather'

/** "Improve this template with Claude" (FR-26.7): line additions and removals. */

const LAST_RUNS = 3
const TEMPLATE_BODY_MAX = 40_000
const OUTPUT_MAX = 3000
const KIND = /^[a-z][a-z0-9_]{0,39}$/

/** The `generations` kind a template step records its runs under. */
function storedKindOf(kind: string): StoredGenerationKind | null {
  const stored = kind === 'run_summary' ? 'summary' : kind
  return STORED_GENERATION_KINDS.find((item) => item === stored) ?? null
}

function templateKind(context: AssistContext): string {
  const kind = inputText(context, 'kind', 40)
  if (kind === null || !KIND.test(kind)) {
    throw new AssistInputError('Pick a template step first.', 'Open Templates and pick a step.')
  }
  return kind
}

function templateBody(context: AssistContext): string {
  const body = inputText(context, 'body', TEMPLATE_BODY_MAX)
  if (body === null) {
    throw new AssistInputError('The template is empty.', 'Write the template, then try again.')
  }
  return body
}

/** The newest runs of this step across the project's pages, outputs included. */
function lastGenerations(db: SqliteDatabase, projectId: string, kind: string): string[] {
  const stored = storedKindOf(kind)
  if (stored === null) return []
  const runs: GenerationRecord[] = []
  for (const page of listPages(db, projectId)) {
    runs.push(...listGenerations(db, page.id).filter((run) => run.kind === stored))
  }
  return runs
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .slice(0, LAST_RUNS)
    .map((run) => {
      const head = `Run ${run.startedAt} on page ${run.pageId} (${run.model ?? 'model not recorded'})`
      if (!run.ok) return `${head}: failed: ${clip(run.error ?? 'no error saved', 500)}`
      const output = getCachedGeneration(db, stored, run.inputHash)?.output
      return `${head}: output:\n${output === undefined ? 'not saved' : clip(JSON.stringify(output, null, 1), OUTPUT_MAX)}`
    })
}

function lastCalls(
  databases: readonly { db: SqliteDatabase; app: boolean }[],
  kind: string
): string[] {
  const rows: LlmCallRecord[] = []
  for (const { db, app } of databases) {
    rows.push(
      ...listLlmCalls(db, { since: null, limit: 500, projectId: null, appTable: app }).filter(
        (row) => row.templateKind === kind
      )
    )
  }
  return rows
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .slice(0, LAST_RUNS)
    .map(
      (row) =>
        `Call ${row.startedAt} (${row.source}, ${row.connection}): ${row.ok ? `ok in ${row.durationMs} ms` : `failed: ${clip(row.error ?? 'no error saved', 300)}`}`
    )
}

export const TEMPLATE_ASSISTS: readonly AssistDefinition[] = [
  {
    id: 'template.improve',
    title: 'Improve this template',
    expectedSeconds: 12,
    acceptsInstruction: true,
    needsProject: false,
    signedItems: true,
    minItems: 1,
    maxItems: 12,
    task: `Propose line changes to the template under "Template". When the user asked for a change, make that change. Otherwise improve it from the last runs below: fix what made a run fail or give weak output.
One item per line: sign "add" with text the exact new line, or sign "remove" with text copied exactly from a line of the template. detail says why, and for an added line where it goes ("after the line that starts …").
Keep {{ name }} variables exactly as written, and add only variables the template already uses. Never change what the step returns ("What the step must return"). Never add {% %} tags or code.`,
    gather(context) {
      const kind = templateKind(context)
      const info = templateKindInfo(kind)
      const body = templateBody(context)
      const runs: string[] = []
      const calls: string[] = []
      if (context.db !== null && context.project !== null) {
        runs.push(...lastGenerations(context.db, context.project.id, kind))
        calls.push(
          ...lastCalls(
            [
              { db: context.db, app: false },
              { db: context.host.storage.db, app: true }
            ],
            kind
          )
        )
      } else {
        calls.push(...lastCalls([{ db: context.host.storage.db, app: true }], kind))
      }
      const instruction = context.request.instruction?.trim() ?? ''
      if (instruction.length === 0 && runs.length === 0 && calls.length === 0) {
        throw new AssistInputError(
          'This template has not run yet.',
          'Run it once, or tell CiteFox AI what to change.'
        )
      }
      return [
        `Template step: ${kind} (${info.label})`,
        `What the step must return: ${info.schemaLabel}. A change must keep the reply in this shape.`,
        '',
        'Template:',
        body,
        '',
        `Last ${LAST_RUNS} runs:`,
        runs.join('\n\n') || 'none saved in this project',
        '',
        'Last AI calls for this step:',
        calls.join('\n') || 'none'
      ].join('\n')
    },
    check(reply, context) {
      const body =
        typeof context.request.inputs.body === 'string' ? context.request.inputs.body : ''
      const lines = new Set(body.split('\n').map((line) => line.trim()))
      return reply.items.every((item) => item.sign !== 'remove' || lines.has(item.text.trim()))
        ? null
        : 'Copy every removed line exactly from the template.'
    }
  }
]
