import { useCallback, useEffect, useMemo, useState, type JSX, type ReactNode } from 'react'
import type { OnboardingDraft, OnboardingState } from '@shared/ipc'
import { loadAppClients, type AppClients } from './data/clients'
import { currentClientMode } from './onboarding/flags'
import { OnboardingApp } from './onboarding/OnboardingApp'
import { loadSetupClients, type SetupClients } from './onboarding/setupClients'
import { AppShell } from './shell/AppShell'
import { createPlaygroundClient } from './playground/client'
import { createTemplatesClient } from './templates/client'
import { navigateHash, parseHash, type ShellLocation } from './shell/routes'
import { afterOnboardingHash } from './start/choice'
import { errorText } from './components/errorText'
import { Button } from './ui'
import { loadPermissionsClient, type PermissionsClient } from './permissions/client'
import { PermissionsProvider } from './permissions/PermissionsProvider'
import { BuildToolsHost, loadAppInfo } from './buildMenu'
import { WorkConsoleHost } from './console'
import { ACCOUNT_OFF, ipcAccountClient, type AccountClient } from './account/client'
import { JoinScreen } from './account/JoinScreen'
import { IntroHost } from './intro/IntroHost'
import { ReleaseLine } from './shell/ReleaseLine'
import type { AccountStatus } from '@shared/ipc'

type Gate =
  | { kind: 'loading' }
  | { kind: 'failed'; message: string }
  | { kind: 'onboarding'; state: OnboardingState; draft: OnboardingDraft | null }
  | { kind: 'shell' }

export function App(): JSX.Element {
  const [location, setLocation] = useState<ShellLocation>(() => parseHash(window.location.hash))
  const [bridgeError, setBridgeError] = useState<string | null>(() =>
    window.citefox ? null : 'The preload bridge is missing.'
  )
  const [gate, setGate] = useState<Gate>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [clients, setClients] = useState<AppClients | null>(null)
  const [permissions, setPermissions] = useState<PermissionsClient | null>(null)
  const [setupClients, setSetupClients] = useState<SetupClients | null>(null)
  const mode = useMemo(() => currentClientMode(), [])
  // "Join CiteFox" comes first when this build registers (Docs/PRIVACY.md).
  const accountClient = useMemo<AccountClient | null>(
    () => (mode === 'ipc' ? ipcAccountClient() : null),
    [mode]
  )
  const [account, setAccount] = useState<AccountStatus | null>(() =>
    accountClient ? null : ACCOUNT_OFF
  )
  const templatesClient = useMemo(() => createTemplatesClient(mode), [mode])
  const playgroundClient = useMemo(() => createPlaygroundClient(mode), [mode])

  useEffect(() => {
    function onHash(): void {
      setLocation(parseHash(window.location.hash))
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    const bridge = window.citefox
    if (!bridge) return
    let cancelled = false
    // Also fills the shared app info the build chips read.
    loadAppInfo(() => bridge['app:getInfo']()).catch((cause: unknown) => {
      if (cancelled) return
      setBridgeError(errorText(cause, 'Could not read the app version.'))
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    loadAppClients(mode)
      .then(async (loaded) => ({
        loaded,
        permissionsClient: await loadPermissionsClient(mode, loaded.shell),
        setup: await loadSetupClients(mode, loaded.shell)
      }))
      .then(
        ({ loaded, permissionsClient, setup }) => {
          if (cancelled) return
          setPermissions(permissionsClient)
          setSetupClients(setup)
          setClients(loaded)
        },
        (error: unknown) => {
          if (!cancelled) setGate(failedGate(error))
        }
      )
    return () => {
      cancelled = true
    }
  }, [mode])

  useEffect(() => {
    if (!clients) return
    let cancelled = false
    const shell = clients.shell
    shell
      .getState()
      .then(async (state) => ({
        state,
        // Docs/FEEDBACK.md batch 2 row 4: reopen on the same step with the same data.
        // A missing or unreadable draft only means starting from the saved state.
        draft: state.finished
          ? null
          : await Promise.resolve()
              .then(() => shell.getDraft())
              .catch(() => null)
      }))
      .then(
        ({ state, draft }) => {
          if (cancelled) return
          setGate(state.finished ? { kind: 'shell' } : { kind: 'onboarding', state, draft })
        },
        (error: unknown) => {
          if (!cancelled) setGate(failedGate(error))
        }
      )
    return () => {
      cancelled = true
    }
  }, [clients, attempt])

  useEffect(() => {
    if (!accountClient) return
    let cancelled = false
    // An account that cannot be read never blocks the app.
    accountClient.get().then(
      (status) => {
        if (!cancelled) setAccount(status)
      },
      () => {
        if (!cancelled) setAccount(ACCOUNT_OFF)
      }
    )
    return () => {
      cancelled = true
    }
  }, [accountClient])

  const retry = useCallback(() => {
    setGate({ kind: 'loading' })
    setAttempt((current) => current + 1)
  }, [])

  if (gate.kind === 'failed') {
    return (
      <main className="ob-loading">
        <div role="alert">
          <p>CiteFox could not load your setup. {gate.message}</p>
        </div>
        <Button onClick={retry}>Try again</Button>
        <ReleaseLine />
      </main>
    )
  }

  if (gate.kind === 'loading' || !clients || account === null) {
    return (
      <main className="ob-loading" aria-live="polite">
        <p>Loading setup…</p>
        <ReleaseLine />
      </main>
    )
  }

  if (accountClient && account.enabled && !account.joined) {
    return (
      <>
        <JoinScreen client={accountClient} onJoined={setAccount} />
        <IntroHost firstRun />
        <ReleaseLine />
      </>
    )
  }

  // "What CiteFox needs" and the Claude status, shared by onboarding and every screen,
  // the build menu's dialogs and toast, and the work console (one host per window).
  const withPermissions = (node: ReactNode): JSX.Element => (
    <BuildToolsHost client={clients.shell}>
      {permissions ? <PermissionsProvider client={permissions}>{node}</PermissionsProvider> : node}
      <WorkConsoleHost quiet={gate.kind === 'onboarding'} />
    </BuildToolsHost>
  )

  if (gate.kind === 'onboarding') {
    return withPermissions(
      <>
        <OnboardingApp
          client={clients.shell}
          initialState={gate.state}
          initialDraft={gate.draft}
          {...(setupClients
            ? { sections: setupClients.sections, services: setupClients.services }
            : {})}
          onFinished={(landing) => {
            // Setup made a topic and started its first check: open it. Otherwise let the
            // user pick how to start (owner feedback 6), never force setup.
            navigateHash(landing ?? afterOnboardingHash())
            setGate({ kind: 'shell' })
          }}
        />
        <ReleaseLine />
      </>
    )
  }

  return withPermissions(
    <AppShell
      location={location}
      bridgeError={bridgeError}
      client={clients.shell}
      templatesClient={templatesClient}
      playgroundClient={playgroundClient}
      reportsClient={clients.reports}
      alertsClient={clients.alerts}
      schedulesClient={clients.schedules}
      adminClient={clients.admin}
      allPagesSource={clients.allPages}
      questionSearch={clients.questionSearch}
    />
  )
}

function failedGate(error: unknown): Gate {
  return {
    kind: 'failed',
    message: errorText(error, 'Could not load setup.')
  }
}
