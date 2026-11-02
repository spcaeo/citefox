import { useEffect, type JSX } from 'react'
import { sectionHash } from '../shell/routes'
import { ensureActivityFeed } from './activity'
import { CheckScreen } from './CheckScreen'
import { ChooseScreen } from './ChooseScreen'
import { startClient, type StartClient } from './client'
import { FoundScreen } from './FoundScreen'
import { PlanScreen } from './PlanScreen'
import { StartResultsScreen } from './ResultsScreen'
import { SetupScreen } from './SetupScreen'
import type { StartProject } from './types'

/**
 * The first-run journey routes (focus mode, no app frame): `#/start/choose`
 * asks how to start (CiteFox sets it up, or the user picks), `#/start/setup`
 * reads the site, `#/start` shows what was found, `#/start/plan` the starting
 * plan, `#/start/check` the first check, `#/start/results` the first results.
 * Each screen is keyed by the project so switching project starts fresh.
 */
export function StartRoute({
  step,
  project,
  searchesLeft,
  client = startClient()
}: {
  step: string | undefined
  project: StartProject | null
  searchesLeft: number | null
  client?: StartClient
}): JSX.Element {
  // The Activity panel lists what happened here too, once the user is back in the app.
  useEffect(() => {
    ensureActivityFeed(client)
  }, [client])
  if (project === null) {
    return (
      <main className="ob-loading" id="main" tabIndex={-1}>
        <p>
          Create a project first.{' '}
          <a className="sf-link" href={sectionHash('new-project')}>
            New project
          </a>
        </p>
      </main>
    )
  }
  if (step === 'choose') {
    return (
      <ChooseScreen
        key={project.id}
        client={client}
        project={project}
        searchesLeft={searchesLeft}
      />
    )
  }
  if (step === 'setup') {
    return (
      <SetupScreen key={project.id} client={client} project={project} searchesLeft={searchesLeft} />
    )
  }
  if (step === 'plan') return <PlanScreen key={project.id} client={client} project={project} />
  if (step === 'check') return <CheckScreen key={project.id} client={client} project={project} />
  if (step === 'results') {
    return <StartResultsScreen key={project.id} client={client} project={project} />
  }
  return <FoundScreen key={project.id} client={client} project={project} />
}
