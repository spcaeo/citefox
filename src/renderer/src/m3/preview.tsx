import { createRoot } from 'react-dom/client'
import '../styles.css'
import {
  TEXTBOLT_MARKETS,
  TEXTBOLT_PAGE,
  TEXTBOLT_PAGE_ID,
  textboltJob,
  textboltResults
} from './fixtures'
import { PageResultsScreen } from './PageResultsScreen'
import { RunningScreen } from './RunningScreen'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <main>
      <section aria-label="Running.dc.html">
        <RunningScreen
          pageId={TEXTBOLT_PAGE_ID}
          samples={TEXTBOLT_PAGE.samples}
          markets={TEXTBOLT_MARKETS}
          job={textboltJob()}
          onCancel={() => undefined}
          onStart={() => undefined}
        />
      </section>
      <section aria-label="Overview.dc.html">
        <PageResultsScreen
          pageId={TEXTBOLT_PAGE_ID}
          projectName="TextBolt"
          page={TEXTBOLT_PAGE}
          marketId="us-en"
          onMarketChange={() => undefined}
          results={textboltResults()}
        />
      </section>
    </main>
  )
}
