import type { JSX } from 'react'
import { sectionHash } from '../../shell/routes'
import { SectionHead } from '../../ui'

/** The scoring rules from the mock-up (FR-16.2, FR-16.3, FR-16.8). */
export function HowScored(): JSX.Element {
  return (
    <section className="st-card" aria-labelledby="st-how-h">
      <SectionHead id="st-how-h" title="How CiteFox scores sentiment" />
      <ul className="st-how">
        <li>
          A claim is one statement about one brand, such as &ldquo;has no free plan&rdquo;. One
          overview can hold claims about several brands.
        </li>
        <li>
          Each claim gets a theme, a short attribute and a tone: positive, neutral (a plain fact, no
          judgment) or negative.
        </li>
        <li>Net sentiment = (positive − negative) ÷ all claims × 100.</li>
        <li>Below 5 claims, CiteFox shows &ldquo;Not enough data&rdquo; instead of a score.</li>
        <li>
          Questions in other languages are read in that language; themes are named in English.
        </li>
        <li>Re-reading saved overviews runs no new searches.</li>
      </ul>
      <a href={sectionHash('templates')}>Edit the sentiment template</a>
    </section>
  )
}
