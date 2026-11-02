import { useState, type JSX } from 'react'
import type { ApiKeyMetadata, ConnectionActivityLog } from '@shared/domain'
import type { AdminClient } from '../../admin/client'
import type { OnboardingCheckupResult } from '../../onboarding/claudeLogin'
import type { OnboardingClient } from '../../onboarding/client'
import type { UsageClient } from '../../usage/client'
import { ClaudeUsage } from '../../usage/ClaudeUsage'
import { Button, Panel, SectionHead } from '../../ui'
import { CheckupControls } from '../CheckupControls'
import { useKeyActions } from '../hooks/useKeyActions'
import { keysInRotation, type ProjectRef } from '../utils/model'
import { AddKeyForm } from './AddKeyForm'
import type { KeyFocusRequest } from '../utils/keyFocus'
import { KeyTable } from './KeyTable'
import { ProjectClaudeTable } from './ProjectClaudeTable'
import { SectionStatus } from './SectionStatus'

/**
 * FR-11.6–11.8. One Claude Code login plus any number of Anthropic API keys, each
 * tested on save, and which connection each project uses.
 */
export function ClaudeSection({
  client,
  admin,
  allKeys,
  checkup,
  claudeModel,
  projects,
  refresh,
  onChanged,
  usageClient,
  log = null,
  activeProjectId = null,
  focus = null
}: {
  client: OnboardingClient
  admin?: AdminClient
  allKeys: readonly ApiKeyMetadata[]
  checkup: OnboardingCheckupResult | null
  claudeModel: string | null
  projects: readonly ProjectRef[]
  refresh: unknown
  onChanged: () => Promise<void>
  /** Tests only. Defaults to the usage client for this window's mode. */
  usageClient?: UsageClient
  log?: ConnectionActivityLog | null
  activeProjectId?: string | null
  focus?: KeyFocusRequest | null
}): JSX.Element {
  const keys = keysInRotation(allKeys, 'anthropic')
  const [adding, setAdding] = useState(false)
  const actions = useKeyActions({ client, admin, provider: 'anthropic', onChanged })

  return (
    <section className="conn-section" aria-labelledby="claude-h">
      <SectionHead
        id="claude-h"
        title="Claude"
        description="Writes buyer profiles, questions, gap analysis, sentiment claims and summaries"
        actions={
          !adding ? (
            <Button icon="plus" onClick={() => setAdding(true)}>
              Add Anthropic API key
            </Button>
          ) : null
        }
      />
      <div className="conn-split">
        <Panel title="Claude Code login" titleAs="h3">
          <CheckupControls
            client={client}
            checkup={checkup}
            claudeModel={claudeModel}
            onChanged={onChanged}
          />
        </Panel>
        <Panel title="One login per computer" titleAs="h3" tone="inset" padding={20}>
          <p className="hint">
            CiteFox uses whoever is logged in to Claude Code on this computer. It doesn&apos;t
            rotate between several Claude subscription accounts, because Anthropic&apos;s terms
            don&apos;t allow using multiple accounts to get around usage limits. For more capacity
            or for client work, add an Anthropic API key.
          </p>
        </Panel>
      </div>
      {/* FR-25.6: Claude calls today and this month, from llm_calls. */}
      <Panel>
        <ClaudeUsage
          card={false}
          variant="full"
          {...(usageClient ? { client: usageClient } : {})}
        />
      </Panel>
      {adding ? (
        <Panel title="Connect an Anthropic API key in 3 steps" titleAs="h3">
          <AddKeyForm
            client={client}
            provider="anthropic"
            title="Anthropic"
            defaultName={keys.length === 0 ? 'My key' : `Key ${keys.length + 1}`}
            showCap={false}
            canCancel
            hasAccount={keys.length > 0}
            onCancel={() => setAdding(false)}
            onAdded={async (_key, message) => {
              setAdding(false)
              actions.say(message)
              await onChanged()
            }}
          />
        </Panel>
      ) : null}
      <div className="conn-block">
        <SectionHead title="Anthropic API keys" level={3} />
        {keys.length > 0 ? (
          <>
            <p className="hint">
              Billed to the key&apos;s Anthropic account. Set spend caps in the Anthropic Console.
              Each key is tested when it is saved.
            </p>
            <KeyTable
              keys={keys}
              title="Anthropic"
              caption="Anthropic API keys"
              actions={actions}
              projects={projects}
              detailed={false}
              ordered={false}
              log={log}
              activeProjectId={activeProjectId}
              focus={focus}
            />
          </>
        ) : (
          <p className="hint">
            No Anthropic API key yet. Add one for client projects, shared computers, or more
            capacity.
          </p>
        )}
        <SectionStatus message={actions.message} />
      </div>
      {admin ? (
        <ProjectClaudeTable
          admin={admin}
          anthropic={keys}
          refresh={refresh}
          activeProjectId={activeProjectId}
          onKeysChanged={onChanged}
        />
      ) : null}
    </section>
  )
}
