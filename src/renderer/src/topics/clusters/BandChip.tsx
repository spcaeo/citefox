import type { JSX } from 'react'
import { Chip } from '../../ui'
import { BAND_LABEL, BAND_TONE, type BandState } from './model'

/** "In band", "Below band" or "Above band"; nothing before an overview showed. */
export function BandChip({ band }: { band: BandState | null }): JSX.Element | null {
  if (band === null) return null
  return (
    <Chip size="sm" tone={BAND_TONE[band]}>
      {BAND_LABEL[band]}
    </Chip>
  )
}
