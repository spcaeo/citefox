import type { JSX } from 'react'
import { FoxMark } from '../../components/Icon'
import { ActionsSection } from './ActionsSection'
import { DataSection } from './DataSection'
import { FoundationsSection } from './FoundationsSection'
import { GridSection } from './GridSection'
import { HelpFillSection } from './HelpFillSection'
import { PanelsSection } from './PanelsSection'
import { ReportChartsSection } from './ReportChartsSection'
import { ShellSection } from './ShellSection'
import './gallery.css'

/**
 * The v2 design system gallery (dev and e2e builds only, `#/playground/gallery`):
 * every shared component from src/renderer/src/ui in the layout of
 * Mockups/v2/Theme.dc.html. Nothing here calls Claude or SerpApi.
 */
export default function GalleryScreen({ projectId }: { projectId: string | null }): JSX.Element {
  return (
    <div className="gl">
      <header className="gl-head">
        <div className="gl-head-copy">
          <p className="gl-eyebrow">
            <span className="gl-logo">
              <FoxMark />
            </span>
            CiteFox design system · v2
          </p>
          <h1>FoxCue look</h1>
          <p className="gl-lead">
            A white ground, near-black chrome and one FoxCue yellow: your next step is the one
            yellow button. Fox orange means the brand and ✦ AI only.
          </p>
        </div>
        <dl className="gl-facts">
          <div>
            <dt>UI type</dt>
            <dd>Inter · Inter Tight titles</dd>
          </div>
          <div>
            <dt>Code and URLs</dt>
            <dd className="mono">JetBrains Mono</dd>
          </div>
          <div>
            <dt>Grid</dt>
            <dd className="num">12 col · 24 gutter · 32 page</dd>
          </div>
          <div>
            <dt>Shell</dt>
            <dd className="num">220 sidebar · 56 top bar</dd>
          </div>
        </dl>
      </header>
      <FoundationsSection />
      <ActionsSection projectId={projectId} />
      <DataSection />
      <ReportChartsSection />
      <GridSection />
      <PanelsSection />
      <HelpFillSection />
      <ShellSection />
    </div>
  )
}
