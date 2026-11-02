import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ReportDownloadRequest } from '@shared/ipc'
import { ONE_CHECK_KINDS } from '@shared/report/review'
import { expect, test } from 'vitest'
import { buildReviewDownload, reviewHtml } from '../../src/main/export/review'
import { htmlProblems, visibleText } from '../../src/main/export/review/quality'
import { openAppStorage } from '../../src/main/storage/app-storage'
import { closeProjectDatabase, openProjectDatabase } from '../../src/main/storage/project-files'
import { getProject } from '../../src/main/storage/records'
import { DEMO_NOW, DEMO_PROJECT, seedDemoProject } from './project'
import { SAMPLES, samplePage } from './sample-page'

/**
 * `npm run samples:build` (Docs/DEMO.md): one standalone sample report per ready
 * report kind in site/samples/<slug>/index.html, made by the app's own offline
 * HTML download (src/main/export/review, the same code as Download › Offline HTML)
 * on the demo project. Node only: no Electron, no browser, no network.
 */

const OUT = resolve(process.env.SAMPLES_OUT ?? 'site/samples')
const SITE_URL = ((url) => (url.endsWith('/') ? url : `${url}/`))(
  process.env.SITE_URL || 'https://spcaeo.github.io/citefox/'
)
const BANNED = /cloro|serpapi|jina|claude|anthropic|@gmail|\/home\/|\/Users\//i

test('writes one sample report per ready report kind', async () => {
  const dir = await seedDemoProject()
  const storage = openAppStorage(dir)
  const db = openProjectDatabase(storage.paths.projectsDirectory, DEMO_PROJECT.slug)
  try {
    const project = getProject(storage.db, DEMO_PROJECT.id)
    if (!project) throw new Error('The demo project is missing')
    for (const sample of SAMPLES) {
      const request: ReportDownloadRequest = {
        projectId: project.id,
        scope: { kind: 'project' },
        marketId: null,
        engine: 'all',
        from: ONE_CHECK_KINDS.has(sample.kind) ? null : 'first',
        to: null,
        report: sample.kind,
        format: 'html',
        table: null,
        timeZone: 'America/Toronto'
      }
      const build = buildReviewDownload(db, project, request, DEMO_NOW)
      const html = reviewHtml(build, DEMO_NOW, request.timeZone)
      expect(htmlProblems(html, build.variants), sample.kind).toEqual([])
      const text = visibleText(html)
      expect(text.length, sample.kind).toBeGreaterThan(2000)
      expect(text, sample.kind).not.toMatch(BANNED)
      const page = samplePage(html, sample, SITE_URL)
      const folder = join(OUT, sample.slug)
      rmSync(folder, { recursive: true, force: true })
      mkdirSync(folder, { recursive: true })
      writeFileSync(join(folder, 'index.html'), page)
      console.log(`samples/${sample.slug}/  ${(page.length / 1024).toFixed(0)} KB`)
    }
  } finally {
    closeProjectDatabase(db)
    storage.close()
    rmSync(dir, { recursive: true, force: true })
  }
}, 120_000)
