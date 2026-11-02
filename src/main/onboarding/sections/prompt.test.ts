import { describe, expect, test } from 'vitest'
import type { SetupSectionId } from '@shared/ipc'
import {
  editedTask,
  fullPrompt,
  LIST_REPLY_EMPTY,
  LIST_REPLY_LEAD,
  promptResult,
  runPrompt,
  sectionTask,
  TEXT_REPLY_LEAD
} from './prompt'
import { SETUP_SECTION_IDS, sectionDef } from './registry'
import { bareContext, row, textboltContext } from './test-context.test-helper'

const more = (section: SetupSectionId, current = [row('Already here')]): string =>
  sectionTask(sectionDef(section), {
    context: textboltContext(),
    mode: 'more',
    instruction: null,
    current
  })

/** The context line each section must carry with the TextBolt context. */
const EXPECTED_LINES: Record<SetupSectionId, readonly string[]> = {
  summary: [
    'Website: textbolt.com',
    'Market tracked (where AI answers are checked, not always where it sells): United States (English)',
    'Brand names: TextBolt; Text Bolt'
  ],
  brands: ['Website: textbolt.com', 'What it does: TextBolt sells'],
  products: [
    'Market tracked (where AI answers are checked, not always where it sells): United States (English)',
    'What it does: TextBolt sells'
  ],
  buyers: ['Products: Email-to-SMS gateway (Turns emails into texts.)', 'What sends them looking:'],
  triggers: ['Buyers: IT managers at small businesses (Their gateway shut down.)'],
  competitors: ['Buyers switch from: AT&T email-to-text', 'Used with: Gmail'],
  switchingFrom: ['Competitors: TXTImpact (txtimpact.com)', 'Used with: Gmail'],
  integrations: ['Buyers switch from: AT&T email-to-text'],
  examples: [
    'Buyers: IT managers at small businesses (Their gateway shut down.)',
    'Competitors: TXTImpact (txtimpact.com)'
  ],
  topic: ['Buyers: IT managers', 'What sends them looking: A carrier shuts down'],
  questions: ['Topic: Replacing a shut-down email-to-text gateway', 'Competitors: TXTImpact']
}

describe('onboarding v2 section prompts', () => {
  test.each(SETUP_SECTION_IDS)('%s carries its context lines and its reply rules', (section) => {
    const def = sectionDef(section)
    const task = more(section)
    for (const line of EXPECTED_LINES[section]) expect(task).toContain(line)
    const prompt = fullPrompt(def, task)
    if (def.kind === 'list') {
      expect(prompt).toContain(`${LIST_REPLY_LEAD}\n${def.columns.join(',')}`)
      expect(promptResult(def, task).columns).toEqual(def.columns)
    } else {
      expect(prompt.endsWith(def.replyLead ?? TEXT_REPLY_LEAD)).toBe(true)
      expect(promptResult(def, task).columns).toEqual(['text'])
    }
    expect(promptResult(def, task).webSearch).toBe(section === 'competitors')
    // The routing line is only on the in-app run, never on the prompt shown or copied.
    expect(prompt.startsWith('Assist:')).toBe(false)
    expect(runPrompt(def, task).split('\n')[0]).toBe(`Assist: setup.${section}`)
  })

  test.each(SETUP_SECTION_IDS)('%s leaves out context lines with no value', (section) => {
    const task = sectionTask(sectionDef(section), {
      context: bareContext(),
      mode: 'redo',
      instruction: null,
      current: []
    })
    expect(task).not.toMatch(
      /^(?:Market|What it does|Brand names|Products|Buyers|Competitors|Topic|Used with|Buyers switch from|What sends them looking):/mu
    )
    expect(task).not.toMatch(/\n\n\n/u)
    expect(task).not.toMatch(/Already listed|Keep these/u)
  })

  test('✦ Find more lists the rows held as "already listed, don\'t repeat"', () => {
    const task = more('buyers', [
      row('Office managers', { detail: 'Missed reminders' }),
      row('IT leads')
    ])
    expect(task).toContain("Already listed, don't repeat: 2 buyers.")
    expect(task).toContain('- Office managers (Missed reminders)')
    expect(task).toContain('- IT leads')
  })

  test('✦ Redo lists the user rows as "keep these" and adds the instruction on its own line', () => {
    const task = sectionTask(sectionDef('competitors'), {
      context: textboltContext(),
      mode: 'redo',
      instruction: 'only US competitors',
      current: [row('Notifyre', { url: 'notifyre.com' })]
    })
    expect(task).toContain("Keep these competitors, the user chose them; don't repeat them:")
    expect(task).toContain('- Notifyre (notifyre.com)')
    expect(task.split('\n').at(-1)).toBe('The user asks for this: only US competitors')
  })

  test('competitors reuse the per-product question and rules, with switch-from and integrations excluded', () => {
    const task = more('competitors')
    expect(task).toContain(
      'What are the competitors of textbolt.com that do exactly what it does, for buyers in United States (English)?'
    )
    expect(task).toContain('- direct: a buyer looking for this exact product would shortlist it')
    expect(task).toContain(
      '- Never list textbolt.com itself or any product made by the same company (its own brands: TextBolt, Text Bolt), even one the pages do not name.'
    )
    expect(task).toContain(
      '- Not competitors (buyers switch from them, or use them with it): AT&T email-to-text, Gmail.'
    )
    expect(task).toContain('product = the product it competes with: Email-to-SMS gateway')
  })

  test('questions and trigger events never name the brand', () => {
    expect(more('questions')).toContain('Never name TextBolt or Text Bolt.')
    expect(more('triggers')).toContain('Never name TextBolt or Text Bolt.')
  })

  test('an edited prompt replaces only the task: its reply rules and routing line are cut', () => {
    const def = sectionDef('buyers')
    const edited = `Assist: setup.buyers\nList buyers in Texas only.\n\n${LIST_REPLY_LEAD}\nwho,situation\nsomething else`
    const task = editedTask(edited)
    expect(task).toBe('List buyers in Texas only.')
    expect(runPrompt(def, task)).toBe(
      `Assist: setup.buyers\nList buyers in Texas only.\n\n${LIST_REPLY_LEAD}\nwho,situation,evidence\n${LIST_REPLY_EMPTY}`
    )
  })

  test('products: the whole prompt, with the site pages and menu (golden)', () => {
    const def = sectionDef('products')
    const task = sectionTask(def, {
      context: textboltContext(),
      mode: 'more',
      instruction: null,
      current: [row('Email-to-SMS gateway', { detail: 'Turns emails into texts.', url: '/' })],
      site: {
        pages: [
          { path: '/', title: 'TextBolt · Email to text' },
          { path: '/use-case/', title: 'Use cases' }
        ],
        menu: [
          { text: 'Send Text from Gmail', path: '/integration/gmail-to-text/' },
          { text: 'Server Monitoring Alerts', path: '/use-case/server-monitoring-text-alerts/' },
          { text: '', path: '/migration/' }
        ]
      }
    })
    expect(fullPrompt(def, task)).toBe(`You help set up AI-search tracking for textbolt.com.
Website: textbolt.com
Market tracked (where AI answers are checked, not always where it sells): United States (English)
What it does: TextBolt sells an email-to-SMS gateway to small US businesses.
Brand names: TextBolt; Text Bolt

Site paths (page titles or menu words; no other paths exist):
- /: TextBolt · Email to text
- /use-case/: Use cases
- /integration/gmail-to-text/: Send Text from Gmail
- /use-case/server-monitoring-text-alerts/: Server Monitoring Alerts
- /migration/

List up to 5 products or services textbolt.com sells.
List each offering a buyer would look for on its own: a different job, a different buyer or a different situation, especially when the site gives it its own page (a use case, solution, integration or migration page). Plans, pricing tiers and features of one thing are one offering.
name = a short generic category a buyer would use, never the brand
job = what it does for the buyer, in one line
url = its page path from the site paths above, or blank

Already listed, don't repeat: 1 product.
- Email-to-SMS gateway (Turns emails into texts.)

Reply with CSV only, this header:
name,job,url
If there is nothing new to add, reply with the header line only.`)
  })

  test('only a section that lists the site shows it; no site leaves it out', () => {
    const site = {
      pages: [{ path: '/', title: 'Home' }],
      menu: [{ text: 'Plans', path: '/plans/' }]
    }
    const input = {
      context: textboltContext(),
      mode: 'more' as const,
      instruction: null,
      current: []
    }
    // Competitors come from a web search, not the site digest.
    expect(sectionTask(sectionDef('competitors'), { ...input, site })).not.toContain('Site paths')
    expect(sectionTask(sectionDef('buyers'), { ...input, site })).toContain('- /plans/: Plans')
    expect(sectionTask(sectionDef('products'), { ...input, site: null })).not.toMatch(/Site paths/u)
  })

  test('the prompt never carries a key, an email address or a file path', () => {
    const context = {
      ...textboltContext(),
      summary: 'Mail ops@textbolt.com, key sk-abcdefghijklmnopqrstu, see /Users/ada/notes.txt'
    }
    const task = sectionTask(sectionDef('summary'), {
      context,
      mode: 'redo',
      instruction: null,
      current: []
    })
    expect(task).not.toContain('ops@textbolt.com')
    expect(task).not.toContain('sk-abcdefghijklmnopqrstu')
    expect(task).not.toContain('/Users/ada')
  })
})
