import { createRoot } from 'react-dom/client'
import { createMockPlaygroundClient } from '../playground/client'
import { createMockShellClient } from '../projects/mockClient'
import { AppShell } from '../shell/AppShell'
import '../styles.css'
import { createMockTemplatesClient } from '../templates/client'
import {
  TEXTBOLT_MARKETS,
  TEXTBOLT_PAGE,
  TEXTBOLT_PAGE_ID,
  textboltJob,
  textboltResults
} from './fixtures'
import { PageResultsScreen } from './PageResultsScreen'
import { RunningScreen } from './RunningScreen'

const screen = new URLSearchParams(window.location.search).get('screen')
const results = screen === 'results'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <AppShell
      location={{ kind: 'section', section: 'pages' }}
      bridgeError={null}
      client={createMockShellClient({ initialFinished: true })}
      templatesClient={createMockTemplatesClient()}
      playgroundClient={createMockPlaygroundClient()}
      content={
        results ? (
          <PageResultsScreen
            pageId={TEXTBOLT_PAGE_ID}
            projectName="TextBolt"
            page={TEXTBOLT_PAGE}
            marketId="us-en"
            onMarketChange={() => undefined}
            results={textboltResults()}
          />
        ) : (
          <RunningScreen
            pageId={TEXTBOLT_PAGE_ID}
            samples={TEXTBOLT_PAGE.samples}
            markets={TEXTBOLT_MARKETS}
            job={textboltJob()}
            onCancel={() => undefined}
            onStart={() => undefined}
          />
        )
      }
    />
  )
}
