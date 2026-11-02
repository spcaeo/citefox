import { useMemo, useState, type JSX } from 'react'
import { createMockAssistClient } from '../../assist/client'
import { HeaderActions } from '../../components/HeaderActions'
import {
  AiMenu,
  Button,
  Chip,
  IconButton,
  LinkButton,
  SectionHead,
  SegmentedControl,
  useAssistMenu
} from '../../ui'
import { GallerySection, Specimen } from './GallerySection'

/** Buttons, the AI menu (plain and wired to the assist mock), inputs, segments, chips. */
export function ActionsSection({ projectId }: { projectId: string | null }): JSX.Element {
  const [depth, setDepth] = useState<'quick' | 'standard' | 'deep' | 'custom'>('standard')
  const [picked, setPicked] = useState('Nothing picked yet.')
  const [done, setDone] = useState('Nothing run yet.')
  const [pinned, setPinned] = useState(false)
  // The gallery never calls Claude: the assist menu runs on the mock client.
  const client = useMemo(() => createMockAssistClient(), [])
  const assist = useAssistMenu({
    scope: { projectId, client },
    label: 'AI actions for the gallery',
    actions: [
      {
        assistId: 'results.topActions',
        label: 'Suggest top actions',
        seconds: 15,
        icon: 'compass'
      },
      { assistId: 'results.explainChange', label: 'Explain this change', seconds: 5, icon: 'bulb' }
    ]
  })

  return (
    <>
      <GallerySection
        id="actions"
        title="Actions"
        intro="One green button per screen, on the right. Everything else goes under ⋯; small things are icons with a tooltip. Every AI action lives behind one sparkle button per card."
      >
        <Specimen title="Buttons" span={6}>
          <div className="gl-row">
            <Button variant="primary">Check now</Button>
            <Button>Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="text">Text link</Button>
            <Button variant="danger">Remove</Button>
          </div>
          <div className="gl-row">
            <Button size="sm" icon="plus">
              Small
            </Button>
            <IconButton icon="dots" label="More actions" />
            <IconButton icon="x" label="Close" />
            <LinkButton href="#/playground/gallery" variant="ghost" size="sm" icon="arrow-left">
              Back
            </LinkButton>
            <Button iconEnd="arrow-right" busy>
              Match pages
            </Button>
          </div>
          <p className="gl-help">
            Primary: action green with white text, once per screen. Secondary (white): Cancel, Back
            and the rest. Text links in action ink, never orange. Row actions hide behind the row
            menu.
          </p>
        </Specimen>
        <Specimen title="Screen header · one green, the rest under ⋯" span={6}>
          <div className="gl-head-demo">
            <div className="gl-head-demo-title">
              <p className="gl-head-demo-name">Questions</p>
              <p className="gl-help">Every question you track.</p>
            </div>
            <div className="gl-head-demo-actions">
              <HeaderActions
                moreLabel="Questions actions (demo)"
                more={[
                  {
                    id: 'gl-import',
                    label: 'Import from Excel or CSV',
                    icon: 'upload',
                    onSelect: () => setDone('Import (demo)')
                  },
                  {
                    id: 'gl-export',
                    label: 'Export questions (CSV)',
                    icon: 'download',
                    onSelect: () => setDone('Export (demo)')
                  },
                  {
                    id: 'gl-delete',
                    label: 'Delete selected…',
                    icon: 'trash',
                    onSelect: () => setDone('Deleted (demo only, nothing changed).'),
                    danger: {
                      title: 'Delete 3 questions?',
                      body: 'Demo only: nothing is deleted.',
                      confirmLabel: 'Delete questions'
                    }
                  }
                ]}
                primary={{
                  label: 'Add questions',
                  icon: 'plus',
                  onClick: () => setDone('Add questions (demo)')
                }}
              />
            </div>
          </div>
          <p className="gl-help">Red ⋯ items come last and ask first; the confirm is on the URL.</p>
        </Specimen>
        <Specimen title="Section heads · icons, or one link and ⋯" span={6}>
          <SectionHead
            level={4}
            title="Who gets cited"
            actions={
              <IconButton
                icon="refresh"
                label="Refresh"
                data-tip="Refresh"
                size="sm"
                onClick={() => setDone('Refresh (demo)')}
              />
            }
          />
          <SectionHead
            level={4}
            title="Pages"
            actions={
              <>
                <Button variant="text" size="sm" onClick={() => setDone('See all (demo)')}>
                  See all
                </Button>
                <HeaderActions
                  moreLabel="Pages actions (demo)"
                  more={[
                    {
                      id: 'gl-pages-export',
                      label: 'Export pages (CSV)',
                      icon: 'download',
                      onSelect: () => setDone('Export pages (demo)')
                    },
                    {
                      id: 'gl-pages-check',
                      label: 'Check all pages now',
                      icon: 'refresh',
                      onSelect: () => setDone('Check all (demo)')
                    }
                  ]}
                />
              </>
            }
          />
          <SectionHead
            level={4}
            title="Pinned"
            actions={
              <IconButton
                icon="target"
                label="Pin this page"
                data-tip="Pin this page"
                size="sm"
                aria-pressed={pinned}
                onClick={() => setPinned((value) => !value)}
              />
            }
          />
          <p className="gl-help" role="status">
            {done}
          </p>
        </Specimen>
        <Specimen title="AI menu · one per card" span={6}>
          <div className="gl-row gl-row-between">
            <p className="gl-help gl-narrow">
              Opens a short menu. Each line says what runs and how long it takes. Results land as
              one suggestion card.
            </p>
            <AiMenu
              label="AI actions"
              actions={[
                {
                  id: 'more',
                  label: 'Discover more',
                  icon: 'compass',
                  seconds: 15,
                  onSelect: () => setPicked('Discover more')
                },
                {
                  id: 'rewrite',
                  label: 'Rewrite',
                  icon: 'wand',
                  seconds: 5,
                  onSelect: () => setPicked('Rewrite')
                },
                {
                  id: 'explain',
                  label: 'Explain',
                  icon: 'bulb',
                  seconds: 5,
                  onSelect: () => setPicked('Explain')
                },
                {
                  id: 'prioritise',
                  label: 'Prioritise',
                  icon: 'prioritise',
                  seconds: 8,
                  onSelect: () => setPicked('Prioritise')
                },
                {
                  id: 'merge',
                  label: 'Merge near-duplicates',
                  icon: 'merge',
                  seconds: 8,
                  onSelect: () => setPicked('Merge near-duplicates')
                }
              ]}
            />
          </div>
          <p className="gl-help" role="status">
            {picked}
          </p>
          <div className="gl-row gl-row-between gl-divider">
            <p className="gl-help gl-narrow">
              useAssistMenu: the same menu wired to assist ids, with its one suggestion card.
            </p>
            {assist.menu}
          </div>
          {assist.card}
        </Specimen>
      </GallerySection>

      <GallerySection
        id="inputs"
        title="Inputs"
        intro="Labels above, one helper line below. Choices of 2–5 use a segmented control."
      >
        <Specimen span={5}>
          <div>
            <label className="gl-label" htmlFor="gl-seed">
              Problem or seed
            </label>
            <input
              id="gl-seed"
              className="gl-input"
              defaultValue="Text alerts for teams without a developer"
            />
            <p className="gl-help gl-under">Write it the way your buyer would say it.</p>
          </div>
          <div>
            <label className="gl-label" htmlFor="gl-market">
              Market
            </label>
            <select id="gl-market" className="gl-input">
              <option>US · English</option>
              <option>CA · English</option>
            </select>
          </div>
        </Specimen>
        <Specimen span={7}>
          <div>
            <p className="gl-label">Segmented control</p>
            <SegmentedControl
              label="How deep"
              value={depth}
              onChange={setDepth}
              options={[
                { value: 'quick', label: 'Quick' },
                { value: 'standard', label: 'Standard' },
                { value: 'deep', label: 'Deep' },
                { value: 'custom', label: 'Custom' }
              ]}
            />
          </div>
          <div>
            <p className="gl-label">Chips</p>
            <div className="gl-row">
              <Chip>Problem</Chip>
              <Chip tone="fox" dot>
                Cited · you
              </Chip>
              <Chip tone="ok">High match</Chip>
              <Chip tone="warn">Re-check fact</Chip>
              <Chip tone="bad">Over budget</Chip>
              <Chip tone="info">Another page</Chip>
            </div>
          </div>
          <div className="gl-row">
            <label className="gl-check">
              <input type="checkbox" defaultChecked /> Selected
            </label>
            <label className="gl-check">
              <input type="radio" name="gl-radio" defaultChecked /> Option
            </label>
          </div>
        </Specimen>
      </GallerySection>
    </>
  )
}
