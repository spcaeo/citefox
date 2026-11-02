import { ENGINE_LABEL } from '@shared/domain'
import type { CitationNews, ResultsChanged } from '@shared/ipc'

export interface CelebratorDeps {
  /** False while the window is in the background: the celebration waits for `resume`. */
  isActive(): boolean
  /** Settings › Appearance › "Celebrate citations". Off: nothing at all. */
  enabled(): boolean
  show(news: CitationNews): void
}

export interface Celebrator {
  receive(event: ResultsChanged): void
  /** The window is back in front: play what waited, once. */
  resume(): void
}

/**
 * Celebrates the user's own site being cited while a check runs, once per check
 * (owner, 2026-10-29: "it should be only once"). The first citation of a check, on
 * any engine and for any question or keyword, gets the moment; later citations in
 * that check and named-without-a-link get nothing. In the background the first
 * citation waits and plays when the window comes back.
 */
export function createCelebrator(deps: CelebratorDeps): Celebrator {
  const celebratedJobs = new Set<string>()
  let waiting: CitationNews | null = null

  return {
    receive(event) {
      const news = event.citation
      if (news?.kind !== 'cited' || !deps.enabled()) return
      if (celebratedJobs.has(event.jobId)) return
      celebratedJobs.add(event.jobId)
      if (deps.isActive()) deps.show(news)
      else waiting ??= news
    },
    resume() {
      if (waiting === null || !deps.isActive()) return
      const news = waiting
      waiting = null
      if (deps.enabled()) deps.show(news)
    }
  }
}

/** What the celebration card says. */
export interface CelebrationText {
  headline: string
  /** Which engine linked the page, and where. */
  line: string
  /** The question or keyword, quoted; empty when the check sent none. */
  prompt: string
}

export function celebrationText(news: CitationNews): CelebrationText {
  const engine = news.engine === null ? 'An AI engine' : ENGINE_LABEL[news.engine]
  const link = news.position === null ? '' : ` as link #${news.position}`
  return {
    headline: news.firstEver ? `${news.brand}'s first citation!` : `${news.brand} was cited!`,
    line: `${engine} linked your page${link}`,
    prompt: news.promptText ? `“${news.promptText}”` : ''
  }
}
