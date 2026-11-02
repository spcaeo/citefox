import { useMemo, useSyncExternalStore, type JSX } from 'react'
import { useBuildTools } from '../buildMenu/buildClient'
import { DRAWER_KINDS, drawerOwnedKeys } from '../shell/drawerUrl'
import { Button } from '../ui'
import { writeQuery } from '../utils/queryState'
import { CheckNowBody } from './components/CheckNowBody'
import { useCheckNow } from './hooks/useCheckNow'
import { checkParamsPatch, parseCheckParams, planSummary, type CheckNowState } from './model'
import { runCheck } from './run'
import { createCheckNowSource, type CheckNowSource } from './source'
import './checkNow.css'

const KEYS: readonly string[] = DRAWER_KINDS['check-now'].params

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

/** The screen's own `check.*` values (a Check now drawer open over it keeps its own). */
function screenCheckKey(): string {
  const hash = window.location.hash
  const at = hash.indexOf('?')
  const params = new URLSearchParams(at < 0 ? '' : hash.slice(at + 1))
  const owned = drawerOwnedKeys(params)
  const own: Record<string, string> = {}
  for (const key of KEYS) {
    const value = params.get(key)
    if (value && !owned.has(key)) own[key] = value
  }
  return JSON.stringify(own)
}

/**
 * `#/check`: the Check now picker on the screen itself, the same body and
 * plan as the drawer, its state on the screen's URL (`#/check?check.scope=…`),
 * and Check now in a footer row.
 */
export function CheckNowPanel({
  projectId,
  source: given
}: {
  projectId: string
  source?: CheckNowSource
}): JSX.Element {
  const source = useMemo(() => given ?? createCheckNowSource(), [given])
  const tools = useBuildTools()
  const key = useSyncExternalStore(subscribe, screenCheckKey, () => '{}')
  const state = useMemo(() => parseCheckParams(JSON.parse(key) as Record<string, string>), [key])
  const data = useCheckNow(projectId, state, source)
  const { plan, options } = data

  function change(patch: Partial<CheckNowState>, push = false): void {
    writeQuery(checkParamsPatch(patch), push ? 'push' : 'replace')
  }

  return (
    <section className="cn2-screen" aria-label="Choose what to check" data-testid="check-now-panel">
      <CheckNowBody state={state} data={data} onChange={change} />
      <div className="cn2-screen-foot">
        <span className="cn2-screen-foot-text" data-testid="check-now-panel-summary">
          {plan === null || options === null
            ? 'Loading the pages…'
            : (plan.blocked ?? planSummary(plan, options))}
        </span>
        <Button
          variant="primary"
          icon="refresh"
          disabled={plan === null || plan.blocked !== null}
          onClick={() => {
            if (plan && plan.blocked === null) runCheck(source, tools.notify, projectId, plan)
          }}
        >
          Check now
        </Button>
      </div>
    </section>
  )
}
