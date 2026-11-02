import { useState, type JSX } from 'react'
import { useHashQuery } from '../utils/hashQuery'
import { useAiContext } from '../assistant/context/useAiContext'
import { DrillHost } from '../drill'
import type { OnboardingClient } from '../onboarding/client'
import type { OnboardingConnections } from '../onboarding/claudeLogin'
import type { AlertsClient } from '../alerts/client'
import { AppCheckTiming, AppEmailAccounts } from '../alerts/homes'
import { Button, TabPanel, Tabs } from '../ui'
import { AccountCard } from '../account/AccountCard'
import { AboutCard } from './components/AboutCard'
import type { PreviewSample } from '../celebrate/preview'
import { CelebrationsCard } from './components/CelebrationsCard'
import { ConnectionsCard } from './components/ConnectionsCard'
import { DataCard } from './components/DataCard'
import { DefaultsCard } from './components/DefaultsCard'
import { ReportsCard } from './components/ReportsCard'
import { GuideSettingsCard } from '../guide'
import { settingsAiPatch } from './aiContext'
import {
  SETTINGS_PANELS,
  SETTINGS_TABS,
  settingsTabFor,
  tabForErrors,
  type SettingsTab
} from './tabs'
import {
  settingsSaveError,
  validateSettings,
  type SettingsDraft,
  type SettingsErrors
} from './validate'
import './settings.css'

type SettingsScreenProps = {
  client: OnboardingClient
  /** Check timing and Email (they live here, shared by every project). */
  alertsClient: AlertsClient
  /** The open project, so Email can link its name to Project settings. */
  activeProjectId?: string | null
  overview: OnboardingConnections
  settings: SettingsDraft
  dataDirectory: string
  onChanged: () => Promise<void>
  /** The tab to open on when the URL names none, such as `data`. Default AI & searches. */
  initialTab?: SettingsTab
  /** The open project's brand and site, for the celebration Preview. */
  previewSample?: PreviewSample
}

/**
 * App-wide settings (FR-11, Mockups/Settings.dc.html, v2 tabs). Shares the
 * shell's drill drawer, or owns one when it stands alone (tests).
 */
export function SettingsScreen(props: SettingsScreenProps): JSX.Element {
  return (
    <DrillHost>
      <SettingsBody {...props} />
    </DrillHost>
  )
}

function SettingsBody({
  client,
  alertsClient,
  activeProjectId = null,
  overview,
  settings,
  dataDirectory,
  onChanged,
  initialTab = 'ai',
  previewSample
}: SettingsScreenProps): JSX.Element {
  const serp = overview.keys.find((key) => key.provider === 'serpapi') ?? null
  // The tab lives in the URL (`#/settings?tab=data`), so every tab has an address.
  const [query, setQuery] = useHashQuery(['tab'] as const)
  const tab = settingsTabFor(query.tab, initialTab)
  function setTab(next: SettingsTab): void {
    setQuery({ tab: next === initialTab ? null : next })
  }
  const [draft, setDraft] = useState(settings)
  const [seen, setSeen] = useState(settings)
  const [errors, setErrors] = useState<SettingsErrors>({})
  const [busy, setBusy] = useState(false)
  const [savedNote, setSavedNote] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  if (seen !== settings) {
    setSeen(settings)
    setDraft(settings)
  }

  useAiContext(
    settingsAiPatch({
      tab,
      draft,
      unsaved: JSON.stringify(draft) !== JSON.stringify(settings),
      serpKeys: overview.keys.filter((key) => key.provider === 'serpapi').length
    })
  )

  function patch(partial: Partial<SettingsDraft>): void {
    setDraft((current) => ({ ...current, ...partial }))
  }

  function showErrors(next: SettingsErrors): void {
    setErrors(next)
    const errorTab = tabForErrors(next)
    if (errorTab) setTab(errorTab)
  }

  async function save(): Promise<void> {
    const result = validateSettings(draft)
    if (!result.ok) {
      showErrors(result.errors)
      setSavedNote('')
      return
    }
    setErrors({})
    setBusy(true)
    setFormError(null)
    try {
      await client.updateSettings(result.patch)
      if (serp) await client.setKeyCap({ id: serp.id, cap: result.cap })
      setSavedNote('Settings saved.')
      await onChanged()
    } catch (error) {
      const failure = settingsSaveError(error)
      if (failure.field !== null) showErrors({ [failure.field]: failure.message })
      setFormError(failure.message)
      setSavedNote('')
    } finally {
      setBusy(false)
    }
  }

  const saves = tab === 'ai' || tab === 'general'

  return (
    <div className="page-stack stg-page">
      <Tabs
        label="Settings sections"
        tabs={SETTINGS_TABS}
        value={tab}
        onChange={setTab}
        panelId={SETTINGS_PANELS}
      />

      <TabPanel panelId={SETTINGS_PANELS} id="ai" hidden={tab !== 'ai'}>
        <ConnectionsCard
          client={client}
          overview={overview}
          serp={serp}
          draft={draft}
          errors={errors}
          patch={patch}
          onChanged={onChanged}
          savedClaudePath={settings.claudeBinaryPath}
          savedCodexPath={settings.codexBinaryPath ?? null}
        />
      </TabPanel>
      <TabPanel panelId={SETTINGS_PANELS} id="general" hidden={tab !== 'general'}>
        <div className="page-stack">
          <div className="stg-grid">
            <DefaultsCard draft={draft} errors={errors} patch={patch} />
            <div className="stg-span-4 stg-col">
              <CelebrationsCard client={client} previewSample={previewSample} />
            </div>
          </div>
          {tab === 'general' ? <AppCheckTiming client={alertsClient} /> : null}
          <GuideSettingsCard />
        </div>
      </TabPanel>
      <TabPanel panelId={SETTINGS_PANELS} id="email" hidden={tab !== 'email'}>
        {tab === 'email' ? (
          <AppEmailAccounts client={alertsClient} activeProjectId={activeProjectId} />
        ) : null}
      </TabPanel>
      <TabPanel panelId={SETTINGS_PANELS} id="reports" hidden={tab !== 'reports'}>
        {tab === 'reports' ? <ReportsCard brand={previewSample?.brand ?? ''} /> : null}
      </TabPanel>
      <TabPanel panelId={SETTINGS_PANELS} id="data" hidden={tab !== 'data'}>
        <div className="page-stack">
          <AccountCard />
          <DataCard client={client} dataDirectory={dataDirectory} />
          <AboutCard client={client} />
        </div>
      </TabPanel>

      <div className="stg-save" hidden={!saves}>
        <p role="status" aria-live="polite" className="stg-save-note">
          {formError ?? savedNote}
        </p>
        <Button variant="primary" busy={busy} onClick={() => void save()}>
          Save settings
        </Button>
      </div>
    </div>
  )
}
