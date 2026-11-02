import { useEffect, useState, type JSX } from 'react'
import { GallerySection, Specimen } from './GallerySection'

interface Swatch {
  name: string
  token: string
  /** A second token shown with it, such as a tint. */
  pair?: string
}

const ROWS: { label: string; swatches: Swatch[] }[] = [
  {
    label: 'Neutrals',
    swatches: [
      { name: 'Ground', token: '--ground' },
      { name: 'Surface', token: '--surface' },
      { name: 'Inset', token: '--inset' },
      { name: 'Line', token: '--line' },
      { name: 'Line strong', token: '--line-strong' }
    ]
  },
  {
    label: 'Ink',
    swatches: [
      { name: 'Ink · text', token: '--ink' },
      { name: 'Ink 2 · labels', token: '--ink-2' },
      { name: 'Ink 3 · helper', token: '--ink-3' },
      { name: 'Ink 4 · decor only', token: '--ink-4' },
      { name: 'Spruce · sidebar', token: '--spruce' },
      { name: 'Spruce 2 · active', token: '--spruce-2' }
    ]
  },
  {
    label: 'Accent',
    swatches: [
      { name: 'Fox', token: '--fox' },
      { name: 'Fox ink · hover', token: '--fox-ink' },
      { name: 'Fox tint', token: '--fox-tint' },
      { name: 'Fox line', token: '--fox-line' }
    ]
  },
  {
    label: 'Action',
    swatches: [
      { name: 'Action · buttons', token: '--action' },
      { name: 'Action hover', token: '--action-hover' },
      { name: 'Action press', token: '--action-press' },
      { name: 'Action ink · text buttons', token: '--action-ink' }
    ]
  },
  {
    label: 'Semantic',
    swatches: [
      { name: 'Success', token: '--ok', pair: '--ok-tint' },
      { name: 'Warning', token: '--warn', pair: '--warn-tint' },
      { name: 'Danger', token: '--bad', pair: '--bad-tint' },
      { name: 'Info', token: '--info', pair: '--info-tint' }
    ]
  },
  {
    label: 'Chart',
    swatches: [
      { name: 'Cited · you', token: '--chart-cited' },
      { name: 'Not cited', token: '--chart-not-cited' },
      { name: 'No AI Overview', token: '--chart-no-aio' },
      { name: 'Goal band', token: '--chart-band' },
      { name: 'Series 2 · spruce', token: '--chart-2' },
      { name: 'Series 3 · sand', token: '--chart-3' }
    ]
  }
]

/** The active theme's value of a token, read live so the gallery never shows the other theme's hex. */
function tokenValue(token: string): string {
  if (typeof document === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim()
}

/** Re-renders when <html data-theme> changes, so the values follow Settings › Appearance. */
function useThemeName(): string {
  const read = (): string =>
    typeof document === 'undefined' ? '' : (document.documentElement.dataset.theme ?? '')
  const [theme, setTheme] = useState(read)
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(read())
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })
    return () => {
      observer.disconnect()
    }
  }, [])
  return theme
}

const TYPE = [
  { spec: 'Display · 32/40 · 600 · tnum', className: 'gl-type-display', text: '42%' },
  {
    spec: 'H1 · 22/28 · 600',
    className: 'gl-type-h1',
    text: 'Text alerts for teams without a developer'
  },
  { spec: 'H2 · 16/24 · 600', className: 'gl-type-h2', text: 'Coverage by journey stage' },
  { spec: 'H3 · 14/20 · 600', className: 'gl-type-h3', text: 'Buyer profile' },
  {
    spec: 'Body · 14/20 · 400',
    className: '',
    text: 'Questions stay buyer-side: long, natural, never your brand name.'
  },
  {
    spec: 'Small · 12/16 · 500',
    className: 'gl-type-small',
    text: 'CiteFox AI · about 20 s · no searches'
  },
  {
    spec: 'Mono · 12/16 · URLs only',
    className: 'mono gl-type-mono',
    text: 'textbolt.com/use-cases/it-alerts/'
  }
]

/** Colour, type, space, shape and depth (Theme.dc.html, top half). */
export function FoundationsSection(): JSX.Element {
  useThemeName()
  return (
    <>
      <GallerySection
        id="colour"
        title="Colour"
        intro="Neutrals carry the screen. Fox orange is only the brand, your page being cited and the ✦ AI marks. Action green is the one main button; text links use action ink."
      >
        <div className="gl-span-12 gl-swatches">
          {ROWS.map((row) => (
            <div key={row.label} className="gl-swatch-row">
              <p className="gl-swatch-label">{row.label}</p>
              {row.swatches.map((swatch) => (
                <figure key={swatch.token} className="gl-swatch">
                  <div
                    className={`gl-chip${swatch.token === '--chart-no-aio' ? ' gl-chip-hatch' : ''}`}
                    style={{
                      background:
                        swatch.token === '--chart-no-aio' ? undefined : `var(${swatch.token})`
                    }}
                  />
                  <figcaption>{swatch.name}</figcaption>
                  <p className="mono">
                    {tokenValue(swatch.token)}
                    {swatch.pair ? ` / ${tokenValue(swatch.pair)}` : ''}
                    {swatch.token === '--chart-no-aio' ? ' hatched' : ''}
                  </p>
                </figure>
              ))}
            </div>
          ))}
        </div>
      </GallerySection>

      <GallerySection
        id="type"
        title="Type"
        intro="One family. Numbers are tabular and big; words are short and small."
      >
        <Specimen>
          {TYPE.map((row) => (
            <div key={row.spec} className="gl-type-row">
              <p className="gl-help num">{row.spec}</p>
              <p className={row.className}>{row.text}</p>
            </div>
          ))}
        </Specimen>
      </GallerySection>

      <GallerySection
        id="space"
        title="Space, shape, depth"
        intro="4/8 spacing. Cards pad 24 and sit 24 apart. Radius grows with size."
      >
        <Specimen title="Spacing" span={4}>
          {[4, 8, 12, 16, 24, 32, 48, 64].map((size) => (
            <div key={size} className="gl-space-row">
              <span className="num gl-help">{size}</span>
              <span
                className={`gl-space-bar${size === 24 ? ' fox' : ''}`}
                style={{ width: size }}
              />
              {size === 24 ? <span className="gl-help">card padding, gaps</span> : null}
              {size === 32 ? <span className="gl-help">page padding</span> : null}
            </div>
          ))}
        </Specimen>
        <Specimen title="Radius" span={4}>
          <div className="gl-radius-grid">
            <div>
              <div className="gl-radius" style={{ borderRadius: 6 }} />
              <p className="gl-help">6 · controls</p>
            </div>
            <div>
              <div className="gl-radius" style={{ borderRadius: 10 }} />
              <p className="gl-help">10 · cards, menus</p>
            </div>
            <div>
              <div className="gl-radius" style={{ borderRadius: 14 }} />
              <p className="gl-help">14 · drawers, dialogs</p>
            </div>
            <div>
              <div className="gl-radius gl-radius-pill" />
              <p className="gl-help">999 · chips only</p>
            </div>
          </div>
        </Specimen>
        <Specimen title="Elevation" span={4} inset>
          <div className="gl-elev" style={{ boxShadow: 'var(--e1)' }}>
            E1 · cards, resting
          </div>
          <div className="gl-elev" style={{ boxShadow: 'var(--e2)' }}>
            E2 · menus, popovers
          </div>
          <div className="gl-elev gl-elev-3" style={{ boxShadow: 'var(--e3)' }}>
            E3 · drawer over scrim
          </div>
        </Specimen>
      </GallerySection>
    </>
  )
}
