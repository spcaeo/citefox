import { navigateHash, pageHash, projectHash, promptHash, topicHash } from '../shell/routes'
import type { PromptCheckRow } from '@shared/domain'
import { drawerHref, openDrawer } from '../shell/drawers'
import type { DrillScope, DrillTarget } from './types'

/** An http(s) URL, or null. Anything else (javascript:, file:, data:) never becomes a link. */
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}

/** The href for a target. Null for a URL that is not http(s). */
export function targetHref(target: DrillTarget): string | null {
  switch (target.kind) {
    case 'prompt':
      return inProject(
        target.projectId,
        promptHash(target.pageId, target.promptId, {
          marketId: target.marketId ?? null,
          runId: target.runId ?? null
        })
      )
    case 'page':
      return inProject(
        target.projectId,
        pageHash(target.pageId, target.tab ?? 'results', {
          marketId: target.marketId ?? null,
          runId: target.runId ?? null
        })
      )
    case 'topic':
      return inProject(
        target.projectId,
        topicHash(target.topicId, {
          tab: target.tab ?? null,
          filter: target.filter ?? null,
          marketId: target.marketId ?? null,
          runId: target.runId ?? null
        })
      )
    case 'url':
      return safeExternalUrl(target.url)
    case 'hash':
      return target.hash.startsWith('#') ? target.hash : `#${target.hash}`
    case 'drawer':
      return drawerHref(target.id, target.values ?? {})
  }
}

function inProject(projectId: string | null | undefined, hash: string): string {
  return projectId ? projectHash(projectId, hash) : hash
}

/** True when the target opens in the browser, not in CiteFox. */
export function isExternal(target: DrillTarget): boolean {
  return target.kind === 'url'
}

/** Opens a target: in-app routes by hash, URLs in the browser (the main process opens them). */
export function openTarget(target: DrillTarget): void {
  const href = targetHref(target)
  if (!href) return
  if (isExternal(target)) {
    window.open(href, '_blank', 'noopener,noreferrer')
    return
  }
  if (target.kind === 'drawer') {
    openDrawer(target.id, target.values ?? {})
    return
  }
  navigateHash(href)
}

/** Lists this many rows first; "Show all" adds the rest (REPORT-SPEC long tables). */
export const FIRST_ROWS = 100

/** A prompt row's target: Prompt detail in the drawer's market and check. */
export function promptTarget(scope: DrillScope, row: PromptCheckRow): DrillTarget | null {
  if (!scope.pageId) return null
  return {
    kind: 'prompt',
    pageId: scope.pageId,
    promptId: row.promptId,
    marketId: scope.marketId,
    runId: scope.runId
  }
}
