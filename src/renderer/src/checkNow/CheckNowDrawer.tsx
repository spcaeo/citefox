import { useMemo, type JSX } from 'react'
import { useBuildTools } from '../buildMenu/buildClient'
import { Drawer } from '../ui'
import { CheckNowBody } from './components/CheckNowBody'
import { useCheckNow } from './hooks/useCheckNow'
import {
  checkParamsPatch,
  hasScopeParam,
  parseCheckParams,
  planSummary,
  type CheckNowState,
  type CheckParams
} from './model'
import { runCheck } from './run'
import { createCheckNowSource, type CheckNowSource } from './source'
import './checkNow.css'

export interface CheckNowDrawerProps {
  projectId: string
  /** The drawer's values on the URL (`check.*`). */
  params: CheckParams
  /** Writes a change to the URL; `push` makes it its own Back step. */
  onParams: (patch: Record<string, string | null>, push: boolean) => void
  onClose: () => void
  /** Tests pass a fake; production reads the preload bridge. */
  source?: CheckNowSource
}

/**
 * Check now (`?drawer=check-now`, tracking.md §3): pick what to check (due,
 * every tracked page, pages, topics, groups or clusters), the markets and the
 * questions, see the searches it can use, then Check now. Every choice is on
 * the URL (`check.*`), so a copied link reopens the same check. Other screens
 * open it with `openDrawer('check-now', { 'check.scope': 'pages', 'check.ids': ids })`.
 */
export function CheckNowDrawer({
  projectId,
  params,
  onParams,
  onClose,
  source: given
}: CheckNowDrawerProps): JSX.Element {
  const source = useMemo(() => given ?? createCheckNowSource(), [given])
  const tools = useBuildTools()
  const key = JSON.stringify(params)
  // Parsed once per URL, so the data hooks see a stable state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const parsed = useMemo(() => parseCheckParams(params), [key])
  // Without a scope on the URL the first scope with something to check is used.
  const data = useCheckNow(projectId, parsed, source, hasScopeParam(params))
  const { plan, options, state } = data

  function change(patch: Partial<CheckNowState>, push = false): void {
    onParams(checkParamsPatch(patch), push)
  }

  function run(): void {
    if (!plan || plan.blocked !== null) return
    if (runCheck(source, tools.notify, projectId, plan)) onClose()
  }

  const nothingDue = state.scope.kind === 'due' && plan?.blocked?.startsWith('Nothing is due')
  const wayOut = plan?.wayOut ?? null
  return (
    <Drawer
      id="check-now"
      title="Check now"
      subtitle="Pick what to check. Nothing is searched until you press Check now."
      className="cn2-drawer"
      testId="check-now-drawer"
      onClose={onClose}
      footer={{
        summary:
          plan === null || options === null ? (
            'Loading the pages…'
          ) : plan.blocked !== null ? (
            <span className="cn2-blocked" data-testid="check-now-reason">
              {plan.blocked}
            </span>
          ) : (
            <span data-testid="check-now-cost">{planSummary(plan, options)}</span>
          ),
        ...(wayOut
          ? {
              secondary: {
                label: wayOut.label,
                onClick: () => change(wayOut.patch, true),
                testId: 'check-now-way-out'
              }
            }
          : nothingDue
            ? {
                secondary: {
                  label: 'Pick pages instead',
                  onClick: () => change({ scope: { kind: 'pages', ids: [] } }, true)
                }
              }
            : {}),
        primary: {
          label: 'Check now',
          icon: 'refresh',
          disabled: plan === null || plan.blocked !== null,
          onClick: run,
          testId: 'check-now-run'
        }
      }}
    >
      <CheckNowBody state={state} data={data} onChange={change} />
    </Drawer>
  )
}
