// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState, type JSX } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { HelpFillWay } from '@shared/helpfill'
import type {
  HelpFillReadRequest,
  HelpFillResult,
  ImportCommitRequest,
  ImportReadRequest,
  ImportRow
} from '@shared/ipc'
import type { HelpFillBot, HelpFillSource } from '../ui'
import { rowsAsPaste } from './help'
import { ImportDrawer } from './ImportDrawer'
import type { ImportFilter, ImportStep } from './model'
import type { ImportSource } from './source'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

const ROWS = [
  { name: 'Textmagic', domain: 'textmagic.com', competes_with: 'Email to SMS' },
  { name: 'ClickSend', domain: 'clicksend.com', competes_with: '' }
]

function answer(): HelpFillResult {
  return {
    kind: 'competitors',
    rows: ROWS.map((values, index) => ({ id: `row-${index + 1}`, section: null, values })),
    setAside: [],
    counts: { read: 3, tracked: 1, repeats: 0, setAside: 0, ready: 2 },
    noun: ['competitor', 'competitors'],
    brand: 'TextBolt',
    warnings: []
  }
}

interface Fakes {
  importSource: ImportSource
  helpSource: HelpFillSource
  reads: ImportReadRequest[]
  helpReads: HelpFillReadRequest[]
  commits: ImportCommitRequest[]
}

function fakes(): Fakes {
  const reads: ImportReadRequest[] = []
  const helpReads: HelpFillReadRequest[] = []
  const commits: ImportCommitRequest[] = []
  const previewRows: ImportRow[] = ROWS.map((values, index) => ({
    row: index + 2,
    values,
    result: 'new',
    reason: null,
    fix: null,
    match: null,
    kind: null
  }))
  const importSource: ImportSource = {
    'import:pickFile': async () => ({ cancelled: true }),
    'import:read': async (request) => {
      reads.push(request)
      return {
        sourceId: 'src-1',
        name: 'Pasted rows',
        kind: 'paste',
        sheets: [],
        sheet: null,
        rowCount: 2,
        hasHeader: true,
        columns: [
          { index: 0, letter: 'A', header: 'name', samples: ['Textmagic'] },
          { index: 1, letter: 'B', header: 'domain', samples: ['textmagic.com'] },
          { index: 2, letter: 'C', header: 'competes_with', samples: ['Email to SMS'] }
        ],
        mapping: ['name', 'domain', 'competes_with'],
        mappingSaved: false,
        stageWords: {},
        warnings: []
      }
    },
    'import:preview': async (request) => ({
      sourceId: request.sourceId,
      entity: request.entity,
      rows: previewRows,
      counts: { new: 2, keyword: 0, similar: 0, duplicate: 0, fix: 0, total: 2 },
      stageWords: [],
      unknownMarkets: [],
      newPages: []
    }),
    'import:validate': async () => {
      throw new Error('not used')
    },
    'import:commit': async (request) => {
      commits.push(request)
      return { batchId: 'b1', added: 2, skipped: [], promptIds: [], message: 'Added 2.' }
    },
    'import:undo': async () => ({ removed: 0, message: '' }),
    'import:template': async () => ({ saved: true, fileName: 'competitors.csv' })
  }
  const helpSource: HelpFillSource = {
    // No Claude key: the helper opens on the chatbot way.
    'helpfill:estimate': async ({ kind }) => ({
      kind,
      available: false,
      calls: 1,
      costText: '1 AI call',
      reason: 'Needs CiteFox AI connected.'
    }),
    'helpfill:prompt': async ({ kind }) => ({
      kind,
      prompt:
        'You help a company list the competitors it loses deals to.\nname,domain,competes_with',
      columns: ['name', 'domain', 'competes_with'],
      tracked: 1
    }),
    'helpfill:read': async (request) => {
      helpReads.push(request)
      return answer()
    },
    'helpfill:describe': async () => answer()
  }
  return { importSource, helpSource, reads, helpReads, commits }
}

function Harness({ fake }: { fake: Fakes }): JSX.Element {
  const [step, setStep] = useState<ImportStep>('choose')
  const [filter, setFilter] = useState<ImportFilter>('all')
  const [open, setOpen] = useState(false)
  const [way, setWay] = useState<HelpFillWay | null>(null)
  const [bot, setBot] = useState<HelpFillBot | null>(null)
  return (
    <ImportDrawer
      projectId="proj-1"
      entity="competitors"
      targetId={null}
      step={step}
      filter={filter}
      onStep={setStep}
      onFilter={setFilter}
      onClose={() => undefined}
      mode="commit"
      help={{ open, way, bot, onOpen: setOpen, onWay: setWay, onBot: setBot }}
      openLink={() => undefined}
      source={fake.importSource}
      helpSource={fake.helpSource}
    />
  )
}

describe('Import competitors › ✦ Help me find them', () => {
  it('reads a pasted answer into the preview as a sheet paste; nothing is added before the click', async () => {
    const fake = fakes()
    render(<Harness fake={fake} />)
    const drawer = screen.getByTestId('import-drawer')
    fireEvent.click(within(drawer).getByRole('button', { name: 'Help me find them' }))
    const helper = await screen.findByTestId('import-help')
    // No Claude key: the free way, with the Perplexity tip.
    await within(helper).findByTestId('hf-chatbot')
    expect(
      within(helper).getByText('Perplexity is best for competitors: it searches the web.')
    ).toBeTruthy()
    fireEvent.change(within(helper).getByLabelText('Paste its answer below'), {
      target: { value: 'name,domain\nTextmagic,textmagic.com' }
    })
    fireEvent.click(within(helper).getByRole('button', { name: 'Read the answer' }))
    await waitFor(() => expect(fake.reads).toHaveLength(1))
    expect(fake.helpReads[0]).toMatchObject({ kind: 'competitors', scope: { pageId: null } })
    expect(fake.reads[0]?.source).toEqual({
      kind: 'paste',
      text: rowsAsPaste(['name', 'domain', 'competes_with'], answer().rows)
    })
    // Straight to the check, with the banner over the rows.
    const banner = await screen.findByTestId('import-hf-summary')
    expect(banner.textContent).toBe(
      'Read 3 rows. 1 was close to competitors you track and was merged. 2 are ready.'
    )
    expect(fake.commits).toHaveLength(0)
    const finish = await screen.findByTestId('import-finish')
    await waitFor(() => expect((finish as HTMLButtonElement).disabled).toBe(false))
    expect(finish.textContent).toBe('Add 2 competitors')
    fireEvent.click(finish)
    await waitFor(() => expect(fake.commits).toHaveLength(1))
    expect(fake.commits[0]?.rows.map((row) => row.values.name)).toEqual(['Textmagic', 'ClickSend'])
  })

  it('"Import a file instead" goes back to Choose', async () => {
    const fake = fakes()
    render(<Harness fake={fake} />)
    fireEvent.click(screen.getByRole('button', { name: 'Help me find them' }))
    await screen.findByTestId('import-help')
    fireEvent.click(screen.getByRole('button', { name: 'Import a file instead' }))
    expect(screen.getByText('Drop a CSV or Excel file here')).toBeTruthy()
  })

  it('a tab or line break inside a value does not split the paste', () => {
    expect(
      rowsAsPaste(
        ['name', 'domain'],
        [{ id: 'r1', section: null, values: { name: 'A\tB\nC', domain: 'a.com' } }]
      )
    ).toBe('name\tdomain\nA B C\ta.com')
  })
})
