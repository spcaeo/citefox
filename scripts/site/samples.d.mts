export interface SampleInfo {
  /** The ready report kind (src/shared/report/review REPORT_KINDS). */
  kind: 'visibility' | 'changed' | 'impact' | 'pitch' | 'content' | 'rival'
  /** Folder under site/samples/ (also the URL). */
  slug: string
  title: string
  /** The goal it answers, close to Reports › By goal. */
  goal: string
  /** One sentence for the gallery card and the meta description. */
  description: string
}

export declare const SAMPLES: readonly SampleInfo[]
