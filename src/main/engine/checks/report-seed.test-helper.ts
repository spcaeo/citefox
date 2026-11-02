/** One project with a read page, buyer profile, prompt set and a finished check (test-only). */

import { contentHash } from '../../pipeline/hash'
import {
  finishStoredRun,
  insertStoredCheckJob,
  insertStoredRun,
  insertStoredSerpResult
} from '../../storage/check-records'
import { insertBuyerProfile, insertPromptSet, insertSnapshot } from '../../storage/content-records'
import type { SqliteDatabase } from '../../storage/database'
import { addPageMarket, insertPage } from '../../storage/pages'
import { insertMarket, writeProjectProfile } from '../../storage/project-profile'
import { BODY, buyer, NOW, page, prompt, snapshot } from './reports.test-helper'

/**
 * Page `page-1` in `mkt-us` and `mkt-uk`. `mkt-us` has finished run `run-us` where
 * the overview leaves the page out (one gap prompt). `mkt-uk` has no check.
 */
export function seedCheckedProject(db: SqliteDatabase): void {
  writeProjectProfile(db, {
    includeSubdomains: false,
    brandNames: ['TextBolt'],
    competitors: ['SimpleTexting'],
    market: {
      id: 'mkt-us',
      country: 'US',
      language: 'en',
      location: null,
      device: 'desktop',
      localWording: false,
      serpapiLocation: null
    }
  })
  insertMarket(db, {
    id: 'mkt-uk',
    country: 'GB',
    language: 'en',
    location: null,
    device: 'desktop',
    localWording: false,
    serpapiLocation: null
  })
  insertPage(db, page())
  for (const marketId of ['mkt-us', 'mkt-uk']) {
    addPageMarket(db, { pageId: 'page-1', marketId, addedAt: NOW, baselineRunId: null })
  }
  insertSnapshot(db, snapshot())
  insertBuyerProfile(db, buyer())
  insertPromptSet(
    db,
    {
      id: 'pset-1',
      pageId: 'page-1',
      version: 1,
      savedAt: NOW,
      icpId: 'icp-1',
      templateId: 'tpl-buyer-prompts',
      templateName: 'CiteFox default',
      templateHash: contentHash('template'),
      templateUpdatedAt: null,
      prompts: [
        prompt(
          'prompt-gap',
          1,
          'Gateway',
          'What happens when a carrier gateway shuts down?',
          'mkt-us',
          'en'
        )
      ]
    },
    ['TextBolt']
  )
  insertStoredCheckJob(db, {
    id: 'job-1',
    startedAt: NOW,
    status: 'running',
    pageIds: ['page-1'],
    marketIds: null,
    promptIds: null,
    reason: 'manual',
    message: null,
    nextStep: null
  })
  const startedAt = '2026-10-19T12:03:00.000Z'
  insertStoredRun(db, {
    id: 'run-us',
    jobId: 'job-1',
    pageId: 'page-1',
    promptSetId: 'pset-1',
    snapshotId: 'snap-1',
    marketId: 'mkt-us',
    startedAt,
    kind: 'baseline',
    partial: false,
    samples: 1,
    contentHash: contentHash(BODY)
  })
  finishStoredRun(db, 'run-us', startedAt, 'finished')
  insertStoredSerpResult(db, {
    id: 'serp-run-us',
    runId: 'run-us',
    promptId: 'prompt-gap',
    sampleNo: 1,
    keyId: null,
    hasAio: true,
    neededFollowup: false,
    searches: 1,
    status: 'not_cited',
    named: false,
    citedUrl: null,
    position: null,
    aioText: 'Carrier gateways shut down and email-to-text stops.',
    errorCode: null,
    message: null,
    nextStep: null,
    rawSearchJson: null,
    rawAioJson: null,
    references: [
      {
        id: 'ref-us',
        position: 1,
        url: 'https://simpletexting.com/blog/text-employees/',
        normalizedUrl: 'https://simpletexting.com/blog/text-employees/',
        domain: 'simpletexting.com',
        title: 'Text employees',
        classification: 'competitor',
        untracked: false,
        sourceType: 'web'
      }
    ]
  })
}
