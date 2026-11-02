import { useState, type JSX } from 'react'
import type { ProjectSummary } from '@shared/domain'
import type { PinnedPage } from '@shared/ipc'
import { Sidebar } from '../../components/Sidebar'
import type { SidebarTopic } from '../../shell/sidebarTopics'
import { SponsorCard, SponsorList, SidebarSponsor } from '../../sponsors'
import { GallerySection, Specimen } from './GallerySection'

const PROJECT: ProjectSummary = {
  id: 'gallery-project',
  name: 'TextBolt',
  slug: 'textbolt',
  domain: 'textbolt.com',
  dbPath: '',
  clientName: null,
  status: 'active'
}

const TOPICS: SidebarTopic[] = [
  {
    id: 't1',
    title: 'Text alerts for teams without a developer',
    goalPct: 42,
    href: '#/playground/gallery'
  },
  { id: 't2', title: 'Carrier gateway replacement', goalPct: 58, href: '#/playground/gallery?t=2' }
]

const PINNED = [
  {
    id: 'p1',
    label: 'Text alerts for business',
    title: null,
    url: 'https://textbolt.com/',
    score: 50
  },
  {
    id: 'p2',
    label: 'Bulk SMS pricing',
    title: null,
    url: 'https://textbolt.com/pricing',
    score: 31
  }
] as unknown as PinnedPage[]

function DemoSidebar({ label, start }: { label: string; start: boolean }): JSX.Element {
  const [collapsed, setCollapsed] = useState(start)
  return (
    <div className={`gl-shell-frame${collapsed ? ' collapsed' : ''}`}>
      <Sidebar
        label={label}
        location={{ kind: 'section', section: 'overview' }}
        projects={[PROJECT]}
        active={PROJECT}
        foundPageCount={2014}
        pinned={PINNED}
        tray={null}
        onSelectProject={() => undefined}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        topics={TOPICS}
      />
      <div className="gl-shell-content" aria-hidden="true">
        <div className="gl-shell-bar" />
        <div className="gl-shell-tiles">
          <span />
          <span />
          <span />
        </div>
        <div className="gl-shell-grid" />
      </div>
    </div>
  )
}

/** The collapsible sidebar (both states) and the sponsor placements. */
export function ShellSection(): JSX.Element {
  return (
    <>
      <GallerySection
        id="shell"
        title="Shell"
        intro="Spruce sidebar, 220 wide, folds to a 64px icon rail (the toggle at its foot, or ⌘B / Ctrl+B). It folds by itself under 1100px unless pinned open, and remembers the choice."
      >
        <Specimen title="Expanded" span={6}>
          <DemoSidebar label="Sidebar demo, expanded" start={false} />
        </Specimen>
        <Specimen title="Collapsed rail" span={6}>
          <DemoSidebar label="Sidebar demo, collapsed" start />
        </Specimen>
      </GallerySection>
      <GallerySection
        id="sponsors"
        title="Sponsors"
        intro="Sponsors fund CiteFox. Gold owns the strip under the top bar; silver has a card at the sidebar foot. Links carry only a fixed utm query."
      >
        <Specimen title="Gold · card at the end of every screen" span={12}>
          <SponsorCard />
        </Specimen>
        <Specimen title="Silver · sidebar card and rail mark" span={5}>
          <div className="gl-spruce">
            <SidebarSponsor />
            <SidebarSponsor collapsed />
          </div>
        </Specimen>
        <Specimen title="Settings › About" span={7}>
          <SponsorList />
        </Specimen>
      </GallerySection>
    </>
  )
}
