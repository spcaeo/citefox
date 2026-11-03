import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, test } from 'vitest'
import { Q } from '@shared/fixtures/textbolt-topic-data'
import { textboltTopicPrompts } from '@shared/fixtures/textbolt-topic'
import { TEXTBOLT_PROMPTS_EN, TEXTBOLT_PROMPTS_ES } from '../pipeline/textbolt-fixture'
import { PRICING_FACT } from '../engine/sentiment/fixture-replies'

/**
 * Owner rule: TextBolt may appear in demos, screenshots, mock-ups and videos,
 * but no build ships its name or its questions. Demo data lives in fixtures
 * (tests, the developer harness, tests/e2e/fixtures); this reads what
 * `npm run build` produced and fails on any trace of it.
 */
const BUNDLES = ['out/main', 'out/renderer', 'out/preload']
const TEXT_FILE = /\.(m?js|cjs|html|css|json|md|txt|map)$/i

function walk(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory)) {
    const file = join(directory, entry)
    if (statSync(file).isDirectory()) files.push(...walk(file))
    else files.push(file)
  }
  return files
}

function bundleFiles(): string[] {
  const files: string[] = []
  for (const bundle of BUNDLES) {
    const directory = resolve(bundle)
    expect(existsSync(directory), `${bundle} is absent. Run npm run build before this check.`).toBe(
      true
    )
    files.push(...walk(directory).filter((file) => TEXT_FILE.test(file)))
  }
  return files
}

function topicSitePhrases(): string[] {
  const site = JSON.parse(readFileSync(resolve('tests/e2e/fixtures/topic-site.json'), 'utf8')) as {
    pages: Record<string, { title: string }>
  }
  return Object.values(site.pages).map((page) => page.title)
}

/** Fixture questions and lines long enough that a match can only be the fixture itself. */
function fixturePhrases(): string[] {
  const phrases = [
    ...Q.map((question) => question.text),
    ...textboltTopicPrompts().map((prompt) => prompt.text),
    ...TEXTBOLT_PROMPTS_EN.prompts.map((prompt) => prompt.text),
    ...TEXTBOLT_PROMPTS_ES.prompts.map((prompt) => prompt.text),
    PRICING_FACT,
    ...topicSitePhrases()
  ]
  return [...new Set(phrases.filter((phrase) => phrase.length >= 24))]
}

describe('release bundles carry no demo data', () => {
  const files = bundleFiles()
  const texts = files.map((file) => ({
    // '/' on every platform, so the names read the same on Windows.
    name: relative(process.cwd(), file).split(sep).join('/'),
    text: readFileSync(file, 'utf8')
  }))

  test('the build has a main, renderer and preload bundle to read', () => {
    expect(texts.some((entry) => entry.name.startsWith('out/main'))).toBe(true)
    expect(texts.some((entry) => entry.name.startsWith('out/renderer'))).toBe(true)
  })

  test('no bundle names TextBolt, in any case', () => {
    const hits = texts
      .filter((entry) => /textbolt/i.test(entry.text))
      .map((entry) => `${entry.name}: ${entry.text.match(/textbolt/gi)?.length ?? 0}`)
    expect(hits).toEqual([])
  })

  test('no bundle carries a fixture question or demo page', () => {
    const phrases = fixturePhrases()
    expect(phrases.length).toBeGreaterThan(40)
    const hits: string[] = []
    for (const entry of texts) {
      for (const phrase of phrases) {
        if (entry.text.includes(phrase)) hits.push(`${entry.name}: ${phrase.slice(0, 80)}`)
      }
    }
    expect(hits).toEqual([])
  })
})
