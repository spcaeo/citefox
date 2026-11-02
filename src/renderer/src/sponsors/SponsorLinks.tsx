import type { AnchorHTMLAttributes, JSX, ReactNode } from 'react'
import { sponsorHref, type Sponsor } from '@shared/sponsors'
import foxcueIcon from '../assets/sponsors/foxcue-icon.svg'
import foxcueLogo from '../assets/sponsors/foxcue-logo.svg'
import freshlycitedIcon from '../assets/sponsors/freshlycited-icon.svg'

/** Bundled logos (assets/sponsors). Nothing is fetched from the sponsor. */
const LOGOS: Record<Sponsor['id'], { wordmark: string | null; icon: string }> = {
  foxcue: { wordmark: foxcueLogo, icon: foxcueIcon },
  freshlycited: { wordmark: null, icon: freshlycitedIcon }
}

/** The sponsor's square mark. Decorative: the link around it carries the name. */
export function SponsorMark({
  sponsor,
  size = 20
}: {
  sponsor: Sponsor
  size?: number
}): JSX.Element {
  return (
    <img
      className="sponsor-mark"
      src={LOGOS[sponsor.id].icon}
      width={size}
      height={size}
      alt=""
      draggable={false}
    />
  )
}

/** The wordmark when the sponsor has one, else the mark and the name in text. */
export function SponsorLogo({
  sponsor,
  height = 18
}: {
  sponsor: Sponsor
  height?: number
}): JSX.Element {
  const wordmark = LOGOS[sponsor.id].wordmark
  if (wordmark) {
    return (
      <img
        className="sponsor-wordmark"
        src={wordmark}
        height={height}
        alt={sponsor.name}
        draggable={false}
      />
    )
  }
  return (
    <span className="sponsor-namemark">
      <SponsorMark sponsor={sponsor} size={height} />
      <span>{sponsor.name}</span>
    </span>
  )
}

/**
 * A link to a sponsor. It opens in the system browser (main denies the new
 * window and calls `shell.openExternal`), with only CiteFox's fixed utm query.
 */
export function SponsorLink({
  sponsor,
  children,
  ...rest
}: {
  sponsor: Sponsor
  children: ReactNode
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target' | 'rel'>): JSX.Element {
  return (
    <a href={sponsorHref(sponsor)} target="_blank" rel="noopener noreferrer sponsored" {...rest}>
      {children}
    </a>
  )
}
