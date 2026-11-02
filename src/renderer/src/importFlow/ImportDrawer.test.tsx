// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Market } from '@shared/domain'
import type {
  ImportCommitRequest,
  ImportCommitResult,
  ImportPreviewRequest,
  ImportReadRequest,
  ImportResult,
  ImportRow,
  ImportTemplateRequest
} from '@shared/ipc'
import type { ImportEntity } from '@shared/import-fields'
import { handFile } from './handoff'
import { ImportDrawer } from './ImportDrawer'
import type { ImportFilter, ImportStep } from './model'
import type { ImportSource } from './source'

afterEach(() => {
  cleanup()
})

const US: Market = {
  id: 'mkt-us',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}

/** Five rows: two new, a keyword, a duplicate and one naming an unknown market. */
const RESULTS: readonly ImportResult[] = ['new', 'new', 'keyword', 'duplicate', 'fix']

function rows(): ImportRow[] {
  return RESULTS.map((result, index) => ({
    row: index + 2,
    values: {
      question: `question number ${index + 1} about email to sms`,
      market: index === 4 ? 'de' : 'us'
    },
    result,
    reason: result === 'fix' ? 'Market unknown: “de”.' : null,
    fix: result === 'fix' ? 'market' : null,
    match: null,
    kind: 'question'
  }))
}

interface Fake extends ImportSource {
  reads: ImportReadRequest[]
  previews: ImportPreviewRequest[]
  commits: ImportCommitRequest[]
  templates: ImportTemplateRequest[]
}

function fakeSource(options: { cancel?: boolean } = {}): Fake {
  const reads: ImportReadRequest[] = []
  const previews: ImportPreviewRequest[] = []
  const commits: ImportCommitRequest[] = []
  const templates: ImportTemplateRequest[] = []
  return {
    reads,
    previews,
    commits,
    templates,
    'import:pickFile': async () =>
      options.cancel
        ? { cancelled: true }
        : { cancelled: false, token: 'tok-1', name: 'questions.csv', bytes: 2048, kind: 'csv' },
    'import:read': async (request) => {
      reads.push(request)
      return {
        sourceId: 'src-1',
        name: request.source.kind === 'paste' ? 'Pasted rows' : 'questions.csv',
        kind: request.source.kind === 'paste' ? 'paste' : 'csv',
        sheets: [],
        sheet: null,
        rowCount: 5,
        hasHeader: true,
        columns: [
          { index: 0, letter: 'A', header: 'Question', samples: ['question number 1'] },
          { index: 1, letter: 'B', header: 'Country', samples: ['us', 'de'] },
          { index: 2, letter: 'C', header: 'Owner', samples: ['Ann'] }
        ],
        mapping: ['question', 'market', null],
        mappingSaved: false,
        stageWords: {},
        warnings: []
      }
    },
    'import:preview': async (request) => {
      previews.push(request)
      const all = rows()
      const count = (result: ImportResult): number =>
        all.filter((row) => row.result === result).length
      return {
        sourceId: request.sourceId,
        entity: request.entity,
        rows: all,
        counts: {
          new: count('new'),
          keyword: count('keyword'),
          similar: count('similar'),
          duplicate: count('duplicate'),
          fix: count('fix'),
          total: all.length
        },
        stageWords: [],
        unknownMarkets: request.mapping.includes('market') ? ['DE'] : [],
        newPages: []
      }
    },
    'import:validate': async () => {
      throw new Error('not used')
    },
    'import:commit': async (request) => {
      commits.push(request)
      return {
        batchId: 'batch-9',
        added: request.rows.length,
        skipped: [],
        promptIds: [],
        message: `Added ${request.rows.length}.`
      }
    },
    'import:undo': async () => ({ removed: 0, message: '' }),
    'import:template': async (request) => {
      templates.push(request)
      return { saved: true, fileName: 'template.csv' }
    }
  }
}

function Harness({
  source,
  entity = 'questions',
  mode = 'return',
  onReturn = () => undefined,
  onCommitted = () => undefined
}: {
  source: Fake
  entity?: ImportEntity
  mode?: 'return' | 'commit'
  onReturn?: (rows: readonly ImportRow[]) => void
  onCommitted?: (result: ImportCommitResult) => void
}): JSX.Element {
  const [step, setStep] = useState<ImportStep>('choose')
  const [filter, setFilter] = useState<ImportFilter>('all')
  return (
    <ImportDrawer
      projectId="proj-1"
      entity={entity}
      targetId="topic-1"
      step={step}
      filter={filter}
      onStep={setStep}
      onFilter={setFilter}
      onClose={() => undefined}
      mode={mode}
      onReturn={onReturn}
      onCommitted={onCommitted}
      markets={[US]}
      site="https://textbolt.com"
      source={source}
    />
  )
}

function drawer(): HTMLElement {
  return screen.getByTestId('import-drawer')
}

async function toMatch(source: Fake): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Choose a file' }))
  await waitFor(() => expect(source.previews.length).toBeGreaterThan(0))
  await screen.findByRole('button', { name: 'Check 5 rows' })
}

describe('ImportDrawer', () => {
  it('starts on Choose a file with paste and both templates', async () => {
    const source = fakeSource()
    render(<Harness source={source} />)
    expect(screen.getByRole('heading', { name: 'Import questions from a file' })).toBeTruthy()
    expect(screen.getByText('Drop a CSV or Excel file here')).toBeTruthy()
    // One download icon opens the two templates (DESIGN-GUIDELINES: Download ▾ is an icon).
    fireEvent.click(screen.getByRole('button', { name: 'Download a template' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'CSV template' }))
    fireEvent.click(screen.getByRole('button', { name: 'Download a template' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Excel template' }))
    await waitFor(() => expect(source.templates).toHaveLength(2))
    expect(source.templates.map((item) => item.format)).toEqual(['csv', 'xlsx'])
  })

  it('stays on Choose when the open dialog is cancelled', async () => {
    const source = fakeSource({ cancel: true })
    render(<Harness source={source} />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose a file' }))
    await waitFor(() => expect(screen.getByText('Drop a CSV or Excel file here')).toBeTruthy())
    expect(source.reads).toHaveLength(0)
  })

  it('matches columns, then checks every row with chips that add up', async () => {
    const source = fakeSource()
    render(<Harness source={source} />)
    await toMatch(source)
    expect(source.reads[0]?.source).toEqual({ kind: 'file', token: 'tok-1', sheet: null })
    const column = screen.getByLabelText('CiteFox column for Owner') as HTMLSelectElement
    expect(column.value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Check 5 rows' }))
    const chips = await screen.findByRole('group', { name: 'Show rows by result' })
    const counts = within(chips)
      .getAllByRole('button')
      .map((chip) => Number(chip.querySelector('b')?.textContent ?? '0'))
    // All = the sum of the result chips.
    expect(counts[0]).toBe(5)
    expect(counts.slice(1).reduce((sum, value) => sum + value, 0)).toBe(5)
    expect(drawer().textContent).toContain('3 to add · 1 duplicate skipped · 1 needs a fix')
  })

  it('filters by result from the chips', async () => {
    const source = fakeSource()
    render(<Harness source={source} />)
    await toMatch(source)
    fireEvent.click(screen.getByRole('button', { name: 'Check 5 rows' }))
    const chips = await screen.findByRole('group', { name: 'Show rows by result' })
    const duplicate = within(chips).getByRole('button', { name: /Duplicate/u })
    fireEvent.click(duplicate)
    expect(duplicate.getAttribute('aria-pressed')).toBe('true')
    const table = screen.getByTestId('import-rows')
    expect(within(table).getAllByRole('row').length).toBeLessThan(6)
  })

  it('returns the rows to the drawer below, leaving duplicates out', async () => {
    const source = fakeSource()
    const onReturn = vi.fn()
    render(<Harness source={source} onReturn={onReturn} />)
    await toMatch(source)
    fireEvent.click(screen.getByRole('button', { name: 'Check 5 rows' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add 4 rows to the list' }))
    expect(onReturn).toHaveBeenCalledTimes(1)
    const returned = onReturn.mock.calls[0]?.[0] as ImportRow[]
    expect(returned.map((row) => row.result)).toEqual(['new', 'new', 'keyword', 'fix'])
    expect(source.commits).toHaveLength(0)
  })

  it('adds a list such as competitors here as one batch', async () => {
    const source = fakeSource()
    const onCommitted = vi.fn()
    render(<Harness source={source} entity="competitors" mode="commit" onCommitted={onCommitted} />)
    await toMatch(source)
    fireEvent.click(screen.getByRole('button', { name: 'Check 5 rows' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add 3 competitors' }))
    await waitFor(() => expect(onCommitted).toHaveBeenCalledTimes(1))
    expect(source.commits[0]).toMatchObject({ entity: 'competitors', targetId: 'topic-1' })
    expect(source.commits[0]?.rows).toHaveLength(3)
  })

  it('fixes unknown markets in one click by adding them', async () => {
    const source = fakeSource()
    render(<Harness source={source} />)
    await toMatch(source)
    fireEvent.click(await screen.findByRole('button', { name: 'Add it' }))
    await waitFor(() => expect(source.commits[0]?.entity).toBe('markets'))
    expect(source.commits[0]?.targetId).toBe('topic-1')
  })

  it('reads pasted rows', async () => {
    const source = fakeSource()
    render(<Harness source={source} />)
    fireEvent.change(screen.getByLabelText('Or paste rows from a sheet'), {
      target: { value: 'Question\tCountry\nemail to sms for clinics\tus' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Use these rows' }))
    await screen.findByRole('button', { name: 'Check 5 rows' })
    expect(source.reads[0]?.source.kind).toBe('paste')
  })

  it('reads a file dropped on the drawer below as soon as it opens', async () => {
    const source = fakeSource()
    handFile(new File(['Question\nemail to sms'], 'dropped.csv', { type: 'text/csv' }))
    render(<Harness source={source} />)
    await screen.findByRole('button', { name: 'Check 5 rows' })
    expect(source.reads[0]?.source).toMatchObject({ kind: 'dropped', name: 'dropped.csv' })
  })
})
