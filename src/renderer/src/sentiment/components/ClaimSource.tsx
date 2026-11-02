import type { JSX } from 'react'
import type { SentimentClaim } from '@shared/domain'
import { SOURCE_KIND_LABEL } from '../constants'
import { SourceUrl } from './drillBits'

/** A claim's nearest cited source as a browser link, or a note that it has none. */
export function ClaimSource({ claim }: { claim: SentimentClaim }): JSX.Element {
  if (!claim.url) return <span>No cited source next to this sentence</span>
  return (
    <span>
      Nearest source: <SourceUrl url={claim.url} />
      {claim.sourceKind ? ` · ${SOURCE_KIND_LABEL[claim.sourceKind]}` : ''}
    </span>
  )
}
