import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Ajv from 'ajv'
import { afterEach, describe, expect, test } from 'vitest'
import { COMPETITOR_DEFINITION, COMPETITOR_SHORT_RULE } from '../engine/competitor-rules'
import { BRAND_PROMPTS_TEMPLATE } from '../pipeline/sentiment-templates'
import {
  seedShippedTemplates,
  shippedBody,
  templateHash,
  unknownVariables
} from '../pipeline/templates'
import { openAppDatabase } from '../storage/app-database'
import { closeDatabase, type SqliteDatabase } from '../storage/database'
import { listTemplateVersions } from '../storage/template-records'
import seedReply from './fixtures/topic_seed_discover.json'
import { TOPIC_SCHEMAS, TOPIC_TEMPLATE_BODIES } from './templates'

/** Docs/FEEDBACK.md row 3: every step that suggests or uses competitors shares one rule. */

const ajv = new Ajv({ allErrors: true, strict: false })
const validateSeed = ajv.compile(TOPIC_SCHEMAS.topic_seed_discover)

const databases: SqliteDatabase[] = []
const directories: string[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('competitor rules in the templates', () => {
  test('seed discover asks for seeds only: competitors come from Fill and the saved catalog', () => {
    // Docs/PROMPT-AUDIT.md P2: one job per prompt.
    const body = TOPIC_TEMPLATE_BODIES.topic_seed_discover
    expect(body).not.toContain(COMPETITOR_DEFINITION)
    expect(body).not.toContain('switchingFrom')
    expect(body).not.toContain('{{ competitors }}')
    expect(body).toContain('{{ products }}')
    expect(body).toContain('productId')
  })

  test('steps that use competitors carry the short rule', () => {
    expect(TOPIC_TEMPLATE_BODIES.competitor_page_questions).toContain(COMPETITOR_SHORT_RULE)
    // P3: journey questions get it inside {{ competitor_block }}, built per stage in code.
    expect(TOPIC_TEMPLATE_BODIES.topic_journey_questions).toContain('{{ competitor_block }}')
    // P4: the competitor keyword groups get the rule inside {{ competitor_block }}
    // (built in code); the other keyword groups get no competitor list at all.
    expect(TOPIC_TEMPLATE_BODIES.topic_keyword_competitor).toContain('{{ competitor_block }}')
    expect(TOPIC_TEMPLATE_BODIES.topic_keyword_expand).not.toContain('{{ competitors }}')
    expect(TOPIC_TEMPLATE_BODIES.topic_keyword_expand).not.toContain('{{ competitor_block }}')
    expect(BRAND_PROMPTS_TEMPLATE).toContain('never a service that was shut down')
  })

  test('profile and journey questions read the buyer context notes', () => {
    expect(TOPIC_TEMPLATE_BODIES.topic_buyer_profile).toContain('{{ switching_from }}')
    expect(TOPIC_TEMPLATE_BODIES.topic_buyer_profile).toContain('{{ integrations }}')
    // Per stage, the switch-from options and tools come inside {{ competitor_block }}.
    expect(TOPIC_TEMPLATE_BODIES.topic_journey_questions).toContain('{{ competitor_block }}')
  })

  test('every changed body uses only variables its step fills', () => {
    for (const kind of [
      'topic_seed_discover',
      'topic_buyer_profile',
      'topic_journey_questions',
      'topic_keyword_terms',
      'topic_keyword_expand',
      'topic_keyword_competitor',
      'competitor_page_questions',
      'competitor_page_questions_v2',
      'competitor_page_claims'
    ] as const) {
      expect(unknownVariables(TOPIC_TEMPLATE_BODIES[kind], kind), kind).toEqual([])
    }
  })
})

describe('topic_seed_discover schema', () => {
  test('accepts seeds with their product, segments and why', () => {
    expect(validateSeed(seedReply)).toBe(true)
  })

  test('rejects the old combined shape (competitors, switch-from, about)', () => {
    const old = { ...seedReply, competitors: [], switchingFrom: [], integrations: [], about: null }
    expect(validateSeed(old)).toBe(false)
  })

  test('requires each seed to say its product (null for the whole business)', () => {
    const seeds = seedReply.seeds.map((seed) => ({
      text: seed.text,
      evidence: seed.evidence,
      caution: seed.caution
    }))
    expect(validateSeed({ ...seedReply, seeds })).toBe(false)
  })
})

describe('versions', () => {
  test('the new seed discover body is the next version of the shipped template', () => {
    const directory = mkdtempSync(join(tmpdir(), 'citefox-competitor-templates-'))
    directories.push(directory)
    const db = openAppDatabase(join(directory, 'app.sqlite'))
    databases.push(db)
    seedShippedTemplates(db, () => '2026-10-21T10:00:00.000Z')
    const old = 'Template: topic_seed_discover.md\nOld body: competitors with their domain.'
    db.prepare(`UPDATE templates SET body = ?, hash = ? WHERE id = 'tpl-topic-seed-discover'`).run(
      old,
      templateHash(old)
    )
    seedShippedTemplates(db, () => '2026-10-22T10:00:00.000Z')
    const versions = listTemplateVersions(db, 'tpl-topic-seed-discover')
    expect(versions[0]?.version).toBe((versions[1]?.version ?? 0) + 1)
    expect(versions[0]?.body).toBe(shippedBody('topic_seed_discover'))
  })
})
