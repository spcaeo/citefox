import { useMemo, type JSX } from 'react'
import type { PageSummary } from '@shared/domain'
import { useAiContext } from '../assistant/context/useAiContext'
import { DrillHost } from '../drill'
import { ScreenDrawerLevel } from '../shell/DrawerLevel'
import { Drawer, EmptyState, SectionHead, TabPanel, Tabs } from '../ui'
import { ChannelSettings } from './components/ChannelSettings'
import { IdeaFlow } from './components/IdeaFlow'
import { IdeasGrid } from './components/IdeasList'
import { KpiTiles } from './components/KpiTiles'
import { scopeGroups } from './components/scopeGroups'
import { YourVideos } from './components/YourVideos'
import { useVideoQuery } from './hooks/useVideoQuery'
import { useVideoScreen } from './hooks/useVideoScreen'
import { createVideosSource, type VideosSource } from './source'
import type { VideoAssistSlot } from './types'
import { videoDrills } from './utils/drill'
import {
  defaultFlowStep,
  formatDate,
  marketName,
  pageName,
  scopePages,
  sortIdeas,
  stepLabel
} from './utils/model'
import './videos.css'

const PANEL = 'yt-tab'

/** YouTube opportunities (SRS §4.18). The FoxCue sponsor sits in the sidebar, not here. */
export function VideosScreen({
  projectId,
  pages,
  source,
  assists
}: {
  projectId: string | null
  pages: readonly PageSummary[]
  source?: VideosSource
  /** FR-18.10 hook point for AI assists ("Which video first?"). Renders nothing by default. */
  assists?: VideoAssistSlot
}): JSX.Element {
  const client = useMemo(() => source ?? createVideosSource(), [source])
  if (projectId === null) {
    return (
      <div className="page-stack yt-screen">
        <EmptyState
          icon="inbox"
          title="Create a project first"
          body="Its YouTube opportunities show here."
        />
      </div>
    )
  }
  return (
    <DrillHost>
      <VideosBody
        key={projectId}
        client={client}
        projectId={projectId}
        pages={pages}
        assists={assists}
      />
    </DrillHost>
  )
}

function VideosBody({
  client,
  projectId,
  pages,
  assists
}: {
  client: VideosSource
  projectId: string
  pages: readonly PageSummary[]
  assists?: VideoAssistSlot
}): JSX.Element {
  const query = useVideoQuery()
  const choices = scopePages(pages)
  // A page id the route names but the project no longer tracks shows every page.
  const pageId = choices.some((page) => page.id === query.pageId) ? query.pageId : null
  const marketId = query.marketId
  const { screen, error, loading, reload, applyIdea } = useVideoScreen(
    client,
    projectId,
    pageId,
    marketId
  )
  const drills = useMemo(
    () => videoDrills(screen?.aios ?? [], screen?.markets ?? []),
    [screen?.aios, screen?.markets]
  )
  const scopePage = choices.find((page) => page.id === pageId)
  const openIdea = screen?.ideas.find((idea) => idea.id === query.ideaId)
  useAiContext({
    entities: [
      ...(scopePage
        ? [{ kind: 'page' as const, id: scopePage.id, label: pageName(scopePage) }]
        : []),
      ...(screen && marketId !== null
        ? [{ kind: 'market' as const, id: marketId, label: marketName(screen.markets, marketId) }]
        : []),
      ...(openIdea
        ? [
            {
              kind: 'video' as const,
              id: openIdea.id,
              label: openIdea.brief?.title ?? openIdea.question,
              detail: stepLabel(openIdea.step)
            }
          ]
        : [])
    ],
    numbers: screen
      ? [
          { label: 'Video opportunities', value: String(screen.ideas.length) },
          {
            label: 'Your videos',
            value: String(screen.ideas.filter((idea) => idea.videoUrl !== null).length)
          }
        ]
      : []
  })

  if (screen === null) {
    return error ? (
      <p className="bridge-alert" role="alert">
        {error}
      </p>
    ) : (
      <p role="status">Loading YouTube…</p>
    )
  }
  const ideas = sortIdeas(screen.ideas)
  const open = ideas.find((idea) => idea.id === query.ideaId) ?? null
  const tracked = ideas.filter((idea) => idea.videoUrl !== null)
  const scopeText =
    pageId === null
      ? 'All tracked pages'
      : pageName(choices.find((p) => p.id === pageId) ?? { label: null, title: null, url: pageId })
  const marketText = marketId === null ? 'All markets' : marketName(screen.markets, marketId)
  const filters = scopeGroups({
    markets: screen.markets,
    pages: choices,
    marketId,
    pageId,
    onMarket: query.setMarket,
    onScope: query.setScope
  })

  return (
    <div className="page-stack yt-screen" aria-busy={loading}>
      <p className="yt-intro">
        Questions where AI answers cite a YouTube video that isn&apos;t yours.
      </p>
      <section className="yt-numbers" aria-labelledby="yt-numbers-h">
        <SectionHead
          id="yt-numbers-h"
          title="Videos in AI Overviews"
          description={`${marketText} · ${scopeText}${
            screen.checkedAt ? ` · checked ${formatDate(screen.checkedAt)}` : ''
          }`}
        />
        {screen.checkedAt === null ? (
          <EmptyState
            compact
            icon="refresh"
            title="No check in this scope yet"
            body="Press Check now to see which overviews cite a video."
          />
        ) : (
          <KpiTiles stats={screen.stats} drills={drills} />
        )}
      </section>
      <div className="yt-tabs">
        <Tabs
          label="YouTube sections"
          tabs={[
            { id: 'ideas', label: 'Opportunities', count: ideas.length },
            { id: 'yours', label: 'Your videos', count: tracked.length },
            { id: 'channel', label: 'Channel' }
          ]}
          value={query.tab}
          onChange={query.setTab}
          panelId={PANEL}
        />
        <TabPanel panelId={PANEL} id={query.tab} className="yt-panel">
          {query.tab === 'ideas' ? (
            <>
              {assists?.({ projectId, screen, selected: open ?? ideas[0] ?? null }) ?? null}
              <IdeasGrid
                ideas={ideas}
                markets={screen.markets}
                step={query.step}
                onStep={query.setStep}
                selectedId={open?.id ?? null}
                onSelect={query.openIdea}
                drills={drills}
                filterControls={filters}
              />
              {query.ideaId !== null ? (
                <ScreenDrawerLevel onClose={query.closeIdea}>
                  {open ? (
                    <IdeaFlow
                      key={open.id}
                      source={client}
                      projectId={projectId}
                      idea={open}
                      drills={drills}
                      step={query.ideaStep ?? defaultFlowStep(open)}
                      onStep={query.setIdeaStep}
                      onIdea={applyIdea}
                      onClose={query.closeIdea}
                    />
                  ) : (
                    <Drawer
                      id="yt-idea"
                      title="Video idea"
                      testId="yt-idea-drawer"
                      error={{ message: 'This idea is not in this scope any more.' }}
                      onClose={query.closeIdea}
                    />
                  )}
                </ScreenDrawerLevel>
              ) : null}
            </>
          ) : query.tab === 'yours' ? (
            <YourVideos
              ideas={ideas}
              markets={screen.markets}
              drills={drills}
              filterControls={filters}
            />
          ) : (
            <ChannelSettings
              source={client}
              projectId={projectId}
              youtubeKey={screen.extras.youtubeKey}
              onChanged={reload}
            />
          )}
        </TabPanel>
      </div>
    </div>
  )
}
