import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ApiKeyMetadata } from '@shared/domain'
import type { AppSettingsSnapshot, StatusCapsule } from '@shared/ipc'
import type { OnboardingClient } from '../onboarding/client'
import type { OnboardingConnections } from '../onboarding/claudeLogin'
import { errorText } from '../components/errorText'
import { draftFromSettings, type SettingsDraft } from '../settings/validate'

/** Shown until `status:getCapsule` answers, and kept if it fails. Matches a profile with no keys. */
const UNCONFIGURED_CAPSULE: StatusCapsule = {
  searchesLeft: null,
  issueCount: 0,
  serpapi: 'off',
  claudeCode: 'unchecked',
  jina: 'off',
  youtube: 'off'
}

const NO_KEYS: readonly ApiKeyMetadata[] = []

export function useAppData(client: OnboardingClient): {
  overview: OnboardingConnections | null
  snapshot: AppSettingsSnapshot | null
  settingsDraft: SettingsDraft | null
  capsule: StatusCapsule
  keys: readonly ApiKeyMetadata[]
  /** The first load failure, connections before settings. */
  loadError: string | null
  /** Why the connections overview could not be read. The Connections screen needs it. */
  overviewError: string | null
  /** Why the settings file could not be read. The Settings screen needs it and the overview. */
  settingsError: string | null
  reload: () => Promise<void>
} {
  const [overview, setOverview] = useState<OnboardingConnections | null>(null)
  const [snapshot, setSnapshot] = useState<AppSettingsSnapshot | null>(null)
  const [capsule, setCapsule] = useState<StatusCapsule>(UNCONFIGURED_CAPSULE)
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const sequence = useRef(0)

  const reload = useCallback(async () => {
    const ticket = ++sequence.current
    const [overviewResult, capsuleResult, settingsResult] = await Promise.allSettled([
      client.getOverview(),
      client.getCapsule(),
      client.getSettings()
    ])
    if (ticket !== sequence.current) return
    if (overviewResult.status === 'fulfilled') setOverview(overviewResult.value)
    if (settingsResult.status === 'fulfilled') setSnapshot(settingsResult.value)
    if (capsuleResult.status === 'fulfilled') setCapsule(capsuleResult.value)
    setOverviewError(
      overviewResult.status === 'rejected'
        ? errorText(overviewResult.reason, 'Could not load connections.')
        : null
    )
    setSettingsError(
      settingsResult.status === 'rejected'
        ? errorText(settingsResult.reason, 'Could not load settings.')
        : null
    )
  }, [client])

  useEffect(() => {
    void Promise.resolve().then(reload)
    return () => {
      sequence.current += 1
    }
  }, [reload])

  const serp = overview?.keys.find((key) => key.provider === 'serpapi')
  const budget = serp && serp.cap !== null ? String(serp.cap) : ''
  const settingsDraft = useMemo(
    () => (snapshot ? draftFromSettings(snapshot.settings, budget) : null),
    [snapshot, budget]
  )

  return {
    overview,
    snapshot,
    settingsDraft,
    capsule,
    keys: overview?.keys ?? NO_KEYS,
    loadError: overviewError ?? settingsError,
    overviewError,
    settingsError,
    reload
  }
}
