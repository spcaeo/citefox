import { useEffect, useState, type MutableRefObject } from 'react'
import type { SetupDraft } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import type { SiteReadClient } from '../../fill/types'
import type { SetupSectionClient } from '../sectionClient'
import { competitorsSoFar } from './readLive'
import { createReadRunner, idleRead, type ReadStage, type SiteReadState } from './readRunner'

export { readFraction } from './readRunner'
export type { ReadStage, ReadStageId, ReadStageState, SiteReadState } from './readRunner'

/**
 * Step 3's "✦ Read my website" (see `readRunner.ts` for the order of the work). It lives
 * in OnboardingApp, so it keeps running when the user steps back or away, and searches
 * that finish after the step moved on still fill in.
 */

export interface SiteRead extends SiteReadState {
  run: () => void
  /** Stops waiting for the read (its answer is dropped), back to idle. */
  abandon: () => void
  /** Searches one product's competitors again. */
  retry: (productId: string) => void
  /** Moves on now, once only competitor searches are left; they fill in when they finish. */
  finishNow: () => void
}

/** The step's line for a stage, in plain words. */
export function stageLabel(
  stage: ReadStage,
  read: Pick<SiteReadState, 'pagesRead' | 'pagesTried' | 'live'>
): string {
  const running = stage.state === 'running'
  const finished = stage.state === 'done' || stage.state === 'warning'
  switch (stage.id) {
    case 'pages':
      if (finished) return `Read ${read.pagesRead} of your pages`
      return running && read.pagesTried > 0
        ? `Reading your pages (${read.pagesRead} read so far)`
        : 'Reading your pages'
    case 'site': {
      const products = read.live.site?.products.length ?? 0
      if (!finished) return 'Finding what you sell'
      return products === 0
        ? 'Could not tell what you sell'
        : `What you sell · ${pluralize(products, 'product')}`
    }
    case 'competitors': {
      const found = competitorsSoFar(read.live).length
      if (!finished) return 'Searching the web for competitors'
      return `Competitors · ${found} found`
    }
    case 'buyers':
      return finished
        ? `Who buys from you · ${read.live.buyers.length} found`
        : 'Finding who buys from you'
    case 'triggers':
      return finished
        ? `What sends them looking · ${read.live.triggers.length} found`
        : 'Finding what sends them looking'
  }
}

export function useSiteRead({
  client,
  sections,
  draftRef,
  onDraft,
  onDone
}: {
  client: SiteReadClient
  sections: SetupSectionClient
  /** The newest draft, read when each call starts. */
  draftRef: MutableRefObject<SetupDraft>
  onDraft: (update: (current: SetupDraft) => SetupDraft) => void
  /** The read finished (or stopped waiting) and its answers are in the draft. */
  onDone: () => void
}): SiteRead {
  const [state, setState] = useState<SiteReadState>(idleRead)
  const [runner] = useState(() => createReadRunner(setState))
  useEffect(() => {
    runner.setDeps({ client, sections, draftRef, onDraft, onDone })
  })
  useEffect(() => {
    runner.attach()
    return () => runner.detach()
  }, [runner])
  return {
    ...state,
    run: runner.run,
    abandon: runner.abandon,
    retry: runner.retry,
    finishNow: runner.finishNow
  }
}
