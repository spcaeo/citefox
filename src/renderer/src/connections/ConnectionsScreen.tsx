import { useState, type JSX } from 'react'
import { useHashQuery } from '../utils/hashQuery'
import type { ProjectDetail } from '@shared/ipc'
import type { AdminClient } from '../admin/client'
import { useAiContext } from '../assistant/context/useAiContext'
import { DrillHost } from '../drill'
import { CLORO_SIGNUP_URL } from '../keys/providerLinks'
import type { OnboardingClient } from '../onboarding/client'
import type { OnboardingConnections } from '../onboarding/claudeLogin'
import { ActivityStrip } from './components/ActivityStrip'
import { ClaudeSection } from './components/ClaudeSection'
import { KeysSection } from './components/KeysSection'
import type { KeyFocusRequest } from './utils/keyFocus'
import { RotationRule } from './components/RotationRule'
import { YouTubeSection } from './components/YouTubeSection'
import { useActivity } from './hooks/useActivity'
import { connectionFacts } from './aiContext'
import { keysInRotation, serpTotalsLine } from './utils/model'
import { useActiveProjectId } from './utils/projectLinks'
import type { UsageClient } from '../usage/client'
import { Panel, TabPanel, Tabs } from '../ui'

type ConnectionsTab = 'serpapi' | 'cloro' | 'claude' | 'jina' | 'youtube'

const TAB_IDS: readonly ConnectionsTab[] = ['cloro', 'serpapi', 'claude', 'jina', 'youtube']

/**
 * The tab a URL's `tab` value opens: `#/connections?tab=serpapi`. cloro by default, as
 * the recommended search provider (it covers every engine; SerpApi only Google AIO).
 */
function connectionsTabFor(value: string | null): ConnectionsTab {
  return TAB_IDS.find((id) => id === value) ?? 'cloro'
}

const PANELS = 'connections-panel'

/**
 * Connections (FR-11.1–11.11): any number of SerpApi, Jina, and Anthropic keys, the
 * rotation rule, each project's Claude connection, and the last 24 hours.
 * Secrets never reach this screen; keys show a masked hint only.
 */
export function ConnectionsScreen({
  client,
  overview,
  claudeModel,
  admin,
  projects = [],
  onChanged,
  usageClient
}: {
  client: OnboardingClient
  overview: OnboardingConnections
  claudeModel: string | null
  /** Multi-key editing, activity, and per-project Claude. */
  admin?: AdminClient
  projects?: readonly ProjectDetail[]
  onChanged: () => Promise<void>
  /** Tests only. Defaults to the usage client for this window's mode. */
  usageClient?: UsageClient
}): JSX.Element {
  const { activity, log, error } = useActivity(admin, overview)
  const refs = projects.map((project) => ({ id: project.id, name: project.name }))
  const activeProjectId = useActiveProjectId(projects)
  const serp = keysInRotation(overview.keys, 'serpapi')
  const cloro = keysInRotation(overview.keys, 'cloro')
  const youtube = overview.keys.find((key) => key.provider === 'youtube') ?? null
  const [focus, setFocus] = useState<KeyFocusRequest | null>(null)
  // The tab lives in the URL, so each provider's keys have an address.
  const [query, setQuery] = useHashQuery(['tab'] as const)
  const tab = connectionsTabFor(query.tab)
  function setTab(next: ConnectionsTab): void {
    setQuery({ tab: next === 'cloro' ? null : next })
  }
  useAiContext({ facts: connectionFacts(overview, claudeModel) })
  const drillProps = { log, activeProjectId, focus }
  const jinaCount = keysInRotation(overview.keys, 'jina').length
  const anthropicCount = keysInRotation(overview.keys, 'anthropic').length

  function showKey(keyId: string): void {
    const provider = overview.keys.find((key) => key.id === keyId)?.provider
    if (provider) setTab(provider === 'anthropic' ? 'claude' : provider)
    setFocus((current) => ({ keyId, seq: (current?.seq ?? 0) + 1 }))
  }

  return (
    <DrillHost>
      <div className="page-stack connections">
        <p className="muted">
          Add as many accounts as you need. CiteFox picks one for each call and moves to the next
          when one fails, hits its limit or runs out.{' '}
          <a href="#/permissions">See everything CiteFox needs</a>, with each permission&apos;s live
          state.
        </p>

        <ActivityStrip
          activity={admin ? activity : null}
          log={admin ? log : null}
          error={admin ? error : null}
          activeProjectId={activeProjectId}
          onShowKey={showKey}
        />

        <Tabs
          label="Connections"
          tabs={[
            {
              id: 'cloro',
              label: 'cloro',
              tag: 'Recommended',
              ...(cloro.length > 0 ? { count: cloro.length } : {})
            },
            { id: 'serpapi', label: 'SerpApi', count: serp.length },
            {
              id: 'claude',
              label: 'Claude',
              ...(anthropicCount > 0 ? { count: anthropicCount } : {})
            },
            { id: 'jina', label: 'Jina Reader', ...(jinaCount > 0 ? { count: jinaCount } : {}) },
            { id: 'youtube', label: 'YouTube', ...(youtube ? { count: 1 } : {}) }
          ]}
          value={tab}
          onChange={setTab}
          panelId={PANELS}
        />

        <TabPanel panelId={PANELS} id="serpapi" hidden={tab !== 'serpapi'}>
          <KeysSection
            id="serp-h"
            heading="SerpApi keys"
            blurb={
              <>
                <span className="conn-blurb-line">{serpTotalsLine(serp)}</span>
                <span className="conn-blurb-line">
                  SerpApi covers Google AI Overviews only. For ChatGPT, Perplexity, AI Mode, Gemini
                  and Copilot, add a cloro key.
                </span>
              </>
            }
            client={client}
            admin={admin}
            provider="serpapi"
            title="SerpApi"
            defaultName="SerpApi"
            addLabel="Add SerpApi key"
            allKeys={overview.keys}
            projects={refs}
            detailed
            onChanged={onChanged}
            {...drillProps}
            footer={
              <Panel title="Whose keys" titleAs="h3" tone="inset">
                <p className="hint">
                  Add keys you&apos;re entitled to use, such as your own plan or a client&apos;s.
                  Opening extra free accounts to get past the free limit is against SerpApi&apos;s
                  terms.
                </p>
              </Panel>
            }
          >
            <RotationRule client={client} value={overview.serpapiRotation} onChanged={onChanged} />
            <p className="hint">
              An AI Overview follow-up always uses the key of the search that produced it. A key
              that errors or is rate-limited gets one retry with the next key in order.
            </p>
          </KeysSection>
        </TabPanel>

        <TabPanel panelId={PANELS} id="cloro" hidden={tab !== 'cloro'}>
          <KeysSection
            id="cloro-h"
            heading="cloro keys"
            blurb={
              <>
                cloro: Google AI Overviews, AI Mode, ChatGPT, Perplexity, Gemini and Copilot with
                one key. With a cloro key saved, checks use cloro.{' '}
                <a href={CLORO_SIGNUP_URL} target="_blank" rel="noreferrer">
                  Sign up at cloro.dev
                </a>
              </>
            }
            client={client}
            admin={admin}
            provider="cloro"
            title="cloro"
            defaultName="cloro"
            addLabel="Add cloro key"
            allKeys={overview.keys}
            projects={refs}
            detailed
            onChanged={onChanged}
            {...drillProps}
          />
        </TabPanel>

        <TabPanel panelId={PANELS} id="claude" hidden={tab !== 'claude'}>
          <ClaudeSection
            client={client}
            admin={admin}
            allKeys={overview.keys}
            checkup={overview.claudeCheckup}
            claudeModel={claudeModel}
            projects={refs}
            refresh={overview}
            onChanged={onChanged}
            {...(usageClient ? { usageClient } : {})}
            {...drillProps}
          />
        </TabPanel>

        <TabPanel panelId={PANELS} id="jina" hidden={tab !== 'jina'}>
          <KeysSection
            id="jina-h"
            heading="Jina Reader keys (optional)"
            blurb="Used only when a normal page fetch fails. Keys rotate in order; without any key, Jina still works at lower rate limits."
            client={client}
            admin={admin}
            provider="jina"
            title="Jina"
            defaultName="Jina"
            addLabel="Add Jina key"
            allKeys={overview.keys}
            projects={refs}
            detailed={false}
            onChanged={onChanged}
            {...drillProps}
          />
        </TabPanel>

        <TabPanel panelId={PANELS} id="youtube" hidden={tab !== 'youtube'}>
          <YouTubeSection client={client} saved={youtube} onChanged={onChanged} />
        </TabPanel>

        <p className="hint">
          All keys are saved in your system keychain, never in project files or exports.
        </p>
      </div>
    </DrillHost>
  )
}
