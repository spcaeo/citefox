import type { JSX } from 'react'

/** A four-point sparkle centred on (x, y). */
function sparkle(x: number, y: number, r: number): string {
  const w = r * 0.28
  return `M${x} ${y - r} Q${x + w} ${y - w} ${x + r} ${y} Q${x + w} ${y + w} ${x} ${y + r} Q${x - w} ${y + w} ${x - r} ${y} Q${x - w} ${y - w} ${x} ${y - r}Z`
}

/**
 * The card's picture: a fox-orange trophy with a star, a soft glow behind it and
 * sparkles around it. Our own drawing, in the theme's colour tokens (celebrate.css),
 * so it follows light and dark.
 */
export function CelebrationArt(): JSX.Element {
  return (
    <svg className="celebrate-art" viewBox="0 0 160 160" aria-hidden="true">
      <circle className="celebrate-art-glow" cx="80" cy="74" r="52" />
      <g className="celebrate-art-trophy">
        <path
          className="celebrate-art-handle"
          d="M54 46 H40 a14 14 0 0 0 18 26 M106 46 H120 a14 14 0 0 1 -18 26"
        />
        <path className="celebrate-art-cup" d="M50 36 H110 V60 a30 30 0 0 1 -60 0 Z" />
        <path className="celebrate-art-cup-shine" d="M58 42 V60 a22 22 0 0 0 8 17" />
        <rect className="celebrate-art-cup" x="73" y="88" width="14" height="14" />
        <rect className="celebrate-art-base" x="58" y="102" width="44" height="10" rx="3" />
        <rect className="celebrate-art-base" x="50" y="112" width="60" height="14" rx="4" />
        <path
          className="celebrate-art-star"
          d="M80 46 l4.4 9 9.9 1.4 -7.2 7 1.7 9.8 -8.8 -4.6 -8.8 4.6 1.7 -9.8 -7.2 -7 9.9 -1.4z"
        />
      </g>
      <g className="celebrate-art-sparkles">
        <path className="celebrate-art-sparkle is-a" d={sparkle(30, 34, 10)} />
        <path className="celebrate-art-sparkle is-b" d={sparkle(132, 30, 8)} />
        <path className="celebrate-art-sparkle is-c" d={sparkle(136, 96, 7)} />
        <path className="celebrate-art-sparkle is-d" d={sparkle(24, 100, 6)} />
        <circle className="celebrate-art-dot" cx="118" cy="62" r="3" />
        <circle className="celebrate-art-dot" cx="44" cy="70" r="2.5" />
        <circle className="celebrate-art-dot" cx="104" cy="16" r="2.5" />
      </g>
    </svg>
  )
}
