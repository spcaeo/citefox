import type { StoredSnapshot } from '../../src/main/storage/content-records'
import { seedProgressProject } from './progress-seed'

/**
 * Page change history on the Progress seed (TextBolt alerts page, checks Oct 5 and
 * Oct 19, Fix 1 live Oct 8), read through the real `recordPageRead`:
 * - Oct 5 and Oct 15 reads: the text moved (a page change nobody logged),
 * - an Oct 22 read whose page says "Updated Oct 21" with new sections and a
 *   reworded heading (the newest change),
 * - a pricing page last updated in June 2025 (not updated in 12 months).
 * No network, no AI.
 */

export const HISTORY_SEED = {
  pageId: 'page-1',
  stalePageId: 'page-pricing',
  staleUrl: 'https://textbolt.com/pricing/'
} as const

const BEFORE = [
  '# Text alerts for business',
  'TextBolt sends text alerts from email. Schedule them for Saturday morning. No developer required.',
  '## How it works',
  'Write an email to your alert address. TextBolt turns it into a text for every person on the list.',
  '## Who uses it',
  'Office managers, school offices and field teams.',
  '## Questions',
  'Does it work with Gmail? Yes, and with Outlook.'
].join('\n\n')

const AFTER = [
  '# Text alerts for business',
  'TextBolt sends text alerts from email. Schedule them for Saturday morning. No developer required.',
  '## How text alerts work',
  'Write an email to your alert address. TextBolt turns it into a text for every person on the list, and replies come back by email.',
  '## Pricing for scheduled texts',
  'Scheduled texts are on every plan. The Starter plan covers 500 texts a month.',
  '## Set up in five minutes',
  'Add your list, pick a sending name, and send a test alert to yourself.',
  '## Questions',
  'Does it work with Gmail? Yes, and with Outlook.'
].join('\n\n')

export async function seedPageHistory(userDataDir: string): Promise<void> {
  await seedProgressProject(userDataDir)
  const { openAppStorage } = await import('../../src/main/storage/app-storage')
  const { closeProjectDatabase, openProjectDatabase } =
    await import('../../src/main/storage/project-files')
  const { getStoredSnapshot, insertSnapshot } =
    await import('../../src/main/storage/snapshot-records')
  const { addPageMarket, insertPage } = await import('../../src/main/storage/pages')
  const { recordPageRead } = await import('../../src/main/pipeline/page-history')
  const { contentHash } = await import('../../src/main/pipeline/hash')
  const storage = openAppStorage(userDataDir)
  const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  try {
    const read = (
      snapshot: StoredSnapshot,
      readAt: string,
      dates: { publishedAt: string | null; modifiedAt: string | null }
    ): void => {
      recordPageRead(db, { pageId: snapshot.pageId, snapshot, readAt, ...dates })
    }
    const one = getStoredSnapshot(db, 'snap-1')
    const two = getStoredSnapshot(db, 'snap-2')
    if (one === null || two === null) throw new Error('The Progress seed has no page reads')
    const published = '2025-03-12T00:00:00.000Z'
    // The seeded snapshots stay; the history starts with a structured version of the page.
    const base = snapshotOf(one, 'snap-h1', '2026-10-15T12:00:00.000Z', BEFORE, contentHash)
    insertSnapshot(db, base)
    read(one, '2026-10-05T12:00:00.000Z', { publishedAt: published, modifiedAt: null })
    read(base, base.fetchedAt, {
      publishedAt: published,
      modifiedAt: '2026-06-04T00:00:00.000Z'
    })
    const next = snapshotOf(one, 'snap-h2', '2026-10-22T14:10:00.000Z', AFTER, contentHash)
    insertSnapshot(db, next)
    read(next, next.fetchedAt, { publishedAt: published, modifiedAt: '2026-10-21T00:00:00.000Z' })

    insertPage(db, {
      id: HISTORY_SEED.stalePageId,
      projectId: 'proj-1',
      url: HISTORY_SEED.staleUrl,
      title: 'Pricing',
      label: 'Pricing',
      folder: null,
      status: 'tracked',
      setupStep: null,
      intervalDays: 14,
      samples: 1,
      promptCount: 5,
      defaultMarketId: 'mkt-us',
      pinned: false,
      score: null,
      promptSetVersion: null
    })
    addPageMarket(db, {
      pageId: HISTORY_SEED.stalePageId,
      marketId: 'mkt-us',
      addedAt: '2026-10-05T12:00:00.000Z',
      baselineRunId: null
    })
    const pricing: StoredSnapshot = {
      ...snapshotOf(
        one,
        'snap-p1',
        '2026-10-19T12:00:00.000Z',
        '# Pricing\n\nStarter, Growth and Pro plans.',
        contentHash
      ),
      pageId: HISTORY_SEED.stalePageId,
      title: 'Pricing',
      h1: 'Pricing'
    }
    insertSnapshot(db, pricing)
    read(pricing, pricing.fetchedAt, {
      publishedAt: '2024-02-01T00:00:00.000Z',
      modifiedAt: '2025-06-04T00:00:00.000Z'
    })
  } finally {
    closeProjectDatabase(db)
    storage.close()
  }
}

function snapshotOf(
  like: StoredSnapshot,
  id: string,
  at: string,
  body: string,
  hash: (text: string) => string
): StoredSnapshot {
  return {
    ...like,
    id,
    fetchedAt: at,
    method: 'jina',
    bodyText: body,
    wordCount: body.split(/\s+/).filter(Boolean).length,
    contentHash: hash(body),
    summary: null
  }
}
