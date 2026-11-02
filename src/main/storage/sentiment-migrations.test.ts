import { afterEach, describe, expect, test } from 'vitest'
import {
  ASSISTANT_TEMPLATE_KINDS,
  TOPIC_TEMPLATE_KINDS,
  templateKindLifecycle
} from '@shared/domain'
import { page, snapshot } from '../engine/checks/checks.test-helper'
import { contentHash } from '../pipeline/hash'
import { seedShippedTemplates } from '../pipeline/templates'
import { APP_MIGRATIONS } from './app-schema'
import {
  deleteBrandFact,
  getLatestBrandPromptSet,
  insertBrandFact,
  insertBrandPromptSet,
  listBrandFacts
} from './brand-records'
import { insertSnapshot } from './content-records'
import { openSqliteDatabase } from './database'
import { insertGeneration } from './generation-records'
import { migrate } from './migrate'
import { applied, closeTracked, foreignKeys, tableNames, track } from './migrate.test-helper'
import { insertPage } from './pages'
import { PROJECT_MIGRATIONS } from './project-schema'
import { getTemplate } from './records'

afterEach(() => {
  closeTracked()
})

const HASH = contentHash('x')
const NOW = '2026-10-19T12:00:00.000Z'

function generation(
  id: string,
  kind: 'aio_gap' | 'sentiment_claims'
): Parameters<typeof insertGeneration>[1] {
  return {
    id,
    pageId: 'page-1',
    kind,
    templateId: 'tpl',
    templateHash: HASH,
    startedAt: NOW,
    durationMs: 1,
    model: null,
    connection: 'claude-code',
    ok: true,
    error: null,
    inputHash: HASH,
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      serpapiSearches: 0
    }
  }
}

describe('project migration 020_brand_sentiment', () => {
  test('keeps generations and analyses and adds the sentiment tables', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, PROJECT_MIGRATIONS.slice(0, 19))
    insertPage(db, { ...page(), defaultMarketId: null })
    insertSnapshot(db, snapshot())
    insertGeneration(db, generation('gen-1', 'aio_gap'), { facts: [] })
    db.prepare(
      `INSERT INTO analyses (id, run_id, snapshot_id, kind, prompt_id, body_json, template_hash,
         done, market_id, generation_id)
       VALUES ('an-1', NULL, 'snap-1', 'gap_matrix', NULL, '{}', ?, 1, NULL, 'gen-1')`
    ).run(HASH)

    migrate(db, PROJECT_MIGRATIONS)

    expect(applied(db)).toContainEqual({ version: 20, name: '020_brand_sentiment' })
    expect(db.prepare('SELECT id, kind FROM generations').all()).toEqual([
      { id: 'gen-1', kind: 'aio_gap' }
    ])
    expect(db.prepare('SELECT id, generation_id FROM analyses').all()).toEqual([
      { id: 'an-1', generation_id: 'gen-1' }
    ])
    expect(
      foreignKeys(db, 'analyses')
        .map((key) => key.table)
        .sort()
    ).toEqual(['generations', 'prompts', 'runs', 'snapshots'])
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    for (const table of [
      'brand_prompts',
      'brand_facts',
      'brand_captures',
      'sentiment_reads',
      'claims'
    ]) {
      expect(tableNames(db)).toContain(table)
    }
    insertGeneration(db, generation('gen-2', 'sentiment_claims'), {
      brandsNamed: [],
      reason: '',
      claims: []
    })
    expect(db.prepare(`SELECT COUNT(*) AS n FROM generations`).get()).toEqual({ n: 2 })
  })

  test('brand prompts are versioned per page and brand facts are kept in order', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, PROJECT_MIGRATIONS)
    insertPage(db, { ...page(), defaultMarketId: null })
    expect(getLatestBrandPromptSet(db, 'page-1')).toBeNull()
    const first = insertBrandPromptSet(db, {
      pageId: 'page-1',
      savedAt: NOW,
      templateId: 'tpl-brand-prompts',
      templateHash: HASH,
      prompts: [
        { id: 'a', kind: 'review', language: 'en', text: 'TextBolt reviews' },
        { id: 'b', kind: 'review', language: 'es', text: 'TextBolt opiniones' }
      ]
    })
    expect(first.version).toBe(1)
    const second = insertBrandPromptSet(db, {
      pageId: 'page-1',
      savedAt: NOW,
      templateId: null,
      templateHash: null,
      prompts: [{ id: 'c', kind: 'pricing', language: 'en', text: 'TextBolt pricing' }]
    })
    expect(second.version).toBe(2)
    expect(second.prompts.map((prompt) => prompt.id)).toEqual(['c'])
    // Old rows stay, so captures keep the prompt they searched.
    expect(db.prepare('SELECT COUNT(*) AS n FROM brand_prompts').get()).toEqual({ n: 3 })

    insertBrandFact(db, { id: 'f1', text: ' Plans  start at $29. ', source: null, addedAt: NOW })
    insertBrandFact(db, {
      id: 'f2',
      text: 'Replies come back to your inbox.',
      source: 'https://textbolt.com/features/',
      addedAt: '2026-10-19T12:01:00.000Z'
    })
    expect(listBrandFacts(db).map((fact) => fact.text)).toEqual([
      'Plans start at $29.',
      'Replies come back to your inbox.'
    ])
    expect(deleteBrandFact(db, 'f1')).toBe(true)
    expect(deleteBrandFact(db, 'f1')).toBe(false)
  })
})

describe('app migration 019_template_kinds_open', () => {
  test('keeps template rows and seeds the brand-sentiment templates as shipped defaults', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, APP_MIGRATIONS.slice(0, 18))
    seedShippedTemplatesBefore(db)
    migrate(db, APP_MIGRATIONS)
    expect(applied(db)).toContainEqual({ version: 19, name: '019_template_kinds_open' })
    expect(getTemplate(db, 'tpl-buyer-profile')?.kind).toBe('buyer_profile')
    const seeded = seedShippedTemplates(db)
    expect(seeded.map((template) => template.kind)).toEqual([
      'buyer_profile',
      'buyer_prompts',
      'brand_prompts',
      'coverage',
      'coverage_matrix',
      'page_audit',
      'coverage_fixes',
      'aio_gap',
      'answer_shape',
      'sentiment_claims',
      'sentiment_claims_v2',
      'sentiment_fact_check',
      'video_brief',
      'run_summary',
      ...TOPIC_TEMPLATE_KINDS.filter((kind) => templateKindLifecycle(kind) !== 'planned'),
      ...ASSISTANT_TEMPLATE_KINDS
    ])
    const claims = getTemplate(db, 'tpl-sentiment-claims')
    expect(claims?.isShipped).toBe(true)
    expect(claims?.isDefault).toBe(true)
    expect(claims?.version).toBe(1)
    expect(claims?.body.startsWith('Template: sentiment_claims.md')).toBe(true)
    expect(JSON.parse(claims?.schema ?? '{}')).toHaveProperty('required', [
      'brandsNamed',
      'reason',
      'claims'
    ])
    // A second seed is a no-op.
    seedShippedTemplates(db)
    expect(getTemplate(db, 'tpl-sentiment-claims')?.version).toBe(1)
  })
})

/** A version 18 database with the original three kinds already seeded. */
function seedShippedTemplatesBefore(db: ReturnType<typeof openSqliteDatabase>): void {
  db.prepare(
    `INSERT INTO templates (id, name, version, hash, body, "schema", settings_json, kind, notes,
       deleted_at, is_default, is_shipped, created_at, updated_at)
     VALUES ('tpl-buyer-profile', 'CiteFox default', 1, ?, 'body', NULL, NULL, 'buyer_profile',
       NULL, NULL, 1, 1, ?, NULL)`
  ).run(HASH, NOW)
}
