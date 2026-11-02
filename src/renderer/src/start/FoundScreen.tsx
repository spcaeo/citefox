import { useEffect, useMemo, useState, type JSX } from 'react'
import type { SiteStartPlan, SiteStartSection, StartEdit } from '@shared/ipc'
import { errorText } from '../components/errorText'
import { DrawerLevel } from '../shell/DrawerLevel'
import { openDrawer, useDrawerEntry } from '../shell/drawers'
import { navigateHash, pagesHash, startHash, structureHash } from '../shell/routes'
import {
  ToolButton,
  Button,
  KpiStrip,
  KpiTile,
  LinkButton,
  ListGrid,
  Panel,
  SectionHead,
  UrlText,
  type ListColumn
} from '../ui'
import { UiIcon } from '../ui/UiIcon'
import { readStartChoice } from './choice'
import type { StartClient } from './client'
import { BuyerProfileDrawer } from './edit/BuyerProfileDrawer'
import { EditableChips } from './edit/EditableChips'
import { RivalsEditor } from './edit/RivalsEditor'
import { useStartEdits } from './edit/useStartEdits'
import { elapsedText, readCount, rivalsNote, rivalsOf } from './model'
import { ShareBar, StartFooter, StartFrame } from './StartFrame'
import type { StartProject } from './types'
import './found.css'

/**
 * "Your site is ready" (Mockups/v2/journey-a A3): four KPI tiles, the site's
 * sections with how many pages are likely to matter (a list grid), who buys,
 * and who the buyer meets (competitors, options they switch from, partners).
 * Still no searches; the one primary opens the starting plan.
 */
export function FoundScreen({
  client,
  project
}: {
  client: StartClient
  project: StartProject
}): JSX.Element {
  const [plan, setPlan] = useState<SiteStartPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Edit the buyer profile is on the URL (`drawer=start-buyers`): Back closes it.
  const buyersDrawer = useDrawerEntry('start-buyers')
  const edits = useStartEdits({ client, projectId: project.id, onPlan: setPlan })
  const send = (edit: StartEdit): void => {
    void edits.send(edit)
  }

  useEffect(() => {
    let cancelled = false
    client.get({ projectId: project.id }).then(
      (loaded) => {
        if (cancelled) return
        if (loaded === null) {
          // Nothing read yet: set up when the user chose that, else ask how to start.
          navigateHash(startHash(readStartChoice(project.id) === 'autopilot' ? 'setup' : 'choose'))
        } else setPlan(loaded)
      },
      (cause: unknown) => {
        if (!cancelled) setError(errorText(cause, 'Could not load what CiteFox found.'))
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, project.id])

  const footer = (
    <StartFooter
      onBack={() => navigateHash(startHash('setup'))}
      note="Next: a starting plan · still 0 searches"
    >
      <Button
        variant="primary"
        icon="arrow-right"
        disabled={plan === null}
        onClick={() => navigateHash(startHash('plan'))}
      >
        See my starting plan
      </Button>
    </StartFooter>
  )

  if (plan === null) {
    return (
      <StartFrame
        step="found"
        projectName={project.name}
        domain={project.domain}
        searchesLeft={null}
        title="Your site"
        footer={footer}
      >
        {error ? (
          <p className="sf-error" role="alert">
            {error}
          </p>
        ) : (
          <p role="status">Loading what CiteFox found…</p>
        )}
      </StartFrame>
    )
  }

  const biggest = plan.sections[0]
  const competitors = rivalsOf(plan.rivals, 'competitor')

  return (
    <StartFrame
      step="found"
      projectName={project.name}
      domain={project.domain}
      searchesLeft={plan.budget.searchesLeft}
      lead={
        <span className="sf-lead-check" aria-hidden="true">
          <UiIcon name="check" size={20} />
        </span>
      }
      title="Your site is ready"
      subtitle={`Here’s what CiteFox learned about ${plan.domain}. ${elapsedText(plan.elapsedMs)} · 0 searches used.`}
      footer={footer}
    >
      {plan.message ? (
        <p className="sf-error fd-note" role="note">
          {plan.message}
        </p>
      ) : null}
      <KpiStrip className="sf-kpis">
        <KpiTile
          label="Pages read"
          value={plan.pageCount.toLocaleString('en-US')}
          sub={`${readCount(plan)} key pages read in full`}
        />
        <KpiTile
          label="Sections"
          value={plan.sections.length}
          sub={
            biggest
              ? `${biggest.label} is the biggest, ${biggest.pageCount} pages`
              : 'No sitemap yet'
          }
        />
        <KpiTile label="Competitors" value={competitors.length} sub={rivalsNote(plan.rivals)} />
        <KpiTile
          label="Buyer profile"
          value={plan.topic ? 1 : 0}
          sub={
            plan.topic
              ? `${plan.buyers.segments.length} segments · ${plan.buyers.triggers.length} triggers`
              : 'Needs an AI'
          }
        />
      </KpiStrip>
      <div className="ui-layout-main-rail">
        <SectionsGrid plan={plan} />
        <div className="sf-col">
          <Panel
            title="Who buys"
            padding={20}
            actions={
              <ToolButton
                kind="edit"
                label="Edit who buys"
                onClick={() => openDrawer('start-buyers')}
              />
            }
          >
            {plan.buyers.who ? <p className="fd-who">{plan.buyers.who}</p> : null}
            <EditableChips
              label="Segments"
              noun="segment"
              items={plan.buyers.segments}
              onRename={(text, to) => send({ kind: 'segment', op: 'rename', text, to })}
              onRemove={(text) => send({ kind: 'segment', op: 'remove', text })}
              onAdd={(text) => send({ kind: 'segment', op: 'add', text })}
            />
            {plan.buyers.triggers.length > 0 ? (
              <ul className="fd-triggers" aria-label="Triggers">
                {plan.buyers.triggers.map((trigger) => (
                  <li key={trigger}>
                    <UiIcon name="bolt" size={14} />
                    {trigger}
                  </li>
                ))}
              </ul>
            ) : null}
            {plan.buyers.who === null && plan.buyers.segments.length === 0 ? (
              <p className="fd-who sf-faint">CiteFox AI writes this once it is connected.</p>
            ) : null}
          </Panel>
          <Panel title="Who you’re up against" padding={0} className="sf-flush">
            <RivalsEditor rivals={plan.rivals} onSend={send} />
          </Panel>
        </div>
      </div>
      {buyersDrawer ? (
        <DrawerLevel depth={buyersDrawer.depth}>
          <BuyerProfileDrawer
            buyers={plan.buyers}
            onSend={send}
            onClose={() => buyersDrawer.close()}
          />
        </DrawerLevel>
      ) : null}
      {edits.error ? (
        <p className="sf-error" role="alert">
          {edits.error}
        </p>
      ) : null}
      {edits.toast}
    </StartFrame>
  )
}

/** "What we found": the site's sections as a list grid. */
function SectionsGrid({ plan }: { plan: SiteStartPlan }): JSX.Element {
  const site = `https://${plan.domain}`
  const topLikely = Math.max(1, ...plan.sections.map((section) => section.likely))
  const columns = useMemo<ListColumn<SiteStartSection>[]>(
    () => [
      {
        id: 'section',
        label: 'Section',
        width: 'fill',
        minWidth: 200,
        sort: (section) => section.label,
        render: (section) => (
          <span className="fd-section">
            <span className="fd-section-name">{section.label}</span>
            <span className="sf-mono sf-faint fd-paths">
              {section.key === '/'
                ? section.samples
                    .map((sample) => pathOf(sample.url))
                    .slice(0, 2)
                    .join(', ')
                : `${section.key}…`}
            </span>
          </span>
        )
      },
      {
        id: 'pages',
        label: 'Pages',
        width: 88,
        numeric: true,
        sort: (section) => section.pageCount,
        render: (section) => section.pageCount.toLocaleString('en-US')
      },
      {
        id: 'likely',
        label: 'Likely to matter',
        width: 140,
        sort: (section) => section.likely,
        render: (section) => (
          <span className="fd-likely">
            <ShareBar percent={(section.likely / topLikely) * 100} />
            <span className="num">{section.likely}</span>
          </span>
        )
      },
      {
        id: 'strongest',
        label: 'Strongest page',
        width: 240,
        render: (section) =>
          section.strongest ? (
            <UrlText
              url={
                plan.pages.find((page) => page.path === section.strongest)?.url ?? section.strongest
              }
              label={section.strongest}
              site={site}
            />
          ) : (
            <span className="sf-faint">Rarely cited</span>
          )
      }
    ],
    [plan.pages, site, topLikely]
  )
  return (
    <section className="sf-section" aria-labelledby="fd-found">
      <SectionHead
        id="fd-found"
        title="What we found"
        description={`${plan.pages.length} pages likely to matter`}
        actions={
          <LinkButton size="sm" variant="text" href={structureHash()}>
            Open site structure
          </LinkButton>
        }
      />
      <ListGrid
        label="What we found"
        noun={['section', 'sections']}
        rows={plan.sections.slice(0, 8)}
        rowKey={(section) => section.key}
        rowLabel={(section) => section.label}
        columns={columns}
        rowMenu={(section) => [
          {
            id: 'pages',
            label: 'Open in All pages',
            icon: 'list',
            onSelect: () =>
              navigateHash(pagesHash(section.key === '/' ? {} : { folder: section.key }))
          },
          {
            id: 'structure',
            label: 'Open site structure',
            icon: 'layers',
            onSelect: () => navigateHash(structureHash())
          }
        ]}
        summary={() =>
          `${plan.pageCount.toLocaleString('en-US')} pages in ${plan.sections.length} sections${
            plan.retried > 0 ? ` · ${plan.retried} page retried` : ''
          }${plan.skipped > 0 ? ` · ${plan.skipped} skipped` : ''}`
        }
        empty={<p className="fd-empty sf-faint">No sitemap sections yet.</p>}
      />
    </section>
  )
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}
