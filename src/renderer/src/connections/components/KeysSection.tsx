import { useState, type JSX, type ReactNode } from 'react'
import type { ApiKeyMetadata, ConnectionActivityLog } from '@shared/domain'
import type { AdminClient } from '../../admin/client'
import type { OnboardingClient } from '../../onboarding/client'
import type { GuidedKeyProvider } from '../../keys/providerLinks'
import { Button, Panel, SectionHead } from '../../ui'
import { useKeyActions } from '../hooks/useKeyActions'
import { keysInRotation, type ProjectRef } from '../utils/model'
import { AddKeyForm } from './AddKeyForm'
import type { KeyFocusRequest } from '../utils/keyFocus'
import { KeyTable } from './KeyTable'
import { SectionStatus } from './SectionStatus'

/**
 * A provider with any number of keys (FR-11.1, FR-11.5): heading, add form, the key
 * table in rotation order, and one status panel. With no key the add form is open.
 */
export function KeysSection({
  id,
  heading,
  blurb,
  client,
  admin,
  provider,
  title,
  defaultName,
  addLabel,
  allKeys,
  projects,
  detailed,
  onChanged,
  children,
  footer,
  log = null,
  activeProjectId = null,
  focus = null
}: {
  id: string
  heading: string
  blurb: ReactNode
  client: OnboardingClient
  admin?: AdminClient
  provider: GuidedKeyProvider
  title: string
  defaultName: string
  addLabel: string
  allKeys: readonly ApiKeyMetadata[]
  projects: readonly ProjectRef[]
  detailed: boolean
  onChanged: () => Promise<void>
  /** The Rotation panel's content, beside `footer` under the table. */
  children?: ReactNode
  /** A panel beside Rotation, the same height. */
  footer?: ReactNode
  log?: ConnectionActivityLog | null
  activeProjectId?: string | null
  focus?: KeyFocusRequest | null
}): JSX.Element {
  const keys = keysInRotation(allKeys, provider)
  const [adding, setAdding] = useState(false)
  const actions = useKeyActions({ client, admin, provider, onChanged })
  const formOpen = keys.length === 0 || adding

  const extras = children || footer
  return (
    <section className="conn-section" aria-labelledby={id}>
      <SectionHead
        id={id}
        title={heading}
        description={blurb}
        actions={
          !formOpen ? (
            <Button icon="plus" onClick={() => setAdding(true)}>
              {addLabel}
            </Button>
          ) : null
        }
      />
      <div className="conn-main">
        {formOpen ? (
          <Panel title={`Connect ${title} in 3 steps`} titleAs="h3">
            <AddKeyForm
              client={client}
              provider={provider}
              title={title}
              defaultName={keys.length === 0 ? defaultName : `${defaultName} ${keys.length + 1}`}
              showCap={provider === 'serpapi'}
              canCancel={keys.length > 0}
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
        {keys.length > 0 ? (
          <KeyTable
            keys={keys}
            title={title}
            caption={`${title} keys in rotation order`}
            actions={actions}
            projects={projects}
            detailed={detailed}
            log={log}
            activeProjectId={activeProjectId}
            focus={focus}
          />
        ) : null}
        <SectionStatus message={actions.message} />
      </div>
      {extras ? (
        <div className="conn-row">
          {children ? (
            <Panel title="Rotation" titleAs="h3">
              {children}
            </Panel>
          ) : null}
          {footer}
        </div>
      ) : null}
    </section>
  )
}
