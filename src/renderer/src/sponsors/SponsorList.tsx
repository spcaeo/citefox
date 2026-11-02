import type { JSX } from 'react'
import { SPONSORS } from '@shared/sponsors'
import { WHY_SPONSORS } from './copy'
import { SponsorLink, SponsorMark } from './SponsorLinks'

/** Both sponsors with their marks, tier and link (Settings › About). */
export function SponsorList(): JSX.Element {
  return (
    <div className="sponsor-list">
      <ul className="sponsor-list-items">
        {SPONSORS.map((sponsor) => (
          <li key={sponsor.id} className="sponsor-list-item">
            <SponsorMark sponsor={sponsor} size={32} />
            <span className="sponsor-list-copy">
              <span className="sponsor-list-name">
                {sponsor.name}{' '}
                <span className="sponsor-list-tier">
                  {sponsor.tier === 'gold' ? 'Gold sponsor' : 'Silver sponsor'}
                </span>
              </span>
              <span className="sponsor-list-desc">{sponsor.description}</span>
            </span>
            <SponsorLink
              sponsor={sponsor}
              className="sponsor-list-link"
              aria-label={`Visit ${sponsor.name} (opens in your browser)`}
            >
              Visit {sponsor.name}
            </SponsorLink>
          </li>
        ))}
      </ul>
      <p className="sponsor-list-why">
        <strong>Why sponsors?</strong> {WHY_SPONSORS}
      </p>
    </div>
  )
}
