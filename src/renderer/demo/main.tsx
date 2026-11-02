import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { IpcInvokeChannel } from '@shared/ipc'
import { App } from '../src/App'
import { loadUiFonts } from '../src/fontsReady'
import { startThemeSync } from '../src/theme/themeStore'
import '../src/styles.css'
import './demo.css'
import { calls, createDemoApi } from './bridge'
import { DemoBanner, DemoNotice } from './DemoChrome'
import { showDemoNotice } from './notice'
import { recordingRemote } from './record'
import { EMPTY_SNAPSHOT, type DemoSnapshot } from './snapshot'
// The recorded answers ship as their own file (about 0.5 MB gzipped), fetched once.
import snapshotUrl from './snapshot.json?url'

/**
 * The browser demo (site/demo, `npm run demo:build`): the real renderer with a
 * stand-in bridge that answers from recorded sample data (Docs/DEMO.md).
 */

declare const __CITEFOX_DEMO_BUILD__: { version: string; number: number; builtAt: string }

// A blocked call the person just asked for shows the notice. Calls the screens
// make on their own (no click or key in the last moment) stay quiet.
let lastInput = 0
for (const type of ['pointerdown', 'keydown']) {
  window.addEventListener(type, () => (lastInput = Date.now()), { capture: true })
}
const REPORT_FILES: ReadonlySet<string> = new Set([
  'reports:download',
  'exports:start',
  'exports:preview'
])
function onBlocked(channel: IpcInvokeChannel): void {
  if (Date.now() - lastInput > 2500) return
  showDemoNotice({ reports: REPORT_FILES.has(channel) })
}

async function loadSnapshot(): Promise<DemoSnapshot> {
  if (import.meta.env.VITE_CITEFOX_DEMO_RECORD === '1') return EMPTY_SNAPSHOT
  const response = await fetch(snapshotUrl)
  if (!response.ok) throw new Error(`The sample data did not load (${response.status})`)
  return (await response.json()) as DemoSnapshot
}

const snapshot = await loadSnapshot()

window.citefox = createDemoApi({
  snapshot,
  appInfo: {
    name: 'CiteFox',
    version: __CITEFOX_DEMO_BUILD__.version,
    build: {
      commit: null,
      number: __CITEFOX_DEMO_BUILD__.number,
      builtAt: __CITEFOX_DEMO_BUILD__.builtAt
    }
  },
  onBlocked,
  ...(import.meta.env.VITE_CITEFOX_DEMO_RECORD === '1' ? { remote: recordingRemote() } : {})
})

// The demo check reads this to spot a screen that keeps asking.
;(window as unknown as { __citefoxDemoCalls: Map<string, number> }).__citefoxDemoCalls = calls

startThemeSync()

const banner = document.getElementById('demo-chrome')
const root = document.getElementById('root')
if (!root || !banner) throw new Error('The demo page is missing #root or #demo-chrome')

createRoot(banner).render(
  <StrictMode>
    <DemoBanner />
    <DemoNotice />
  </StrictMode>
)

void loadUiFonts().then(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
})
