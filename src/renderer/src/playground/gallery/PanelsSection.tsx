import { useState, type JSX } from 'react'
import { DrawerLevel } from '../../shell/DrawerLevel'
import { openDrawer, useDrawerEntry } from '../../shell/drawers'
import {
  Button,
  Chip,
  Confirm,
  Drawer,
  DrawerFacts,
  DrawerGrid,
  DrawerSection,
  Panel,
  RightRail,
  SuggestionCard,
  WizardFooter
} from '../../ui'
import { GallerySection, Specimen } from './GallerySection'

const GAPS = [
  { id: 'g1', label: 'Who they are', text: 'MSP owners routing client alerts' },
  { id: 'g2', label: 'Triggers', text: 'Told they need 10DLC just to text their own staff' }
]

/** Context panels, the AI suggestion card, the drawer, the confirm and the wizard footer. */
export function PanelsSection(): JSX.Element {
  // The demo drawer is on the URL like every drawer (`drawer=gallery-drawer`).
  const drawer = useDrawerEntry('gallery-drawer')
  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState<string | null>(null)
  const [applied, setApplied] = useState<string[] | null>(null)
  const [cardOpen, setCardOpen] = useState(true)

  return (
    <GallerySection
      id="panels"
      title="Panels"
      intro="Context goes in the right rail. Details and tasks open in a drawer, never a new page. A yes/no is a small confirm. AI answers land as one dismissible suggestion card and change nothing until Apply."
    >
      <div className="gl-span-6">
        {cardOpen ? (
          <SuggestionCard
            title="Fill gaps from your site"
            meta="7 additions across 5 sections · 2 shown"
            items={GAPS}
            recheckCount={4}
            footnote="CiteFox AI · about 30 s · no searches"
            applyLabel="Review all 7"
            onApply={(ids) => setApplied(ids)}
            {...(applied ? { onUndo: () => setApplied(null) } : {})}
            onRetry={() => undefined}
            onClose={() => setCardOpen(false)}
          />
        ) : (
          <Button size="sm" onClick={() => setCardOpen(true)}>
            Show the suggestion again
          </Button>
        )}
        <p className="gl-help gl-under" role="status">
          {applied ? `Applied ${applied.length} suggestions.` : 'Nothing applied yet.'}
        </p>
      </div>
      <div className="gl-span-6">
        <RightRail label="Gallery rail">
          <Panel title="Version 2" titleAs="h3" actions={<Chip tone="ok">Saved</Chip>}>
            <dl className="gl-dl">
              <dt>Written</dt>
              <dd>Just now · changes marked New</dd>
              <dt>Template</dt>
              <dd className="mono">icp.md</dd>
              <dt>Markets</dt>
              <dd>One profile for US · EN</dd>
            </dl>
            <div className="gl-row">
              <Button size="sm">Use version 1</Button>
              <Button size="sm" variant="ghost">
                Rewrite all
              </Button>
            </div>
          </Panel>
          <Panel title="Drawer and confirm" titleAs="h3" tone="inset">
            <p className="gl-help">
              The drawer takes 80% of the window and is on the URL: ✕, Escape and Back close it. The
              confirm asks one yes/no question.
            </p>
            <div className="gl-row">
              <Button size="sm" onClick={() => openDrawer('gallery-drawer')}>
                Open drawer
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
                Open confirm
              </Button>
            </div>
            <p className="gl-help" role="status">
              {confirmed ?? 'Nothing confirmed yet.'}
            </p>
          </Panel>
        </RightRail>
      </div>
      <Specimen title="Wizard footer" span={12}>
        <div className="gl-footer-frame">
          <WizardFooter
            onBack={() => undefined}
            note="118 keywords need 118–236 searches · you have 13"
            noteTone="warn"
            primary={{ label: 'Match pages', onClick: () => undefined, icon: 'arrow-right' }}
          />
        </div>
      </Specimen>
      {drawer ? (
        <DrawerLevel depth={drawer.depth}>
          <Drawer
            id="gallery-drawer"
            title="Cited questions"
            heading={
              <>
                Cited questions <span className="num">· 11</span>
              </>
            }
            subtitle="Questions behind this number"
            focusOnOpen="close"
            onClose={() => drawer.close()}
            footer={{
              summary: 'The footer stays in view while the body scrolls.',
              primary: { label: 'Done', onClick: () => drawer.close() }
            }}
          >
            <DrawerGrid>
              <DrawerSection title="Where the cited answers point" span={8}>
                <div className="gl-mini-kpis">
                  <div>
                    <p className="gl-help">Right page</p>
                    <p className="num gl-mini-num">9</p>
                  </div>
                  <div>
                    <p className="gl-help">Other page</p>
                    <p className="num gl-mini-num">2</p>
                  </div>
                  <div>
                    <p className="gl-help">Avg position</p>
                    <p className="num gl-mini-num">2.3</p>
                  </div>
                </div>
              </DrawerSection>
              <DrawerSection title="About this list" span={4}>
                <DrawerFacts
                  items={[
                    { label: 'Market', value: 'US · EN' },
                    { label: 'Checked', value: 'Today, 09:00' }
                  ]}
                />
              </DrawerSection>
            </DrawerGrid>
          </Drawer>
        </DrawerLevel>
      ) : null}
      {confirming ? (
        <Confirm
          title="Delete this topic?"
          body="Its questions and results leave the project. This cannot be undone."
          confirmLabel="Delete topic"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            setConfirmed('Deleted (demo only, nothing changed).')
          }}
        />
      ) : null}
    </GallerySection>
  )
}
