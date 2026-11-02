import { useSyncExternalStore, type JSX } from 'react'
import { sponsorOf } from '@shared/sponsors'
import { IconButton } from '../ui/IconButton'
import { isStripHidden, setStripHidden, subscribeStrip } from './stripState'
import { SponsorLink, SponsorLogo } from './SponsorLinks'

/**
 * The gold sponsor's card at the end of every screen (Header.dc.html, item 7),
 * after the content in the main scroll: "Sponsor", the FoxCue logo, its line
 * and one call to action in FoxCue's colours, with the yellow chevron edge.
 * No motion. ✕ ("Hide for now") folds it to a thin yellow line for this run
 * of the app, shared with the first-run strip.
 */
export function SponsorCard(): JSX.Element {
  const isHidden = useSyncExternalStore(subscribeStrip, isStripHidden)
  const sponsor = sponsorOf('gold')

  if (isHidden) {
    return (
      <div className="sponsor-card-min" role="complementary" aria-label="Gold sponsor">
        <button
          type="button"
          className="sponsor-strip-show"
          aria-label={`Show the ${sponsor.name} sponsor again`}
          title="Show sponsor"
          onClick={() => setStripHidden(false)}
        />
      </div>
    )
  }

  return (
    <aside className="sponsor-card" aria-label="Gold sponsor" data-sponsor={sponsor.id}>
      <span className="sponsor-chevrons" aria-hidden="true" />
      <span className="sponsor-card-label">Sponsor</span>
      <SponsorLink
        sponsor={sponsor}
        className="sponsor-strip-logo"
        aria-label={`${sponsor.name} (opens in your browser)`}
      >
        <SponsorLogo sponsor={sponsor} height={18} />
      </SponsorLink>
      <p className="sponsor-card-line">
        <span className="sponsor-strip-tagline">{sponsor.tagline}.</span>{' '}
        <span className="sponsor-card-desc">{sponsor.description}</span>
      </p>
      <SponsorLink
        sponsor={sponsor}
        className="sponsor-strip-cta"
        aria-label={`${sponsor.cta} at ${sponsor.name} (opens in your browser)`}
      >
        {sponsor.cta}
      </SponsorLink>
      <IconButton
        icon="x"
        size="sm"
        label="Hide for now"
        title="Hide for now"
        className="sponsor-card-hide"
        onClick={() => setStripHidden(true)}
      />
    </aside>
  )
}
