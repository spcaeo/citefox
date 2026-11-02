import type { JSX } from 'react'
import { Icon } from '../../components/Icon'
import { DrillButton, DrillFigure } from '../../drill'
import { sectionHash } from '../../shell/routes'
import { Button, EmptyState, ListGrid, SectionHead, type ListColumn, type MenuItem } from '../../ui'
import { accountUsesDrill } from '../drills'
import { guideFor, lastTestLabel, providerRowName, type EmailAccountRow } from '../model'

/** The row menu button of an account, so focus can come back to it after a dialog. */
function menuButtonOf(account: EmailAccountRow): HTMLElement | null {
  const label = `Actions for ${account.fromAddress}`
  return (
    Array.from(document.querySelectorAll<HTMLElement>('button[aria-label]')).find(
      (button) => button.getAttribute('aria-label') === label
    ) ?? null
  )
}

/**
 * Sending accounts (FR-23.5) as a v2 list grid. A row opens the account on
 * click or Enter; "Used for" lists what the account sends; the last-test
 * badge opens the account at its test; Edit, Send a test and Remove are in
 * the row menu.
 */
export function AccountSection({
  accounts,
  timeZone,
  activeProjectId,
  onEdit,
  onTest,
  onRemove,
  onAdd
}: {
  accounts: readonly EmailAccountRow[]
  timeZone: string
  activeProjectId: string | null
  onEdit: (account: EmailAccountRow) => void
  /** Opens the account with its last test and the Send test field. */
  onTest: (account: EmailAccountRow) => void
  onRemove: (account: EmailAccountRow, button: HTMLElement | null) => void
  onAdd: () => void
}): JSX.Element {
  const columns: ListColumn<EmailAccountRow>[] = [
    {
      id: 'provider',
      label: 'Provider',
      width: 150,
      sort: (account) => providerRowName(account.provider),
      render: (account) => providerRowName(account.provider)
    },
    {
      id: 'from',
      label: 'From address',
      width: 'fill',
      minWidth: 200,
      cellClassName: 'mono',
      sort: (account) => account.fromAddress,
      render: (account) => account.fromAddress
    },
    {
      id: 'used',
      label: 'Used for',
      width: 240,
      render: (account) => <UsedFor account={account} activeProjectId={activeProjectId} />
    },
    {
      id: 'test',
      label: 'Last test',
      width: 170,
      sort: (account) => account.lastTestAt,
      render: (account) => (
        <button
          type="button"
          className={`${account.lastTestOk ? 'st st-ok' : 'st st-off'} acct-test-btn`}
          aria-label={`Last test of ${account.fromAddress}: ${lastTestLabel(account, timeZone)}. Show details and send a test`}
          onClick={() => onTest(account)}
        >
          {account.lastTestOk ? <Icon name="check" size="chev" /> : null}
          {lastTestLabel(account, timeZone)}
        </button>
      )
    }
  ]

  function menu(account: EmailAccountRow): readonly MenuItem[] {
    const name = guideFor(account.provider).shortName
    return [
      {
        id: 'edit',
        label: `Edit ${name} account`,
        icon: 'pencil',
        onSelect: () => onEdit(account)
      },
      {
        id: 'test',
        label: 'Send a test',
        icon: 'refresh',
        onSelect: () => onTest(account)
      },
      {
        id: 'remove',
        label: `Remove ${name} account`,
        icon: 'trash',
        tone: 'danger',
        onSelect: () => onRemove(account, menuButtonOf(account))
      }
    ]
  }

  return (
    <section className="al-accounts" aria-labelledby="acc-h">
      <SectionHead
        id="acc-h"
        title="Sending accounts"
        description="The default sends everything unless a project or schedule picks another."
      />
      <ListGrid
        label="Sending accounts"
        noun={['account', 'accounts']}
        rows={accounts}
        rowKey={(account) => account.id}
        rowLabel={(account) => account.fromAddress}
        columns={columns}
        rowMenu={menu}
        onActivate={onEdit}
        pageSize="all"
        maxBodyHeight={320}
        actions={
          <Button size="sm" icon="plus" onClick={onAdd}>
            Add account
          </Button>
        }
        empty={
          <EmptyState
            compact
            icon="inbox"
            title="No sending accounts yet"
            body="Add one to send through SMTP."
            action={
              <Button size="sm" icon="plus" onClick={onAdd}>
                Add account
              </Button>
            }
          />
        }
      />
      <p className="hint">
        Each project picks its sending account in{' '}
        <a href={sectionHash('project-settings')}>Project settings</a>. Schedules can override it in{' '}
        <a href={sectionHash('reports')}>Scheduled reports</a>.
      </p>
    </section>
  )
}

/** The Default tag and a count of the projects and schedules that use the account. */
function UsedFor({
  account,
  activeProjectId
}: {
  account: EmailAccountRow
  activeProjectId: string | null
}): JSX.Element {
  const uses = account.uses ?? []
  if (uses.length === 0) {
    return account.isDefault ? (
      <span className="tag">Default</span>
    ) : (
      <span className="faint">—</span>
    )
  }
  const drill = accountUsesDrill(account, uses, activeProjectId)
  return (
    <span className="acct-uses">
      {account.isDefault ? <span className="tag">Default</span> : null}
      <DrillButton
        drill={drill}
        className="drill-num"
        label={`${uses.length} ${uses.length === 1 ? 'use' : 'uses'} of ${account.fromAddress}: ${account.usedFor ?? ''}`}
      >
        <DrillFigure drill={drill} /> {uses.length === 1 ? 'use' : 'uses'}
      </DrillButton>
      <span className="faint acct-uses-names">{account.usedFor}</span>
    </span>
  )
}
