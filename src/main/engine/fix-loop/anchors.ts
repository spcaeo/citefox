import type { AnchorText, SuggestAnchorsRequest, SuggestAnchorsResult } from '@shared/ipc'
import { ensureShippedAssists } from '../../assist/definitions'
import { runAssist } from '../../assist/run'
import { redactString } from '../../logging/redact'
import { listPageAiTexts } from '../../storage/fix-loop-records'
import { getPage } from '../../storage/pages'
import type { EngineHost } from '../host'
import { aiLimiter, settleEach } from '../parallel'
import { withProject } from '../project-db'
import { isOpenPage } from './runs'

/**
 * `fixes:suggestAnchors`: one `fixes.anchorText` assist per page that has no cached
 * anchor (every page with `refresh`), Settings' "Calls at once" pages at a time so the
 * Claude plan is not flooded. A failed page is reported with its reason, in page
 * order; the others still get theirs.
 */
export async function suggestAnchors(
  host: EngineHost,
  request: SuggestAnchorsRequest
): Promise<SuggestAnchorsResult> {
  const channel = 'fixes:suggestAnchors'
  ensureShippedAssists()
  const wanted = await withProject(host, request.projectId, channel, ({ db, project }) => {
    const cached = new Set(listPageAiTexts(db, 'anchor').map((text) => text.pageId))
    return request.pageIds.filter((pageId) => {
      const page = getPage(db, pageId, project.id)
      return page !== null && isOpenPage(page) && (request.refresh || !cached.has(pageId))
    })
  })
  const asks = await settleEach(wanted, aiLimiter(host.settings().claudeConcurrency), (pageId) =>
    runAssist(host, {
      assistId: 'fixes.anchorText',
      projectId: request.projectId,
      pageId,
      marketId: null,
      promptId: null,
      // `refresh` skips the cached anchor, so Claude writes a new one.
      inputs: request.refresh ? { refresh: true } : {},
      instruction: null
    })
  )
  const failed = asks.flatMap((ask, index) =>
    ask.ok ? [] : [{ pageId: wanted[index] ?? '', message: failureText(host, ask.error) }]
  )
  const asked = new Set(request.pageIds)
  const anchors = await withProject(host, request.projectId, channel, ({ db }) =>
    listPageAiTexts(db, 'anchor')
      .filter((text) => asked.has(text.pageId))
      .map((text): AnchorText => ({ pageId: text.pageId, text: text.text, savedAt: text.savedAt }))
  )
  return { anchors, failed }
}

function failureText(host: EngineHost, error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  const plain = message.replace(/^[a-z]+:[A-Za-z]+:\s*/u, '').trim()
  const safe = redactString(plain, { secrets: host.knownSecrets() })
  return safe.length === 0 || safe !== plain
    ? 'CiteFox AI could not suggest an anchor. Try again.'
    : safe
}
