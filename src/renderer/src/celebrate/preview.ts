import type { CitationNews } from '@shared/ipc'

/** What the sample card names: the open project's brand and site, when there is one. */
export interface PreviewSample {
  brand: string | null
  /** The project's domain, such as `textbolt.com`. */
  site: string | null
}

const listeners = new Set<(news: CitationNews) => void>()

/** The sample citation the Preview button shows. */
export function previewNews(sample: PreviewSample): CitationNews {
  return {
    kind: 'cited',
    brand: sample.brand ?? 'Your site',
    promptText: 'A sample question your buyers ask',
    position: 1,
    engine: 'google_aio',
    url: sample.site ? `https://${sample.site}/` : null,
    firstEver: false
  }
}

/**
 * Settings › Appearance › Preview: plays the whole celebration with sample text, so it
 * can be seen without a paid check. It skips the once-per-check rule and plays even
 * with "Celebrate citations" off; "Play a sound" and reduced motion still apply.
 */
export function previewCelebration(sample: PreviewSample): void {
  const news = previewNews(sample)
  for (const listener of listeners) listener(news)
}

/** The shell's CelebrationHost listens here. */
export function onCelebrationPreview(listener: (news: CitationNews) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
