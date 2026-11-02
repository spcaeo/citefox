// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axeViolations } from '../../ui/axe.test-helper'
import { recordingClient, resetMockStore } from '../wizard/harness.test-helper'
import { NewTopicDialog } from '.'
import { fakeClusters, fakeHelpFill, PROJECT_ID, SITE } from './fakes.test-helper'
import { parseNewTopicUrl } from './utils/url'

function open(
  hash: string,
  options: { claude?: boolean } = {}
): {
  onClose: ReturnType<typeof vi.fn>
  wizard: ReturnType<typeof recordingClient>
  clusters: ReturnType<typeof fakeClusters>
  help: ReturnType<typeof fakeHelpFill>
} {
  window.location.hash = hash
  const wizard = recordingClient()
  const clusters = fakeClusters()
  const help = fakeHelpFill(options.claude ?? true)
  const onClose = vi.fn()
  render(
    <NewTopicDialog
      projectId={PROJECT_ID}
      onClose={onClose}
      client={wizard.client}
      source={clusters.source}
      helpSource={help.source}
    />
  )
  return { onClose, wizard, clusters, help }
}

function url(): ReturnType<typeof parseNewTopicUrl> {
  return parseNewTopicUrl(window.location.hash)
}

async function writePreview(): Promise<void> {
  fireEvent.change(screen.getByLabelText('The buyer’s situation'), {
    target: { value: 'An IT team needs a text when a server goes down, without a developer.' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Write questions' }))
  await screen.findByRole('heading', { name: /^Preview · \d+ questions across the buyer journey$/ })
}

beforeEach(() => {
  resetMockStore()
})

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

describe('New topic dialog', () => {
  it('writes a preview across the journey and finds tracked questions that fit', async () => {
    const { wizard, clusters } = open('#/topics?dialog=new-topic')

    expect(screen.getByRole('dialog', { name: 'New topic' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /A buyer problem/ })).toHaveProperty('checked', true)
    expect(screen.getByRole('radio', { name: /A competitor’s page/ })).toBeTruthy()
    expect(await screen.findByText(/^CiteFox AI · about \d+ s$/)).toBeTruthy()
    expect(
      screen.getByText(
        'Next you edit the questions and choose which page should be cited for each. Nothing is searched until you say so.'
      )
    ).toBeTruthy()

    await writePreview()

    expect(screen.getByText('Written from your buyer profile, no searches used')).toBeTruthy()
    const preview = screen.getByRole('region', { name: 'Preview' })
    // One line per stage that has questions (the TextBolt mock writes Problem and Options).
    expect(
      within(preview)
        .getAllByRole('listitem')
        .map((item) => item.querySelector('.nt-stage')?.textContent)
    ).toEqual(['Problem', 'Options'])
    expect(wizard.count('topics:generateQuestions')).toBe(1)
    const update = wizard.calls.find((call) => call.channel === 'topics:updateDraft')
    expect(update?.request).toMatchObject({
      patch: {
        questionDepth: {
          preset: 'custom',
          perStage: { problem: 2, options: 2, doubts: 2, fit: 1, compare: 2, decide: 1 }
        }
      }
    })

    expect(
      await screen.findByLabelText('Also move in 1 question you already track that fit this topic')
    ).toBeTruthy()
    const sort = clusters.calls['topics:sortQuestions']?.[0] as {
      items: { promptId: string }[]
      candidates: { id: string }[]
      allowNew: boolean
    }
    expect(sort.allowNew).toBe(false)
    expect(sort.candidates.map((candidate) => candidate.id)).toEqual(['new'])
    // Only questions not in a topic are offered.
    expect(sort.items.map((item) => item.promptId)).toEqual(['q1', 'q2', 'q3'])

    expect(url().draftId).not.toBeNull()
    expect(url().way).toBe('problem')
  })

  it('keeps the draft and step in the URL, so a copied link reopens Review questions', async () => {
    open('#/topics?dialog=new-topic')
    await writePreview()
    const draftId = url().draftId
    expect(screen.getByRole('link', { name: 'Open the full wizard' }).getAttribute('href')).toBe(
      `#/add/${draftId}`
    )

    fireEvent.click(screen.getByRole('button', { name: 'Review questions' }))
    await screen.findByRole('list', { name: 'Questions' })
    expect(url()).toMatchObject({ draftId, step: 'questions' })
    expect(window.location.hash).toContain('dialog=new-topic')

    const copied = window.location.hash
    cleanup()
    open(copied)
    const list = await screen.findByRole('list', { name: 'Questions' })
    expect(within(list).getAllByRole('listitem').length).toBeGreaterThan(5)
    expect(screen.getByRole('button', { name: /Target pages/ })).toBeTruthy()

    // A done step on the stepper goes back to it.
    fireEvent.click(screen.getByRole('button', { name: /Start/ }))
    await screen.findByLabelText('The buyer’s situation')
    expect(url()).toMatchObject({ draftId, step: 'start' })
  })

  it('edits, restages, adds and removes questions on Review', async () => {
    const { wizard } = open('#/topics?dialog=new-topic')
    await writePreview()
    fireEvent.click(screen.getByRole('button', { name: 'Review questions' }))
    const list = await screen.findByRole('list', { name: 'Questions' })
    const before = within(list).getAllByRole('listitem').length

    const first = screen.getByLabelText('Question 1')
    fireEvent.change(first, { target: { value: 'How do we text the on-call engineer?' } })
    fireEvent.blur(first)
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>('Question 1').value).toBe(
        'How do we text the on-call engineer?'
      )
    )

    fireEvent.change(screen.getByLabelText('Stage of question 2'), { target: { value: 'decide' } })
    fireEvent.click(screen.getByLabelText('Include question 3'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove question 4' }))
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(before - 1))

    fireEvent.change(screen.getByLabelText('Add a question'), {
      target: { value: 'Is there a free plan for alerts?' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(before))

    const patches = wizard.calls
      .filter((call) => call.channel === 'topics:updateDraft')
      .map((call) => (call.request as { patch: Record<string, unknown> }).patch)
    expect(patches.some((patch) => 'removePromptIds' in patch)).toBe(true)
    expect(
      patches.some((patch) =>
        JSON.stringify(patch.upsertPrompts ?? []).includes('"included":false')
      )
    ).toBe(true)
    expect(
      patches.some((patch) =>
        JSON.stringify(patch.upsertPrompts ?? []).includes('"stage":"decide"')
      )
    ).toBe(true)
  })

  it('creates the topic from the draft with the tracked questions moved in, then closes', async () => {
    const changed = vi.fn()
    window.addEventListener('citefox:topics-changed', changed)
    const { wizard, clusters, onClose } = open('#/overview?dialog=new-topic')
    await writePreview()
    const draftId = url().draftId

    fireEvent.click(
      await screen.findByLabelText('Also move in 1 question you already track that fit this topic')
    )
    fireEvent.click(screen.getByRole('button', { name: 'Review questions' }))
    fireEvent.click(await screen.findByRole('button', { name: /Target pages/ }))

    await screen.findByRole('list', { name: 'Target pages' })
    await waitFor(() => expect(wizard.count('topics:matchPages')).toBe(1))
    expect(url().step).toBe('pages')
    fireEvent.change(screen.getByLabelText('Target page for question 1'), {
      target: { value: `${SITE}/pricing/` }
    })
    await waitFor(() => expect(wizard.count('topics:setTarget')).toBe(1))
    expect(wizard.calls.find((call) => call.channel === 'topics:setTarget')?.request).toMatchObject(
      {
        draftId,
        target: { pageId: 'page-pricing', url: `${SITE}/pricing/` }
      }
    )

    fireEvent.click(screen.getByRole('button', { name: 'Create topic' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(clusters.calls['topics:createFromDraft']).toEqual([
      { projectId: PROJECT_ID, draftId, moveIn: [{ sourceId: 'page-alerts', promptId: 'q1' }] }
    ])
    expect(changed).toHaveBeenCalled()
    expect(window.location.hash).toBe('#/topics?row=topic-new')
    window.removeEventListener('citefox:topics-changed', changed)
  })

  it('makes a topic from questions ticked on Questions: suggests a name, moves them, sets pages', async () => {
    const { clusters, onClose } = open('#/questions?dialog=new-topic&questions=q1,q2')

    const name = await screen.findByLabelText<HTMLInputElement>('Topic name')
    await waitFor(() => expect(name.value).toBe('Server alert texts'))
    expect(screen.getByText('Name suggested from the questions')).toBeTruthy()
    expect(screen.getByRole('radio', { name: /My own questions/ })).toHaveProperty('checked', true)
    expect(screen.getByRole('checkbox', { name: /server goes down/ })).toHaveProperty(
      'checked',
      true
    )
    expect(clusters.calls['topics:suggestName']).toEqual([
      {
        projectId: PROJECT_ID,
        items: [
          { sourceId: 'page-alerts', promptId: 'q1' },
          { sourceId: 'page-alerts', promptId: 'q2' }
        ]
      }
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Create topic' }))
    await screen.findByText(/^Topic created\./)
    expect(clusters.calls['topics:moveQuestions']).toEqual([
      {
        projectId: PROJECT_ID,
        items: [
          { sourceId: 'page-alerts', promptId: 'q1' },
          { sourceId: 'page-alerts', promptId: 'q2' }
        ],
        to: { kind: 'new', name: 'Server alert texts' }
      }
    ])
    expect(url()).toMatchObject({ topicId: 'topic-new', step: 'pages' })

    fireEvent.change(await screen.findByLabelText('Target page for question 1'), {
      target: { value: `${SITE}/pricing/` }
    })
    await waitFor(() => expect(clusters.calls['topics:setTarget']).toHaveLength(1))
    expect(clusters.calls['topics:setTarget']?.[0]).toEqual({
      projectId: PROJECT_ID,
      topicId: 'topic-new',
      promptIds: ['q1-moved'],
      target: { pageId: 'page-pricing', url: `${SITE}/pricing/` }
    })

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalled()
    expect(window.location.hash).toBe('#/topics?row=topic-new')
  })

  it('shows a plain "not available" for a draft it cannot open', async () => {
    open('#/topics?dialog=new-topic&draft=draft-missing&step=questions')
    expect(await screen.findByText('This draft is not available to you.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }))
    await screen.findByLabelText('The buyer’s situation')
    expect(url().draftId).toBeNull()
  })

  it('Cancel clears its URL values and closes', async () => {
    const { onClose } = open('#/topics?dialog=new-topic&way=competitor')
    expect(await screen.findByLabelText('Their page’s address')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(window.location.hash).toBe('#/topics?dialog=new-topic')
  })

  it('has no axe violations on Start and Review', async () => {
    open('#/topics?dialog=new-topic')
    await writePreview()
    await screen.findByLabelText('Also move in 1 question you already track that fit this topic')
    const dialog = screen.getByRole('dialog', { name: 'New topic' })
    expect(await axeViolations(dialog)).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Review questions' }))
    await screen.findByRole('list', { name: 'Questions' })
    expect(await axeViolations(dialog)).toEqual([])
  })

  describe('A buyer problem with ✦ Help me fill', () => {
    it('keeps the box as Describe it, and the chatbot way carries the typed problem', async () => {
      const { help } = open('#/topics?drawer=new-topic')
      const describe = screen.getByRole('radio', { name: /Describe it/ })
      await waitFor(() => expect(help.calls.estimate).toBe(1))
      expect(describe).toHaveProperty('checked', true)
      expect(screen.getByLabelText('The buyer’s situation')).toBeTruthy()

      fireEvent.change(screen.getByLabelText('The buyer’s situation'), {
        target: { value: 'Clinics whose carrier email-to-text gateway shut down' }
      })
      fireEvent.click(screen.getByRole('radio', { name: /Use your own ChatGPT/ }))
      expect(url().help).toBe('chatbot')
      expect(screen.getByLabelText('The buyer’s situation (optional)')).toBeTruthy()
      const prompt = await screen.findByText(/You help a company plan one topic/)
      expect(prompt.textContent).toContain(
        'Buyer problem: Clinics whose carrier email-to-text gateway shut down\nAlready tracked'
      )
      expect(help.calls.prompt).toEqual([
        { kind: 'topic', projectId: PROJECT_ID, scope: { pageId: null }, count: null }
      ])
      // Footer: Write questions would use Claude; here the primary waits for the answer.
      expect(screen.getByRole('button', { name: 'Review questions' })).toHaveProperty(
        'disabled',
        true
      )

      fireEvent.click(screen.getByRole('radio', { name: 'Perplexity' }))
      expect(url().bot).toBe('perplexity')
      expect(screen.getByRole('button', { name: 'Open Perplexity' })).toBeTruthy()
    })

    it('reads a pasted answer into the draft: name, questions with stage, target pages', async () => {
      const { wizard, help } = open('#/topics?drawer=new-topic&nt.help=chatbot')
      await screen.findByText(/You help a company plan one topic/)
      fireEvent.change(screen.getByLabelText('Paste its answer below'), {
        target: { value: 'question,stage,page,topic\n…' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Read the answer' }))

      expect(await screen.findByTestId('nt-help-summary')).toBeTruthy()
      expect(screen.getByTestId('nt-help-summary').textContent).toContain(
        'Read 4 rows. 1 was close to questions you track and was merged. 3 are ready.'
      )
      await screen.findByText('From your chatbot’s answer, no searches used')
      expect(help.calls.read).toHaveLength(1)

      const created = wizard.calls.find((call) => call.channel === 'topics:createDraft')
      expect(created?.request).toMatchObject({
        path: 'seed',
        seed: 'Carrier gateway shutdown',
        name: 'Carrier gateway shutdown'
      })
      const update = wizard.calls.find((call) => call.channel === 'topics:updateDraft')
      expect(update?.request).toMatchObject({
        patch: {
          name: 'Carrier gateway shutdown',
          upsertPrompts: [
            {
              text: 'Our carrier stopped email to text, what now?',
              stage: 'problem',
              source: 'imported'
            },
            {
              text: 'What replaces a carrier email gateway?',
              stage: 'options',
              source: 'imported'
            },
            { text: 'How much does an SMS gateway cost?', stage: 'compare', source: 'imported' }
          ]
        }
      })
      const targets = wizard.calls
        .filter((call) => call.channel === 'topics:setTarget')
        .map((call) => call.request as { target: unknown; promptIds: string[] })
      expect(targets.map((call) => [call.target, call.promptIds.length])).toEqual([
        [{ pageId: 'page-alerts', url: `${SITE}/use-cases/it-alerts/` }, 2],
        [{ pageId: null, url: `${SITE}/guides/sms-gateway-cost/` }, 1]
      ])

      // Nothing is a topic yet: Review questions, then Target pages and Create topic.
      fireEvent.click(screen.getByRole('button', { name: 'Review questions' }))
      const list = await screen.findByRole('list', { name: 'Questions' })
      expect(within(list).getAllByRole('listitem')).toHaveLength(3)
      expect(screen.getByLabelText<HTMLInputElement>('Topic name').value).toBe(
        'Carrier gateway shutdown'
      )
    })

    it('with no CiteFox AI key opens on the chatbot way, and a Describe link moves to it', async () => {
      open('#/topics?drawer=new-topic&nt.help=describe', { claude: false })
      await waitFor(() => expect(url().help).toBe('chatbot'))
      expect(screen.getByRole('radio', { name: /Describe it/ })).toHaveProperty('disabled', true)
      expect(
        screen.getByText('Needs CiteFox AI connected. Use your own ChatGPT instead (free).')
      ).toBeTruthy()
      expect(await screen.findByText(/You help a company plan one topic/)).toBeTruthy()
    })

    it('has no axe violations on the chatbot way after an answer', async () => {
      open('#/topics?drawer=new-topic&nt.help=chatbot')
      await screen.findByText(/You help a company plan one topic/)
      fireEvent.change(screen.getByLabelText('Paste its answer below'), {
        target: { value: 'question\nx' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Read the answer' }))
      await screen.findByText('From your chatbot’s answer, no searches used')
      expect(await axeViolations(screen.getByRole('dialog', { name: 'New topic' }))).toEqual([])
    })
  })
})
