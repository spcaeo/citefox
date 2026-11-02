import { describe, expect, test } from 'vitest'
import {
  checkedFoundIn,
  checkProfilePoints,
  checkStageQuestions,
  findCompetitor,
  shortfallProblem,
  softwareCalledGateway,
  type StageCheckInput,
  type StageQuestionReply
} from './journey-checks'
import { journeyStageRules, stageCompetitorBlock } from './steps-journey'

const COMPETITORS = [
  { name: 'TXTImpact', domain: 'txtimpact.com' },
  { name: 'Textmagic', domain: 'textmagic.com' },
  { name: 'ClickSend', domain: null },
  { name: 'simpletexting.com', domain: 'simpletexting.com' }
]

const INPUT: StageCheckInput = {
  stage: 'compare',
  brands: ['TextBolt', 'Text Bolt'],
  competitors: COMPETITORS,
  switchingFrom: ['AT&T email-to-text gateway', 'Verizon vtext.com'],
  existing: []
}

const q = (text: string, competitorNamed: string | null = null): StageQuestionReply => ({
  text,
  namedTool: null,
  competitorNamed
})

describe('checkStageQuestions', () => {
  test('compare keeps listed competitors and drops made-up ones and switch-from options', () => {
    const result = checkStageQuestions(
      [
        q(
          'I run IT for a regional hospital and our alarm server emails alerts; is Textmagic or ClickSend more reliable for texting on-call nurses?',
          'Textmagic'
        ),
        q(
          'As a plant manager with WIN-911 alarm emails, should I pick SimpleTexting or another email-to-SMS service for after-hours texts to my crew?',
          'SimpleTexting'
        ),
        q(
          'Our facilities team sends alarm panel emails today; is Acme Alerts better than a paid email-to-SMS gateway for texting technicians at night?',
          'Acme Alerts'
        ),
        q(
          'I manage security for three warehouses and our alarms email the Verizon vtext.com gateway; should we keep using vtext.com or choose something else?',
          'Verizon vtext.com'
        )
      ],
      INPUT
    )
    expect(result.kept.map((item) => item.competitorNamed)).toEqual([
      'Textmagic',
      'simpletexting.com'
    ])
    expect(result.dropped.competitor).toBe(1)
    expect(result.dropped.switch_from).toBe(1)
  })

  test('word count, brand, repeats and competitors outside compare are dropped', () => {
    const long = `I run a small security company ${'and we keep missing alarm emails '.repeat(5)}what should I do?`
    const result = checkStageQuestions(
      [
        q('Short question about alarms?'),
        q(long),
        q(
          'I run facilities for a school district and our alarm panel only emails; could TextBolt send those alarm emails to our phones as texts?'
        ),
        q(
          'Our alarm monitoring software only emails one inbox overnight, and I am the on-call technician; how do other small teams get those alarms as texts?'
        ),
        q(
          'Our alarm monitoring software only emails one inbox overnight, and I am the on-call technician; how do other small teams get those alarms as texts?'
        ),
        q(
          'I manage a dental office and our alarm emails go to Outlook; would Textmagic let the front desk get those alarms as texts on their phones?'
        )
      ],
      { ...INPUT, stage: 'problem' }
    )
    expect(result.kept).toHaveLength(1)
    expect(result.dropped).toEqual({
      other_stage: 0,
      brand: 1,
      short: 1,
      long: 1,
      competitor: 1,
      switch_from: 0,
      gateway: 0,
      tool_cap: 0,
      repeat: 1
    })
    expect(shortfallProblem(result, 3)).toBe(
      '2 of 3 questions could not be kept: 1 named the brand, 1 was under 15 words, 1 was over 32 words, 1 named a company that is not on the competitor list (or named one in a stage that names none), 1 repeated another question. Write exactly 3 questions that follow every rule.'
    )
    expect(shortfallProblem(result, 1)).toBeNull()
  })

  test('a question already in the draft is a repeat', () => {
    const text =
      'I own a small alarm installation company and customers ask for texts instead of alarm emails; what are the ways to set that up without code?'
    const result = checkStageQuestions([q(text)], {
      ...INPUT,
      stage: 'options',
      existing: [text]
    })
    expect(result.kept).toEqual([])
    expect(result.dropped.repeat).toBe(1)
  })

  test('competitor names match by name, domain or domain label', () => {
    expect(findCompetitor('textmagic.com', COMPETITORS)?.name).toBe('Textmagic')
    expect(findCompetitor('TXT Impact', COMPETITORS)?.name).toBe('TXTImpact')
    expect(findCompetitor('SimpleTexting', COMPETITORS)?.name).toBe('simpletexting.com')
    expect(findCompetitor('Twilio', COMPETITORS)).toBeNull()
  })

  test('software that sends the emails is never called a gateway', () => {
    const text = (body: string): StageQuestionReply => ({ ...q(body), namedTool: 'WIN-911' })
    const result = checkStageQuestions(
      [
        text(
          'I run a security control room using Milestone XProtect, and our Win 911 email-to-text gateway stopped working, so alarms no longer reach phones. How long will setup take?'
        ),
        text(
          'I run a water plant whose WIN-911 alarm software emails our AT&T gateway addresses, and since June nothing reaches the operators on call. What changed?'
        )
      ],
      { ...INPUT, stage: 'problem', integrations: ['Outlook'] }
    )
    expect(result.dropped.gateway).toBe(1)
    expect(result.kept.map((item) => item.text)).toEqual([
      'I run a water plant whose WIN-911 alarm software emails our AT&T gateway addresses, and since June nothing reaches the operators on call. What changed?'
    ])
    expect(
      softwareCalledGateway('Our Outlook email gateway rules stopped sending texts overnight.', [
        'Outlook'
      ])
    ).toBe(true)
  })

  test('a single-stage call keeps only its own stage (an older body writes all six)', () => {
    const own = q(
      'I manage a small clinic front desk, and our Outlook reminder emails to patients stopped arriving as texts last week; why would that happen?'
    )
    const other = {
      ...q(
        'I own a plumbing company with no developer and need texts from Outlook; is Textmagic or ClickSend cheaper for ten technicians each month?'
      ),
      stage: 'compare' as const
    }
    const result = checkStageQuestions([{ ...own, stage: 'problem' }, other], {
      ...INPUT,
      stage: 'problem'
    })
    expect(result.kept).toHaveLength(1)
    expect(result.dropped.other_stage).toBe(1)
  })

  test('bracket notes keep only the name: a buyer types no brackets', () => {
    const result = checkStageQuestions(
      [
        q(
          'I manage a medical practice. Our vaccine fridge sensor [vendor to confirm, e.g. Monnit] emailed a weekend alarm nobody saw. What ways are there to get texts instead?'
        ),
        q(
          'I am office administrator at a law firm. Our server room [APC] UPS emailed a power failure alert nobody saw overnight. What ways are there to get texts?'
        )
      ],
      { ...INPUT, stage: 'options' }
    )
    expect(result.kept.map((item) => item.text)).toEqual([
      'I manage a medical practice. Our vaccine fridge sensor Monnit emailed a weekend alarm nobody saw. What ways are there to get texts instead?',
      'I am office administrator at a law firm. Our server room APC UPS emailed a power failure alert nobody saw overnight. What ways are there to get texts?'
    ])
  })

  test('software already named in enough questions is dropped', () => {
    const result = checkStageQuestions(
      [
        q(
          'I run a security office using Milestone XProtect, and a camera went offline at 2 a.m. while the alarm email sat unread until morning. Why?'
        )
      ],
      { ...INPUT, stage: 'problem', bannedTools: ['XProtect'] }
    )
    expect(result.dropped.tool_cap).toBe(1)
  })

  test('a plain domain label is not a name: text.email never matches the word "text"', () => {
    const list = [...COMPETITORS, { name: 'text.email', domain: 'text.email' }]
    const result = checkStageQuestions(
      [
        q(
          'I manage a dental front desk and our Outlook reminder emails to patients stopped arriving as text messages last week; why would that happen?'
        )
      ],
      { ...INPUT, stage: 'problem', competitors: list }
    )
    expect(result.kept).toHaveLength(1)
    expect(findCompetitor('text', list)).toBeNull()
    expect(findCompetitor('text.email', list)?.name).toBe('text.email')
  })
})

describe('stage context', () => {
  const context = {
    product: null,
    direct: COMPETITORS,
    partial: [],
    switchingFrom: ['AT&T email-to-text gateway'],
    integrations: ['WIN-911', 'Outlook']
  }

  test('compare and decide get the competitor list; other stages name no company', () => {
    const compare = stageCompetitorBlock('compare', context)
    expect(compare).toContain('Direct competitors of this business: TXTImpact (txtimpact.com)')
    expect(compare).toContain('never offer them as options): AT&T email-to-text gateway.')
    const problem = stageCompetitorBlock('problem', context)
    expect(problem).not.toContain('TXTImpact')
    expect(problem).toContain('What buyers used before')
    expect(problem).toContain('WIN-911, Outlook')
    expect(problem).toContain('Name no competitor or product to buy in this stage.')
  })

  test('compare with no saved competitors names no company', () => {
    const block = stageCompetitorBlock('compare', { ...context, direct: [] })
    expect(block).toContain('name no company')
  })

  test('stage rules hold one stage only', () => {
    const rules = journeyStageRules('compare')
    expect(rules.startsWith('Stage:\n- compare:')).toBe(true)
    expect(rules).not.toContain('- problem:')
  })
})

describe('profile checks', () => {
  const sources = [
    { path: '/use-case/alarm-system-text-alerts/', title: 'Alarm system text alerts' },
    { path: '/pricing', title: 'Pricing' }
  ]

  test('foundIn must be an evidence path or page name', () => {
    expect(checkedFoundIn('/use-case/alarm-system-text-alerts', sources)).toBe(
      '/use-case/alarm-system-text-alerts/'
    )
    expect(checkedFoundIn('[/pricing/]', sources)).toBe('/pricing')
    expect(checkedFoundIn('Pricing', sources)).toBe('/pricing')
    expect(checkedFoundIn('Home: Migration menu', sources)).toBeNull()
    expect(checkedFoundIn('/about', sources)).toBeNull()
    expect(checkedFoundIn(null, sources)).toBeNull()
  })

  test('at most six points per section, no brand, thin sections listed', () => {
    const points = Array.from({ length: 8 }, (_, index) => ({
      section: 'who' as const,
      text: `Facilities manager number ${index + 1} at a plant`,
      foundIn: '/pricing/',
      verify: null
    }))
    const result = checkProfilePoints(
      [
        ...points,
        { section: 'values', text: 'Likes TextBolt replies', foundIn: null, verify: null }
      ],
      sources,
      ['TextBolt']
    )
    expect(result.kept.filter((point) => point.section === 'who')).toHaveLength(6)
    expect(result.kept[0]?.foundIn).toBe('/pricing')
    expect(result.branded).toBe(1)
    expect(result.thin).toEqual(['environment', 'segments', 'triggers', 'values', 'poor_fit'])
  })
})
