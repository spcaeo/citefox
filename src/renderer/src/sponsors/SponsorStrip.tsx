import { useSyncExternalStore, type JSX } from 'react'
import { isStripHidden, setStripHidden, subscribeStrip } from './stripState'
import { sponsorOf } from '@shared/sponsors'
import { SponsorLink, SponsorLogo } from './SponsorLinks'

/**
 * The gold sponsor's strip, under the top bar across the content column:
 * "Sponsored by", the logo, one line, and one call to action in the sponsor's
 * colours. A thin yellow chevron edge marks it. No motion. "Hide for now" folds
 * it to a 4px line for this session.
 */
export function SponsorStrip(): JSX.Element {
  const isHidden = useSyncExternalStore(subscribeStrip, isStripHidden)
  const sponsor = sponsorOf('gold')

  if (isHidden) {
    return (
      <div className="sponsor-strip-min" role="complementary" aria-label="Gold sponsor">
        <button
          type="button"
          className="sponsor-strip-show"
          aria-label={`Show the ${sponsor.name} sponsor line again`}
          title="Show sponsor"
          onClick={() => setStripHidden(false)}
        />
      </div>
    )
  }

  return (
    <aside className="sponsor-strip" aria-label="Gold sponsor" data-sponsor={sponsor.id}>
      <span className="sponsor-chevrons" aria-hidden="true" />
      <span className="sponsor-strip-label">Sponsored by</span>
      <SponsorLink
        sponsor={sponsor}
        className="sponsor-strip-logo"
        aria-label={`${sponsor.name} (opens in your browser)`}
      >
        <SponsorLogo sponsor={sponsor} height={18} />
      </SponsorLink>
      <p className="sponsor-strip-line">
        <span className="sponsor-strip-tagline">{sponsor.tagline}.</span>{' '}
        <span className="sponsor-strip-desc">{sponsor.description}</span>
      </p>
      <SponsorLink
        sponsor={sponsor}
        className="sponsor-strip-cta"
        aria-label={`${sponsor.cta} at ${sponsor.name} (opens in your browser)`}
      >
        {sponsor.cta}
      </SponsorLink>
      <button type="button" className="sponsor-strip-hide" onClick={() => setStripHidden(true)}>
        Hide for now
      </button>
    </aside>
  )
}
