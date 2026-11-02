import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { packageHtmlReport, renderHtmlReport } from '.'
import { fullReportModel } from './report-model.test-helper'

/**
 * Writes sample HTML reports for review. Runs only with CITEFOX_WRITE_SAMPLES=1;
 * CITEFOX_SAMPLE_DIR overrides the folder.
 */
const SAMPLE_DIR = process.env.CITEFOX_SAMPLE_DIR ?? join(tmpdir(), 'citefox-sample-html')

describe.skipIf(process.env.CITEFOX_WRITE_SAMPLES !== '1')('sample HTML reports', () => {
  test('writes the page and project samples', () => {
    mkdirSync(SAMPLE_DIR, { recursive: true })
    const samples = [
      { name: 'page', model: fullReportModel() },
      { name: 'project', model: fullReportModel({ scope: 'project', pageIds: [] }) }
    ]
    for (const sample of samples) {
      const html = renderHtmlReport(sample.model, { secrets: [] })
      const zip = packageHtmlReport(sample.model, html, 'zip')
      writeFileSync(join(SAMPLE_DIR, `${sample.name}-index.html`), html)
      writeFileSync(join(SAMPLE_DIR, `${sample.name}-${zip.filename}`), zip.bytes)
      expect(zip.bytes.length).toBeGreaterThan(html.length)
    }
    writeFileSync(
      join(SAMPLE_DIR, 'index.html'),
      renderHtmlReport(samples[0]!.model, { secrets: [] })
    )
  })
})
