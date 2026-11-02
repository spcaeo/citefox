import type { JSX } from 'react'
import { SponsorStrip } from '../sponsors'

/**
 * The gold sponsor's strip. Kept for screens that draw their own chrome (the
 * results harness); the app shell ends every screen with the sponsor card.
 */
export function SponsorSlot(): JSX.Element {
  return <SponsorStrip />
}
