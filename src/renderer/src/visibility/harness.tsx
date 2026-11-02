import { type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import type { ProjectScoreSummary } from '@shared/domain'
import { createMockPlaygroundClient } from '../playground/client'
import { createMockShellClient } from '../projects/mockClient'
import { AppShell } from '../shell/AppShell'
import '../styles.css'
import { createMockTemplatesClient } from '../templates/client'
import { TEXTBOLT_MARKETS } from '../m3/fixtures'
import { markersFor } from './chart.sample'
import { CitationsScreen } from './CitationsScreen'
import { emptyResults, mockVisibilitySource } from './mocks'
import { progressDetail } from './progress.sample'
import { ProgressAfterChart, SampleMarkets, WhatChangedSection } from './ProgressSample'
import { ScoresScreen } from './ScoresScreen'
import type { VisibilitySource } from './source'

const screen = new URLSearchParams(window.location.search).get('screen') ?? 'scores'
const market = TEXTBOLT_MARKETS[0]
const detail = progressDetail('alerts')
const populated = mockVisibilitySource()

function emptySource(): VisibilitySource {
  const summary: ProjectScoreSummary = {
    projectId: 'textbolt',
    averageScore: null,
    change: null,
    nextCheckAt: null,
    searchesUsed: 0,
    searchCap: null,
    pagesDueToday: 0
  }
  return {
    'results:get': () => Promise.resolve(emptyResults()),
    'results:history': (request) =>
      Promise.resolve({
        pageId: request.pageId,
        marketId: request.marketId ?? 'us-en',
        promptSetVersion: null,
        points: []
      }),
    'scores:listProjects': () =>
      Promise.resolve({ projects: [], searchesUsed: 0, nextCheckAt: null }),
    'scores:listPages': () => Promise.resolve({ projectId: 'textbolt', summary, pages: [] })
  }
}

function content(): JSX.Element {
  if (!market) return <p role="status">Missing market.</p>
  if (screen === 'empty') {
    return (
      <>
        <CitationsScreen
          source={emptySource()}
          projectId="textbolt"
          pageId="alerts"
          marketId="us-en"
          market={market}
        />
        <ScoresScreen
          source={emptySource()}
          projectId="textbolt"
          pageId="alerts"
          marketId="us-en"
          market={market}
          markets={TEXTBOLT_MARKETS}
        />
      </>
    )
  }
  if (screen === 'citations') {
    return (
      <CitationsScreen
        source={populated}
        projectId="textbolt"
        pageId="alerts"
        marketId="us-en"
        market={market}
      />
    )
  }
  if (!detail) return <p role="status">Missing sample.</p>
  return (
    <ScoresScreen
      source={populated}
      projectId="textbolt"
      pageId="alerts"
      marketId="us-en"
      market={market}
      markets={TEXTBOLT_MARKETS}
      sample={{
        markers: markersFor('alerts'),
        rateFootnote: detail.rateFootnote,
        renderBefore: (onDrill) => <WhatChangedSection detail={detail} onDrill={onDrill} />,
        renderAfter: (onDrill) => <ProgressAfterChart detail={detail} onDrill={onDrill} />,
        renderMarkets: () => <SampleMarkets detail={detail} />
      }}
    />
  )
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <AppShell
      location={{ kind: 'section', section: 'pages' }}
      bridgeError={null}
      client={createMockShellClient({ initialFinished: true })}
      templatesClient={createMockTemplatesClient()}
      playgroundClient={createMockPlaygroundClient()}
      content={content()}
    />
  )
}
