import type { JSX } from 'react'

/**
 * The v2 icon set (Mockups/v2/Theme.dc.html): 24-unit line icons drawn with a
 * 1.75 stroke in `currentColor`. Always decorative (`aria-hidden`); the control
 * that holds an icon carries the accessible name.
 */
const PATHS = {
  sparkle: [
    'M12 3.5l1.7 5 5 1.7-5 1.7-1.7 5-1.7-5-5-1.7 5-1.7z',
    'M18.5 15.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z'
  ],
  dots: [],
  grip: ['M5 9h14', 'M5 15h14'],
  pin: [
    'M12 17v5',
    'M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2v.8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9a2 2 0 0 1-1.1-1.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z'
  ],
  'chevron-down': ['m6 9 6 6 6-6'],
  'chevron-up': ['m18 15-6-6-6 6'],
  'chevron-right': ['m9 6 6 6-6 6'],
  'chevron-left': ['m15 6-6 6 6 6'],
  'sort-both': ['m7 15 5 5 5-5', 'm7 9 5-5 5 5'],
  'arrow-down': ['M12 5v14M6 13l6 6 6-6'],
  'arrow-up': ['M12 19V5M6 11l6-6 6 6'],
  'arrow-left': ['M19 12H5M11 6l-6 6 6 6'],
  'arrow-right': ['M5 12h14M13 6l6 6-6 6'],
  x: ['M18 6 6 18M6 6l12 12'],
  check: ['M20 6 9 17l-5-5'],
  plus: ['M12 5v14M5 12h14'],
  search: ['m20 20-3.5-3.5'],
  compass: ['m15.5 8.5-2 5-5 2 2-5z'],
  wand: [
    'm4 20 10-10',
    'M15 3.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9zM19.5 11l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z'
  ],
  bulb: [
    'M9 18h6M10 21h4',
    'M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z'
  ],
  prioritise: ['M3 6h11M3 12h7M3 18h4M18 4v16M15 17l3 3 3-3'],
  merge: ['M7 3v5a5 5 0 0 0 5 5h0a5 5 0 0 1 5 5v3M17 3v5a5 5 0 0 1-3 4.6'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z'],
  'eye-off': [
    'M9.88 9.88a3 3 0 1 0 4.24 4.24',
    'M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68',
    'M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61',
    'm2 2 20 20'
  ],
  target: [],
  external: [
    'M14 4h6v6',
    'M20 4 10 14',
    'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'
  ],
  pencil: ['M4 20h4L19 9l-4-4L4 16z', 'm13.5 6.5 4 4'],
  layers: ['m12 3 9 5-9 5-9-5z', 'm3 13 9 5 9-5'],
  sliders: ['M4 7h10M18 7h2M4 17h4M12 17h8', 'M14 5v4M8 15v4'],
  filter: ['M4 5h16l-6 7.5V18l-4 2v-7.5z'],
  'filter-x': ['M3 5h12l-4.5 5.6V17l-3 1.5v-6.9z', 'M16 12l5 5M21 12l-5 5'],
  trash: ['M4 7h16M10 11v6M14 11v6', 'M6 7l1 13h10l1-13M9 7V4h6v3'],
  warning: ['M12 4 2.5 20h19z', 'M12 10v4M12 17h.01'],
  refresh: [
    'M20 11a8 8 0 0 0-14.6-4.5L4 8',
    'M4 4v4h4',
    'M4 13a8 8 0 0 0 14.6 4.5L20 16',
    'M20 20v-4h-4'
  ],
  download: ['M12 4v11M7 10l5 5 5-5', 'M5 20h14'],
  printer: [
    'M7 9V3.5h10V9',
    'M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2',
    'M7 14h10v6.5H7z'
  ],
  mail: ['M3.5 6h17v12h-17z', 'm3.5 6.5 8.5 6.5 8.5-6.5'],
  link: [
    'M10 13.5a4.5 4.5 0 0 0 6.4.4l2.6-2.6a4.5 4.5 0 0 0-6.4-6.4L11.2 6.3',
    'M14 10.5a4.5 4.5 0 0 0-6.4-.4L5 12.7a4.5 4.5 0 0 0 6.4 6.4l1.4-1.4'
  ],
  table: ['M3.5 4.5h17v15h-17z', 'M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10'],
  'panel-left': ['M9 4v16'],
  inbox: ['M3 13h5l1.5 3h5L16 13h5', 'M5.5 5h13L21 13v6H3v-6z'],
  copy: ['M16 8V5.5A2 2 0 0 0 14 3.5H5.5a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2H8'],
  trend: ['m3 17 6-6 4 4 8-8M15 7h6v6'],
  'trend-down': ['m3 7 6 6 4-4 8 8M15 17h6v-6'],
  file: [
    'M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z',
    'M14 3.5v5h5M9 13h6M9 16.5h4'
  ],
  clipboard: [
    'M9 4.5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-12a2 2 0 0 0-2-2h-2',
    'M9 3.5h6v3H9zM9 11h6M9 15h4'
  ],
  crosshair: ['M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4'],
  chart: ['M4 20h16M7 16v-5M12 16V7M17 16v-3'],
  list: ['M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01'],
  tree: ['M4 5h16M9 12h11M9 19h11', 'M4 5v14M4 12h5M4 19h5'],
  grid: ['M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'],
  upload: ['M12 15V4M7 9l5-5 5 5', 'M5 20h14'],
  pause: ['M9 6v12', 'M15 6v12'],
  play: ['M8 5.5v13l10.5-6.5z'],
  bolt: ['M13 3 5 14h6l-1 7 8-11h-6z'],
  folder: ['M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z'],
  activity: ['M3 12h4l3-7 4 14 3-7h4'],
  sun: [
    'M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4'
  ],
  moon: ['M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z'],
  'book-open': [
    'M2.5 4.5h6a3.5 3.5 0 0 1 3.5 3.5v12a2.5 2.5 0 0 0-2.5-2.5h-7z',
    'M21.5 4.5h-6A3.5 3.5 0 0 0 12 8v12a2.5 2.5 0 0 1 2.5-2.5h7z'
  ],
  monitor: ['M8.5 20.5h7M12 16.5v4'],
  gauge: ['m12 14 4-4', 'M3.3 19a10 10 0 1 1 17.4 0'],
  settings: [
    'M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2z'
  ]
} as const satisfies Record<string, readonly string[]>

export type UiIconName = keyof typeof PATHS

/** Shapes that are not plain paths. */
function extras(name: UiIconName): JSX.Element | null {
  switch (name) {
    case 'dots':
      return (
        <>
          <circle cx="5" cy="12" r="1.2" fill="currentColor" />
          <circle cx="12" cy="12" r="1.2" fill="currentColor" />
          <circle cx="19" cy="12" r="1.2" fill="currentColor" />
        </>
      )
    case 'search':
      return <circle cx="11" cy="11" r="7" />
    case 'compass':
      return <circle cx="12" cy="12" r="9" />
    case 'eye':
      return <circle cx="12" cy="12" r="3" />
    case 'target':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1" />
        </>
      )
    case 'panel-left':
      return <rect x="3" y="4" width="18" height="16" rx="2" />
    case 'crosshair':
      return <circle cx="12" cy="12" r="7" />
    case 'copy':
      return <rect x="8" y="8" width="12.5" height="12.5" rx="2" />
    case 'settings':
      return <circle cx="12" cy="12" r="3" />
    case 'sun':
      return <circle cx="12" cy="12" r="4" />
    case 'monitor':
      return <rect x="3" y="4" width="18" height="12.5" rx="2" />
    default:
      return null
  }
}

export function UiIcon({
  name,
  size = 16,
  className
}: {
  name: UiIconName
  /** Pixel size. Default 16. */
  size?: 12 | 14 | 16 | 20
  className?: string
}): JSX.Element {
  return (
    <svg
      className={className ? `ui-icon ${className}` : 'ui-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={size <= 12 ? 2 : 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {extras(name)}
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
