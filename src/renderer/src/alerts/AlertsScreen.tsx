import { useEffect, useState, type JSX } from 'react'
import { useAiContext } from '../assistant/context/useAiContext'
import { useBuildTools } from '../buildMenu/buildClient'
import { ScreenHeader } from '../components/Header'
import { LoadError } from '../components/LoadError'
import { DrillHost } from '../drill'
import { useScopeOptions, type ScopeSource } from '../scope'
import { DrawerLevel } from '../shell/DrawerLevel'
import { closeDrawer, setDrawerParams, useDrawerStack } from '../shell/drawers'
import { sectionHash } from '../shell/routes'
import { TabPanel, Tabs, type HelpFillSource } from '../ui'
import { AlertLogTab } from './log/AlertLogTab'
import { RuleDrawer } from './rules/RuleDrawer'
import { createLiveRulesClient, type RulesClient } from './rules/rulesClient'
import { RulesTab } from './rules/RulesTab'
import { openRule, useRuleActions } from './rules/useRuleActions'
import { useRules } from './rules/useRules'
import { NotificationsSection } from './schedule/NotificationsSection'
import { SampleAlertPanel } from './schedule/SidePanels'
import { ProjectUnavailable } from './SchedulePanel'
import { ALERTS_TABS, alertsTabFor, alertsTabHash, type AlertsTab } from './tabs'
import type { AlertView, AlertsClient, EmailView } from './client'
import { alertsAiPatch } from './aiContext'
import './alerts.css'

const PANELS = 'alerts-panel'

const LIVE_RULES = createLiveRulesClient()

/**
 * Alerts (FR-23, tracking.md §6): this project's alert rules, where they go
 * (Notifications), and the log of what they sent. A rule opens in the
 * `alert-rule` drawer on the URL. The re-check cadence lives in Project
 * settings › Schedule; check timing and email accounts in App settings.
 */
export function AlertsScreen({
  client,
  rulesClient = LIVE_RULES,
  scopeSource = null,
  projectId,
  projectName,
  focus,
  tabParam,
  helpSource
}: {
  client: AlertsClient
  /** Alert rules, the dry run, the alert log and the Slack test. */
  rulesClient?: RulesClient
  /** The pages, groups, clusters and topics a rule can watch. */
  scopeSource?: ScopeSource | null
  projectId: string | null
  projectName: string
  /** The route part after `#/alerts/`: `notifications` or `log`. */
  focus?: string
  /** An older link's `?tab=`, used when the path names no tab. */
  tabParam?: string
  /** Tests only: a new rule's ✦ Describe it channels. */
  helpSource?: HelpFillSource
}): JSX.Element {
  const alerts = client
  const { notify } = useBuildTools()
  const [tab, setTab] = useState<AlertsTab>(() => alertsTabFor(focus, tabParam))
  const routeTab = `${focus ?? ''}\0${tabParam ?? ''}`
  const [seenRouteTab, setSeenRouteTab] = useState(routeTab)
  const ruleState = useRules(rulesClient, projectId)
  const scope = useScopeOptions(projectId, scopeSource)
  const ruleActions = useRuleActions(rulesClient, projectId, ruleState.reload)
  const drawers = useDrawerStack()
  const ruleDepth = drawers.stack.findIndex((entry) => entry.id === 'alert-rule')
  const ruleEntry = ruleDepth >= 0 ? drawers.stack[ruleDepth] : undefined
  const [alertView, setAlertView] = useState<AlertView | null>(null)
  const [email, setEmail] = useState<EmailView | null>(null)
  /** A save or test that failed after the screen loaded. */
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const requestKey = `${projectId ?? ''}\0${attempt}`
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const loading = loadedKey !== requestKey

  useAiContext(alertsAiPatch({ tab, app: null, project: null, alerts: alertView, email }))

  if (routeTab !== seenRouteTab) {
    setSeenRouteTab(routeTab)
    setTab(alertsTabFor(focus, tabParam))
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [emailResult, alertResult] = await Promise.all([
        alerts.getEmail(),
        projectId ? alerts.getAlerts({ projectId }) : Promise.resolve(null)
      ])
      if (cancelled) return
      setEmail(emailResult.value)
      setAlertView(alertResult?.value ?? null)
      setError(null)
      setLoadError(emailResult.unavailable?.reason ?? alertResult?.unavailable?.reason ?? null)
      setLoadedKey(requestKey)
    })()
    return () => {
      cancelled = true
    }
  }, [alerts, projectId, requestKey])

  function pick(next: AlertsTab): void {
    setTab(next)
    if (typeof window !== 'undefined' && window.location.hash.startsWith(sectionHash('alerts'))) {
      const hash = alertsTabHash(next)
      if (window.location.hash !== hash) window.location.hash = hash
    }
  }

  const ready = !loading && email !== null
  const projectReady = projectId !== null && alertView !== null
  const site = scope.options?.domain ?? null

  function rulesBody(): JSX.Element {
    if (projectId === null) {
      return (
        <ProjectUnavailable
          projectId={projectId}
          projectName={projectName}
          id="rules-h"
          heading="Alert rules"
        />
      )
    }
    if (ruleState.rules === null) {
      return ruleState.error ? (
        <LoadError
          title="Could not load the alert rules."
          message={ruleState.error}
          onRetry={ruleState.reload}
        />
      ) : (
        <p role="status">Loading the alert rules…</p>
      )
    }
    return (
      <RulesTab
        rules={ruleState.rules}
        options={scope.options}
        openRuleId={ruleEntry?.params['rule.id'] ?? null}
        actions={ruleActions}
      />
    )
  }

  return (
    <DrillHost>
      <div className="alerts page-stack">
        <ScreenHeader
          title="Alerts & schedules"
          subtitle={<p className="muted">Get told when something important changes.</p>}
        />
        {error ? <p role="alert">{error}</p> : null}
        {loading ? <p role="status">Loading alerts…</p> : null}
        {!loading && loadError ? (
          <LoadError
            title="Could not load alerts."
            message={loadError}
            onRetry={() => setAttempt((n) => n + 1)}
          />
        ) : null}
        {ready ? (
          <>
            <Tabs
              label="Alerts sections"
              tabs={ALERTS_TABS}
              value={tab}
              onChange={pick}
              panelId={PANELS}
            />
            <TabPanel panelId={PANELS} id="rules" hidden={tab !== 'rules'}>
              {tab === 'rules' ? rulesBody() : null}
            </TabPanel>
            <TabPanel panelId={PANELS} id="notifications" hidden={tab !== 'notifications'}>
              {projectReady ? (
                <div className="al-grid">
                  <div className="al-main">
                    <NotificationsSection
                      alerts={alertView}
                      email={email}
                      onPatch={async (patch) => {
                        const result = await client.updateAlerts(patch)
                        if (result.value) setAlertView(result.value)
                        setError(result.unavailable?.reason ?? null)
                        if (result.value) ruleState.reload()
                        return result.value
                      }}
                      onTestSlack={(webhook) => rulesClient.testSlack(alertView.projectId, webhook)}
                    />
                  </div>
                  <div className="al-rail">
                    <SampleAlertPanel alerts={alertView} projectName={projectName} />
                  </div>
                </div>
              ) : (
                <div className="al-main">
                  <ProjectUnavailable
                    projectId={projectId}
                    projectName={projectName}
                    id="notifications-h"
                    heading="Notifications"
                  />
                </div>
              )}
            </TabPanel>
            <TabPanel panelId={PANELS} id="log" hidden={tab !== 'log'}>
              {tab === 'log' && projectId !== null ? (
                <AlertLogTab
                  client={rulesClient}
                  projectId={projectId}
                  rules={ruleState.rules ?? []}
                  markets={scope.options?.markets ?? []}
                  site={site}
                  onOpenRule={openRule}
                />
              ) : tab === 'log' ? (
                <ProjectUnavailable
                  projectId={projectId}
                  projectName={projectName}
                  id="log-h"
                  heading="Alert log"
                />
              ) : null}
            </TabPanel>
          </>
        ) : null}
      </div>
      {ruleEntry && projectId !== null ? (
        <DrawerLevel depth={ruleDepth}>
          <RuleDrawer
            key={`${ruleEntry.params['rule.id'] ?? 'new'}:${ruleEntry.params['rule.from'] ?? ''}`}
            projectId={projectId}
            ruleId={ruleEntry.params['rule.id'] ?? 'new'}
            fromId={ruleEntry.params['rule.from'] ?? null}
            rules={ruleState.rules}
            slackReady={ruleState.slackReady}
            defaultEmails={alertView?.emailTo ?? []}
            scope={scope}
            client={rulesClient}
            query={ruleEntry.params['rule.q'] ?? ''}
            onQuery={(query) => setDrawerParams(ruleDepth, { 'rule.q': query })}
            onSaved={(rule, created) => {
              ruleState.reload()
              closeDrawer(ruleDepth)
              notify(
                created
                  ? `Saved “${rule.name}”. It runs after every check.`
                  : `Saved “${rule.name}”.`,
                'ok'
              )
            }}
            onDeleted={(rule) => {
              ruleState.reload()
              closeDrawer(ruleDepth)
              notify(`Deleted “${rule.name}”.`, 'ok')
            }}
            onClose={() => closeDrawer(ruleDepth)}
            {...(helpSource ? { helpSource } : {})}
          />
        </DrawerLevel>
      ) : null}
    </DrillHost>
  )
}
