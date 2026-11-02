import type { JSX } from 'react'

type IconPart =
  | { kind: 'path'; d: string }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx?: number }
  | { kind: 'circle'; cx: number; cy: number; r: number }

const ICONS = {
  spark: [{ kind: 'path', d: 'M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z' }],
  grid: [
    { kind: 'rect', x: 3, y: 3, width: 7, height: 7, rx: 1 },
    { kind: 'rect', x: 14, y: 3, width: 7, height: 7, rx: 1 },
    { kind: 'rect', x: 3, y: 14, width: 7, height: 7, rx: 1 },
    { kind: 'rect', x: 14, y: 14, width: 7, height: 7, rx: 1 }
  ],
  tree: [
    { kind: 'rect', x: 9, y: 2, width: 6, height: 6, rx: 1 },
    { kind: 'rect', x: 2, y: 16, width: 6, height: 6, rx: 1 },
    { kind: 'rect', x: 16, y: 16, width: 6, height: 6, rx: 1 },
    { kind: 'path', d: 'M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3' },
    { kind: 'path', d: 'M12 12V8' }
  ],
  video: [
    { kind: 'rect', x: 2, y: 5, width: 20, height: 14, rx: 4 },
    { kind: 'path', d: 'm10 9 5 3-5 3z' }
  ],
  calendar: [
    { kind: 'rect', x: 3, y: 4, width: 18, height: 18, rx: 2 },
    { kind: 'path', d: 'M16 2v4M8 2v4M3 10h18' }
  ],
  clock: [
    { kind: 'circle', cx: 12, cy: 12, r: 10 },
    { kind: 'path', d: 'M12 6v6l4 2' }
  ],
  sliders: [
    {
      kind: 'path',
      d: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6'
    }
  ],
  plug: [
    { kind: 'path', d: 'M12 22v-5' },
    { kind: 'path', d: 'M9 8V2M15 8V2' },
    { kind: 'path', d: 'M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z' }
  ],
  settings: [
    { kind: 'circle', cx: 12, cy: 12, r: 3 },
    {
      kind: 'path',
      d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'
    }
  ],
  search: [
    { kind: 'circle', cx: 11, cy: 11, r: 7 },
    { kind: 'path', d: 'm20 20-3.5-3.5' }
  ],
  plus: [{ kind: 'path', d: 'M12 5v14M5 12h14' }],
  play: [{ kind: 'path', d: 'M6 4l14 8-14 8z' }],
  chevrons: [
    { kind: 'path', d: 'm7 15 5 5 5-5' },
    { kind: 'path', d: 'm7 9 5-5 5 5' }
  ],
  'chevron-right': [{ kind: 'path', d: 'm9 18 6-6-6-6' }],
  download: [
    { kind: 'path', d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' },
    { kind: 'path', d: 'm7 10 5 5 5-5' },
    { kind: 'path', d: 'M12 15V3' }
  ],
  refresh: [
    { kind: 'path', d: 'M21 12a9 9 0 1 1-3-6.7L21 8' },
    { kind: 'path', d: 'M21 3v5h-5' }
  ],
  folder: [
    {
      kind: 'path',
      d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'
    }
  ],
  check: [{ kind: 'path', d: 'M20 6 9 17l-5-5' }],
  eye: [
    { kind: 'path', d: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z' },
    { kind: 'circle', cx: 12, cy: 12, r: 3 }
  ],
  'eye-off': [
    { kind: 'path', d: 'M9.88 9.88a3 3 0 1 0 4.24 4.24' },
    {
      kind: 'path',
      d: 'M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68'
    },
    { kind: 'path', d: 'M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61' },
    { kind: 'path', d: 'm2 2 20 20' }
  ],
  external: [
    { kind: 'path', d: 'M15 3h6v6' },
    { kind: 'path', d: 'M10 14 21 3' },
    { kind: 'path', d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }
  ],
  'arrow-left': [
    { kind: 'path', d: 'm12 19-7-7 7-7' },
    { kind: 'path', d: 'M19 12H5' }
  ],
  'arrow-right': [
    { kind: 'path', d: 'M5 12h14' },
    { kind: 'path', d: 'm12 5 7 7-7 7' }
  ],
  terminal: [
    { kind: 'path', d: 'm4 17 6-6-6-6' },
    { kind: 'path', d: 'M12 19h8' }
  ],
  user: [
    { kind: 'circle', cx: 12, cy: 8, r: 4 },
    { kind: 'path', d: 'M20 21a8 8 0 0 0-16 0' }
  ],
  message: [{ kind: 'path', d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }],
  warning: [
    { kind: 'path', d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' },
    { kind: 'path', d: 'M12 9v4' },
    { kind: 'path', d: 'M12 17h.01' }
  ],
  info: [
    { kind: 'circle', cx: 12, cy: 12, r: 10 },
    { kind: 'path', d: 'M12 16v-4' },
    { kind: 'path', d: 'M12 8h.01' }
  ],
  key: [
    { kind: 'circle', cx: 7.5, cy: 15.5, r: 5.5 },
    { kind: 'path', d: 'm21 2-9.6 9.6' },
    { kind: 'path', d: 'm15.5 7.5 3 3L22 7l-3-3' }
  ],
  minus: [{ kind: 'path', d: 'M5 12h14' }],
  x: [
    { kind: 'path', d: 'M18 6 6 18' },
    { kind: 'path', d: 'm6 6 12 12' }
  ],
  globe: [
    { kind: 'circle', cx: 12, cy: 12, r: 10 },
    { kind: 'path', d: 'M2 12h20' },
    { kind: 'path', d: 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20' }
  ],
  activity: [{ kind: 'path', d: 'M22 12h-4l-3 9L9 3l-3 9H2' }],
  file: [
    { kind: 'path', d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' },
    { kind: 'path', d: 'M14 2v6h6' },
    { kind: 'path', d: 'M8 13h8M8 17h5' }
  ],
  flask: [
    {
      kind: 'path',
      d: 'M10 2v6.5a2 2 0 0 1-.5 1.3L5.2 16.2A2 2 0 0 0 6.9 19.4h10.2a2 2 0 0 0 1.7-3.2l-4.3-6.4a2 2 0 0 1-.5-1.3V2'
    },
    { kind: 'path', d: 'M8.5 2h7' },
    { kind: 'path', d: 'M7 16h10' }
  ],
  table: [
    { kind: 'rect', x: 3, y: 3, width: 18, height: 18, rx: 2 },
    { kind: 'path', d: 'M3 9h18M3 15h18M9 3v18' }
  ],
  filter: [{ kind: 'path', d: 'M22 3H2l8 9.46V19l4 2v-8.54L22 3z' }],
  copy: [
    { kind: 'rect', x: 9, y: 9, width: 13, height: 13, rx: 2 },
    { kind: 'path', d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }
  ],
  pencil: [
    {
      kind: 'path',
      d: 'M21.17 6.81a1 1 0 0 0-3.98-3.98L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z'
    },
    { kind: 'path', d: 'm15 5 4 4' }
  ],
  trash: [
    { kind: 'path', d: 'M3 6h18' },
    { kind: 'path', d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' },
    { kind: 'path', d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }
  ],
  list: [{ kind: 'path', d: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' }],
  gauge: [
    { kind: 'path', d: 'M12 14l4-4' },
    { kind: 'path', d: 'M3.3 19a9 9 0 1 1 17.4 0' }
  ],
  question: [
    {
      kind: 'path',
      d: 'M20 15.5a1.5 1.5 0 0 1-1.5 1.5H8l-4 3.5v-15A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5z'
    },
    { kind: 'path', d: 'M9.8 8.6a2.3 2.3 0 0 1 4.4.9c0 1.5-2.2 1.8-2.2 3' },
    { kind: 'path', d: 'M12 14.6h.01' }
  ],
  layers: [
    { kind: 'path', d: 'M12 3l9 5-9 5-9-5 9-5z' },
    { kind: 'path', d: 'M3 13l9 5 9-5' }
  ],
  users: [
    { kind: 'circle', cx: 9, cy: 8, r: 3.5 },
    { kind: 'path', d: 'M2.5 20a6.5 6.5 0 0 1 13 0' },
    { kind: 'path', d: 'M16 4.5a3.5 3.5 0 0 1 0 7' },
    { kind: 'path', d: 'M18 14a6 6 0 0 1 3.5 6' }
  ],
  link: [
    { kind: 'path', d: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1' },
    { kind: 'path', d: 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1' }
  ],
  'check-square': [
    { kind: 'path', d: 'M9 11l3 3 8-8' },
    { kind: 'path', d: 'M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9' }
  ],
  bell: [
    { kind: 'path', d: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9' },
    { kind: 'path', d: 'M10.3 21a2 2 0 0 0 3.4 0' }
  ],
  pin: [
    { kind: 'path', d: 'M12 17v5' },
    { kind: 'path', d: 'M9 3h6l-1 6 4 4H6l4-4z' }
  ]
} as const satisfies Record<string, readonly IconPart[]>

export type IconName = keyof typeof ICONS

type IconSize = 'sm' | 'nav' | 'chev'

export function Icon({
  name,
  size = 'sm',
  strong = false,
  faint = false
}: {
  name: IconName
  size?: IconSize
  strong?: boolean
  faint?: boolean
}): JSX.Element {
  const className = [
    'icon',
    size === 'nav' ? 'icon-nav' : size === 'chev' ? 'icon-chev' : 'icon-sm',
    strong ? 'icon-strong' : '',
    faint ? 'icon-faint' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      {ICONS[name].map((part, index) => {
        if (part.kind === 'path') return <path key={index} d={part.d} />
        if (part.kind === 'rect') {
          return (
            <rect
              key={index}
              x={part.x}
              y={part.y}
              width={part.width}
              height={part.height}
              rx={part.rx}
            />
          )
        }
        return <circle key={index} cx={part.cx} cy={part.cy} r={part.r} />
      })}
    </svg>
  )
}

/** The app icon (build/icon.svg) in miniature: the fox head on its dark tile. */
export function FoxMark(): JSX.Element {
  return (
    <svg className="fox" viewBox="100 100 824 824" aria-hidden="true">
      <rect className="fox-tile" x="100" y="100" width="824" height="824" rx="185" />
      <polygon
        className="fox-body"
        points="262 226 424 360 600 360 762 226 790 500 824 600 512 812 200 600 234 500"
      />
      <polygon className="fox-ear" points="278 276 396 372 262 444" />
      <polygon className="fox-ear" points="746 276 628 372 762 444" />
      <polygon className="fox-chest" points="200 600 384 556 512 768 512 812" />
      <polygon className="fox-chest" points="824 600 640 556 512 768 512 812" />
      <polygon className="fox-eye" points="466 752 558 752 512 812" />
      <rect
        className="fox-eye"
        x="-38"
        y="-17"
        width="76"
        height="34"
        rx="17"
        transform="translate(410 520) rotate(24)"
      />
      <rect
        className="fox-eye"
        x="-38"
        y="-17"
        width="76"
        height="34"
        rx="17"
        transform="translate(614 520) rotate(-24)"
      />
    </svg>
  )
}
