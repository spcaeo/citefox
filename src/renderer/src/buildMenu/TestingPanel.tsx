import type { JSX } from 'react'
import { Button, Panel } from '../ui'
import {
  FRESH_TEST_PROFILE,
  resetLabel,
  TEST_AS_NEW_USER,
  type useBuildActions
} from './useBuildActions'

/**
 * Settings › About "Testing": the build menu's three actions for trying a
 * build from the first run. Shares the build host's dialogs and toast.
 */
export function TestingPanel({
  actions,
  className
}: {
  actions: ReturnType<typeof useBuildActions>
  className?: string
}): JSX.Element {
  const { testProfile } = actions
  return (
    <Panel title="Testing" {...(className ? { className } : {})}>
      <p className="muted bm-panel-lead">
        {testProfile
          ? 'This window is the test profile. Its data and keys are separate from your real ones.'
          : 'Try a new build from the first run without losing your API keys.'}
      </p>
      <ul className="bm-panel-list">
        <li>
          <div>
            <p className="bm-panel-name">{resetLabel(testProfile).replace('…', '')}</p>
            <p className="muted">
              {testProfile
                ? 'Back to the first run in this window; its keys stay.'
                : 'Projects, settings and history go; your keys stay. A backup is kept.'}
            </p>
          </div>
          <Button size="sm" onClick={() => actions.openDialog('reset')}>
            Reset…
          </Button>
        </li>
        {testProfile ? null : (
          <>
            <li>
              <div>
                <p className="bm-panel-name">{TEST_AS_NEW_USER}</p>
                <p className="muted">
                  A second window with its own data and keys. Your real data is not touched.
                </p>
              </div>
              <Button size="sm" busy={actions.opening} onClick={() => void actions.testAsNewUser()}>
                Open test window
              </Button>
            </li>
            <li>
              <div>
                <p className="bm-panel-name">{FRESH_TEST_PROFILE.replace('…', '')}</p>
                <p className="muted">Clears the test profile and its keys first.</p>
              </div>
              <Button size="sm" onClick={() => actions.openDialog('fresh-test')}>
                Start fresh…
              </Button>
            </li>
          </>
        )}
      </ul>
    </Panel>
  )
}
