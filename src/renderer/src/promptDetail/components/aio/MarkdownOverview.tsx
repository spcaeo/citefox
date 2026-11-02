import { useMemo, type JSX } from 'react'
import type { AioSource } from '@shared/aio-overview'
import type { BrandLens } from '@shared/brand-mentions'
import type { AioReference } from '@shared/domain'
import { AnswerView } from '../../../components/answer/AnswerView'
import { Sparkle } from './GoogleOverview'
import { SourcesRail } from './SourcesRail'
import { sourceViews } from './model'

/**
 * The overview from cloro's markdown, laid out as Google shows it: the "AI
 * Overview" label, the answer with its headings, lists, tables and source
 * chips, and the scored sources in the rail beside it. Used when no SerpApi
 * overview with blocks is stored.
 */
export function MarkdownOverview({
  markdown,
  references,
  lens = null
}: {
  markdown: string
  /** The sample's scored sources, in Google's order. */
  references: readonly AioReference[]
  lens?: BrandLens | null
}): JSX.Element {
  const views = useMemo(() => sourceViews(references.map(railSource), references), [references])
  return (
    <div className={views.length > 0 ? 'aio-g' : 'aio-g aio-g-solo'}>
      <div className="aio-g-text aio-g-md">
        <p className="aio-g-head">
          <Sparkle />
          <span>AI Overview</span>
        </p>
        <AnswerView markdown={markdown} sources={references} lens={lens} />
      </div>
      {views.length > 0 ? <SourcesRail views={views} active={[]} lens={lens} /> : null}
    </div>
  )
}

function railSource(reference: AioReference): AioSource {
  return {
    index: reference.position,
    title: reference.title,
    url: reference.url,
    snippet: null,
    source: null,
    icon: null,
    thumbnail: null
  }
}
