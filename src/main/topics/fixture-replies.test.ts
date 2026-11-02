import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Ajv from 'ajv'
import { describe, expect, test } from 'vitest'
import { TOPIC_STAGES, TOPIC_TEMPLATE_KINDS, templateKindLifecycle } from '@shared/domain'
import { promptLines, staticTopicReplies, topicFixtureReply } from './fixture-replies'
import { TOPIC_SCHEMAS } from './templates'

const DIR = join(process.cwd(), 'src/main/topics/fixtures')
const ajv = new Ajv({ allErrors: true, strict: false })

describe('topic fixture replies (e2e Claude stand-in)', () => {
  test('every topic kind that runs has a reply that matches its schema', () => {
    // Planned and retired kinds (Docs/PROMPT-AUDIT.md, rule 6) never run.
    for (const kind of TOPIC_TEMPLATE_KINDS.filter((k) => templateKindLifecycle(k) === 'live')) {
      const prompt =
        kind === 'topic_page_match'
          ? `Template: ${kind}.md\nhttps://textbolt.com/a/ · A · H\n\ntq-1 · How do I text staff?\ntq-2 · Another question here`
          : kind === 'topic_journey_questions'
            ? `Template: ${kind}.md\nVariant: compare\n`
            : `Template: ${kind}.md\ntq-1 · sms alerts`
      const reply = topicFixtureReply(prompt)
      const validate = ajv.compile(TOPIC_SCHEMAS[kind])
      expect(validate(reply), `${kind}: ${ajv.errorsText(validate.errors)}`).toBe(true)
    }
  })

  test('journey questions answer per stage; gaps mode returns gaps only', () => {
    for (const stage of TOPIC_STAGES) {
      const reply = topicFixtureReply(
        `Template: topic_journey_questions.md\nVariant: ${stage}\nYou are writing`
      ) as { questions: { text: string }[] }
      expect(reply.questions.length, stage).toBeGreaterThan(0)
    }
    const gaps = topicFixtureReply('Template: topic_questions_discover.md\nVariant: gaps\n') as {
      questions: unknown[]
      gaps: unknown[]
    }
    expect(gaps.questions).toEqual([])
    expect(gaps.gaps).toHaveLength(2)
    const rewrite = topicFixtureReply(
      'Template: topic_profile_rewrite.md\nVariant: rewrite\npp-1 · [Who] IT admins.'
    ) as { points: { replaces: string; text: string }[] }
    expect(rewrite.points).toEqual([
      { section: 'who', text: 'IT admins, in plain words', replaces: 'pp-1' }
    ])
  })

  test('page match answers each prompt id with a listed page or none', () => {
    const reply = topicFixtureReply(
      'Template: topic_page_match.md\nhttps://textbolt.com/a/ · A · H\ntq-1 · One\ntq-2 · Two\ntq-3 · Three\ntq-4 · Four'
    ) as { matches: { id: string; url: string | null }[] }
    expect(reply.matches.map((match) => match.id)).toEqual(['tq-1', 'tq-2', 'tq-3', 'tq-4'])
    expect(reply.matches.map((match) => match.url)).toEqual([
      'https://textbolt.com/a/',
      'https://textbolt.com/a/',
      'https://textbolt.com/a/',
      null
    ])
    expect(promptLines('x\nid-1 · text one\nnot a line')).toEqual([
      { id: 'id-1', text: 'text one' }
    ])
  })

  test('fixtures/<kind>.json hold the static replies the shim serves', () => {
    if (process.env.CITEFOX_WRITE_TOPIC_FIXTURES === '1') {
      mkdirSync(DIR, { recursive: true })
      for (const [kind, reply] of Object.entries(staticTopicReplies())) {
        writeFileSync(join(DIR, `${kind}.json`), `${JSON.stringify(reply, null, 2)}\n`)
      }
    }
    for (const [kind, reply] of Object.entries(staticTopicReplies())) {
      const file = join(DIR, `${kind}.json`)
      expect(existsSync(file), `${file} is missing; run with CITEFOX_WRITE_TOPIC_FIXTURES=1`).toBe(
        true
      )
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(reply)
    }
  })
})
