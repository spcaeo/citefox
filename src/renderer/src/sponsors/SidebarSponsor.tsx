import type { JSX } from 'react'
import { sponsorOf } from '@shared/sponsors'
import { SponsorLink, SponsorMark } from './SponsorLinks'

/**
 * The silver sponsor's card at the foot of the sidebar: navy with the gold
 * mark, "Silver sponsor", one line and a link. In the collapsed rail only the
 * mark shows, with a tooltip.
 */
export function SidebarSponsor({ collapsed = false }: { collapsed?: boolean }): JSX.Element {
  const sponsor = sponsorOf('silver')
  if (collapsed) {
    return (
      <SponsorLink
        sponsor={sponsor}
        className="side-sponsor-mini"
        aria-label={`${sponsor.name}, silver sponsor: ${sponsor.cta} (opens in your browser)`}
        data-tip={`${sponsor.name} · Silver sponsor`}
      >
        <SponsorMark sponsor={sponsor} size={28} />
      </SponsorLink>
    )
  }
  return (
    <aside className="side-sponsor" aria-label="Silver sponsor">
      <div className="side-sponsor-head">
        <SponsorMark sponsor={sponsor} size={28} />
        <span className="side-sponsor-id">
          <span className="side-sponsor-tier">Silver sponsor</span>
          <span className="side-sponsor-name">{sponsor.name}</span>
        </span>
      </div>
      <p className="side-sponsor-line">{sponsor.tagline}</p>
      <SponsorLink
        sponsor={sponsor}
        className="side-sponsor-cta"
        aria-label={`${sponsor.cta} at ${sponsor.name} (opens in your browser)`}
      >
        {sponsor.cta} →
      </SponsorLink>
    </aside>
  )
}
