// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState, type JSX } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HelpFillBot, HelpFillWay } from '@shared/helpfill'
import type { HelpFillResult } from '@shared/ipc'
import { axeViolations } from '../axe.test-helper'
import { HelpFill } from './HelpFill'
import type { HelpFillProps, HelpFillSource } from './types'
import { useHelpFillUrl } from './url'

const PROMPT =
  'You help a company find the questions its buyers type into Google.\nquestion,stage,page'

function result(texts: readonly string[]): HelpFillResult {
  return {
    kind: 'questions',
    rows: texts.map((text, index) => ({
      id: `r${index}`,
      section: null,
      values: { question: text }
    })),
    setAside: [],
    counts: { read: texts.length + 2, tracked: 2, repeats: 0, setAside: 0, ready: texts.length },
    noun: ['question', 'questions'],
    brand: 'TextBolt',
    warnings: []
  }
}

function fakeSource(available = true): HelpFillSource & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    'helpfill:estimate': async ({ kind }) => {
      calls.push('estimate')
      return {
        kind,
        available,
        calls: 1,
        costText: available ? '1 AI call · about $0.01' : '1 AI call',
        reason: available ? null : 'Needs CiteFox AI connected.'
      }
    },
    'helpfill:prompt': async ({ kind }) => {
      calls.push('prompt')
      return { kind, prompt: PROMPT, columns: ['question', 'stage', 'page'], tracked: 3 }
    },
    'helpfill:read': async ({ text }) => {
      calls.push(`read:${text}`)
      return result(['How do I text my on-call tech?'])
    },
    'helpfill:describe': async ({ sentence, count }) => {
      calls.push(`describe:${sentence}:${count}`)
      return result(['First drafted question?', 'Second drafted question?'])
    }
  }
}

/** The helper with its way and bot in local state, as a place would keep them on the URL. */
function Harness(
  props: Partial<HelpFillProps> & { source: HelpFillSource; startWay?: HelpFillWay | null }
): JSX.Element {
  const [way, setWay] = useState<HelpFillWay | null>(props.startWay ?? null)
  const [bot, setBot] = useState<HelpFillBot | null>(props.bot ?? null)
  return (
    <HelpFill
      kind="questions"
      projectId="proj-1"
      scope={{ pageId: 'page-1' }}
      way={way}
      onWay={setWay}
      bot={bot}
      onBot={setBot}
      describe={{
        label: "Who is searching, and what's their problem?",
        counts: [5, 10],
        defaultCount: 10,
        buttonLabel: (count) => `Write ${count} questions`
      }}
      onRows={() => undefined}
      {...props}
    />
  )
}

const writeText = vi.fn(async () => undefined)

beforeEach(() => {
  writeText.mockClear()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  window.localStorage.clear()
})

afterEach(cleanup)

describe('HelpFill', () => {
  it('opens on Describe when CiteFox AI is set up, shows the cost first and hands back rows', async () => {
    const source = fakeSource()
    const onRows = vi.fn()
    const view = render(<Harness source={source} onRows={onRows} />)
    expect(await screen.findByText('1 AI call · about $0.01')).toBeTruthy()
    expect((screen.getByRole('radio', { name: /Describe it/u }) as HTMLInputElement).checked).toBe(
      true
    )
    fireEvent.change(screen.getByLabelText("Who is searching, and what's their problem?"), {
      target: { value: 'IT teams' }
    })
    fireEvent.change(screen.getByLabelText('How many questions'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Write 5 questions' }))
    await waitFor(() => expect(onRows).toHaveBeenCalledTimes(1))
    expect(onRows.mock.calls[0]?.[1]).toBe('describe')
    expect(source.calls).toContain('describe:IT teams:5')
    expect(screen.getByTestId('hf-summary').textContent).toBe(
      'Read 4 rows. 2 were close to questions you track and were merged. 2 are ready.'
    )
    // The prompt is only written once the chatbot way opens.
    expect(source.calls).not.toContain('prompt')
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('with no CiteFox AI key the Describe card points to the free way, which opens', async () => {
    render(<Harness source={fakeSource(false)} />)
    expect(await screen.findByTestId('hf-chatbot')).toBeTruthy()
    const describe = screen.getByRole('radio', { name: /Describe it/u }) as HTMLInputElement
    expect(describe.disabled).toBe(true)
    expect(
      screen.getByText('Needs CiteFox AI connected. Use your own ChatGPT instead (free).')
    ).toBeTruthy()
  })

  it('a link that names Describe without a key moves to the chatbot way', async () => {
    const onWay = vi.fn()
    render(<Harness source={fakeSource(false)} way="describe" onWay={onWay} />)
    await waitFor(() => expect(onWay).toHaveBeenCalledWith('chatbot'))
  })

  it('Copy turns into a green tick for about 1.5 s', async () => {
    render(<Harness source={fakeSource()} startWay="chatbot" />)
    await waitFor(() =>
      expect(screen.getByTestId('hf-prompt').textContent).toContain('question,stage')
    )
    const copy = screen.getByTestId('hf-copy-prompt')
    fireEvent.click(copy)
    await waitFor(() => expect(copy.getAttribute('aria-label')).toBe('Copied'))
    expect(writeText).toHaveBeenCalledWith(PROMPT)
    expect(copy.className).toContain('hf-copied')
    await waitFor(() => expect(copy.getAttribute('aria-label')).toBe('Copy prompt'), {
      timeout: 3000
    })
    // The Copy in the code box does the same.
    const boxCopy = screen.getByRole('button', { name: 'Copy the prompt' })
    fireEvent.click(boxCopy)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy())
  })

  it('opens a bot with the prompt filled in, or copies it and opens the home page', async () => {
    const opened: string[] = []
    render(
      <Harness source={fakeSource()} startWay="chatbot" openLink={(url) => opened.push(url)} />
    )
    await waitFor(() => expect(screen.getByTestId('hf-prompt').textContent).toContain('question'))
    // ChatGPT by default: the link carries the prompt; nothing is copied.
    fireEvent.click(screen.getByRole('button', { name: 'Open ChatGPT' }))
    expect(opened[0]).toBe(`https://chatgpt.com/?q=${encodeURIComponent(PROMPT)}`)
    expect(screen.getByText('Opened ChatGPT with the prompt filled in.')).toBeTruthy()
    expect(writeText).not.toHaveBeenCalled()
    // Gemini has no prefill link: copy, then open its home page.
    fireEvent.click(screen.getByRole('radio', { name: 'Gemini' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Gemini' }))
    await waitFor(() => expect(opened[1]).toBe('https://gemini.google.com/app'))
    expect(writeText).toHaveBeenCalledWith(PROMPT)
    expect(
      within(screen.getByTestId('hf-chatbot')).getByText('Prompt copied. Paste it into Gemini.')
    ).toBeTruthy()
    // The pick is remembered for next time.
    expect(window.localStorage.getItem('citefox.helpfill.bot')).toBe('gemini')
  })

  it('reads a pasted answer and shows the banner', async () => {
    const source = fakeSource()
    const onRows = vi.fn()
    render(<Harness source={source} startWay="chatbot" onRows={onRows} />)
    const box = await screen.findByLabelText('Paste its answer below')
    const read = screen.getByRole('button', { name: 'Read the answer' }) as HTMLButtonElement
    expect(read.disabled).toBe(true)
    fireEvent.change(box, { target: { value: 'How do I text my on-call tech?' } })
    fireEvent.click(read)
    await waitFor(() => expect(onRows).toHaveBeenCalledTimes(1))
    expect(onRows.mock.calls[0]?.[1]).toBe('chatbot')
    expect(screen.getByTestId('hf-summary').textContent).toContain('1 is ready.')
  })

  it('keeps the way and the bot on the screen URL; picking a way is a history entry', async () => {
    window.location.hash = '#/questions'
    function OnUrl(): JSX.Element {
      const url = useHelpFillUrl()
      return <Harness source={fakeSource()} {...url} />
    }
    render(<OnUrl />)
    await screen.findByText('1 AI call · about $0.01')
    const before = window.history.length
    fireEvent.click(screen.getByRole('radio', { name: /Use your own ChatGPT/u }))
    await waitFor(() => expect(window.location.hash).toBe('#/questions?help=chatbot'))
    expect(window.history.length).toBe(before + 1)
    fireEvent.click(await screen.findByRole('radio', { name: 'Claude' }))
    await waitFor(() => expect(window.location.hash).toBe('#/questions?help=chatbot&bot=claude'))
    expect(window.history.length).toBe(before + 1)
    const bots = screen.getByRole('radiogroup', { name: 'Which chatbot do you use?' })
    expect((within(bots).getByRole('radio', { name: 'Claude' }) as HTMLInputElement).checked).toBe(
      true
    )
  })

  it('a place can rename the two ways', async () => {
    render(
      <Harness
        source={fakeSource()}
        ways={{
          describe: { title: 'Draft it for me', text: 'CiteFox writes it.' },
          chatbot: { title: 'Rewrite with my ChatGPT', text: 'The prompt has the evidence.' }
        }}
      />
    )
    expect(await screen.findByRole('radio', { name: /Draft it for me/u })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Rewrite with my ChatGPT/u })).toBeTruthy()
    expect(screen.queryByRole('radio', { name: /Describe it/u })).toBeNull()
  })

  it('with `only` there are no way cards; a describe-only place without a key says where to add one', async () => {
    render(<Harness source={fakeSource()} only="chatbot" />)
    expect(await screen.findByTestId('hf-chatbot')).toBeTruthy()
    expect(screen.queryByRole('radio', { name: /Describe it/u })).toBeNull()
    cleanup()
    const onWay = vi.fn()
    render(<Harness source={fakeSource(false)} only="describe" way="describe" onWay={onWay} />)
    expect((await screen.findByTestId('hf-no-key')).textContent).toBe(
      'Needs CiteFox AI connected. Add one in Connections to use this.'
    )
    expect(screen.queryByTestId('hf-chatbot')).toBeNull()
    expect(onWay).not.toHaveBeenCalled()
  })

  it('a text kind hands back the answer and counts its words, with the check’s warning', async () => {
    const source = fakeSource()
    source['helpfill:read'] = async () => ({
      ...result([]),
      kind: 'reportSummary',
      text: 'Cited on 12 of 40 questions this week.',
      warnings: ['Took out 1 sentence with a number not in the report: 47.']
    })
    const onRows = vi.fn()
    render(<Harness source={source} only="chatbot" onRows={onRows} />)
    fireEvent.change(await screen.findByLabelText('Paste its answer below'), {
      target: { value: 'Cited on 12 of 40 questions this week. Up 47%.' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Read the answer' }))
    await waitFor(() => expect(onRows).toHaveBeenCalledTimes(1))
    expect(onRows.mock.calls[0]?.[0].text).toBe('Cited on 12 of 40 questions this week.')
    const banner = screen.getByTestId('hf-summary')
    expect(banner.textContent).toBe(
      'Read the answer: 8 words. Took out 1 sentence with a number not in the report: 47.'
    )
    expect(banner.className).toContain('warn')
  })

  it('banner={false} leaves the banner out for a place that says it in its own words', async () => {
    const onRows = vi.fn()
    render(<Harness source={fakeSource()} banner={false} onRows={onRows} />)
    fireEvent.change(await screen.findByLabelText("Who is searching, and what's their problem?"), {
      target: { value: 'IT teams' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Write 10 questions' }))
    await waitFor(() => expect(onRows).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('hf-summary')).toBeNull()
  })
})
