import { describe, expect, it } from 'vitest'
import { autopilotExample, cleanDomain, START_WAYS, wayExample, wayExamples } from './examples'

const TEXTBOLT = {
  domain: 'textbolt.com',
  brandNames: ['TextBolt'],
  competitors: ['simpletexting.com', 'Text-Em-All'],
  switchingFrom: ['AT&T email to text']
}

describe('start examples from the saved profile', () => {
  it('uses the domain, rivals and switch-from option the user saved', () => {
    const auto = autopilotExample(TEXTBOLT)
    expect(auto.reads).toBe('Reads textbolt.com and its sitemap')
    expect(auto.rivals).toContain('simpletexting.com and Text-Em-All')
    expect(auto.questions).toContain('moving off AT&T email to text')
    // Page paths are examples, never claimed as found.
    expect(auto.pages).toContain('e.g. /pricing')
  })

  it('gives one line per way, each marked as an example', () => {
    const ways = wayExamples(TEXTBOLT)
    expect(ways.map((way) => way.id)).toEqual([...START_WAYS])
    expect(wayExample(TEXTBOLT, 'page').example).toBe('e.g. https://textbolt.com/pricing')
    expect(wayExample(TEXTBOLT, 'page').url).toBe(true)
    expect(wayExample(TEXTBOLT, 'competitor').example).toBe(
      'e.g. https://simpletexting.com/pricing'
    )
    expect(wayExample(TEXTBOLT, 'keywords').example).toContain('AT&T email to text alternative')
    expect(wayExample(TEXTBOLT, 'seed').example).toBe('e.g. “replacing AT&T email to text”')
    for (const way of ways.filter((item) => item.available)) {
      expect(way.example.startsWith('e.g. ')).toBe(true)
    }
    expect(wayExample(TEXTBOLT, 'gsc').available).toBe(false)
  })

  it('prefers a saved suggested seed for the seed example', () => {
    expect(wayExample(TEXTBOLT, 'seed', 'Text alerts for teams').example).toBe(
      'e.g. “Text alerts for teams”'
    )
  })

  it('names a competitor without a domain by name, never inventing a URL', () => {
    const example = wayExample({ competitors: ['Text-Em-All'] }, 'competitor')
    expect(example.example).toBe('e.g. Text-Em-All’s pricing page')
    expect(example.url).toBe(false)
  })

  it('falls back to generic copy when the profile is empty', () => {
    const auto = autopilotExample({})
    expect(auto.reads).toBe('Reads your homepage and sitemap')
    expect(auto.rivals).toBe('Finds your rivals and sorts them from partners')
    expect(auto.questions).toBe('Writes 10 buyer questions in your buyers’ words')
    const ways = wayExamples({ domain: null, brandNames: [], competitors: [' '] })
    expect(ways.find((way) => way.id === 'page')?.example).toBe('e.g. your pricing page')
    expect(ways.find((way) => way.id === 'competitor')?.example).toBe(
      'e.g. a rival’s pricing or compare page'
    )
    expect(ways.find((way) => way.id === 'seed')?.example).toBe(
      'e.g. a problem your buyers have, in their words'
    )
    expect(ways.every((way) => !way.example.includes('undefined'))).toBe(true)
  })

  it('uses the brand when there is no switch-from option', () => {
    const auto = autopilotExample({ domain: 'textbolt.com', brandNames: ['TextBolt'] })
    expect(auto.questions).toContain('before they have heard of TextBolt')
    expect(wayExample({ brandNames: ['TextBolt'] }, 'seed').example).toContain('find TextBolt')
  })

  it('cleans domains and rejects names', () => {
    expect(cleanDomain('https://www.TextBolt.com/pricing')).toBe('textbolt.com')
    expect(cleanDomain('Text-Em-All')).toBeNull()
    expect(cleanDomain('')).toBeNull()
    expect(cleanDomain(null)).toBeNull()
  })
})
