import { useEffect, useState, type JSX } from 'react'
import type { ApiKeyMetadata, ProjectClaudeRow, ProjectClaudeSettings } from '@shared/domain'
import type { AdminClient } from '../../admin/client'
import { DrillLink } from '../../drill'
import { openDrawer } from '../../shell/drawers'
import { EmptyState, ListGrid, PickerSelect, SectionHead, type ListColumn } from '../../ui'
import { projectSettingsLink } from '../utils/projectLinks'
import {
  connectionOptions,
  connectionValue,
  fallbackOptions,
  fallbackValue,
  plainError,
  withConnection,
  withFallback
} from '../utils/model'

/**
 * FR-11.7. Each project's Claude connection and what happens when it hits a limit
 * or fails. Saved at once through `projectSettings:update`.
 */
export function ProjectClaudeTable({
  admin,
  anthropic,
  refresh,
  activeProjectId = null,
  onKeysChanged
}: {
  admin: AdminClient
  anthropic: readonly ApiKeyMetadata[]
  refresh: unknown
  activeProjectId?: string | null
  /** After "+ Add an Anthropic API key…" adds one: the key lists read again. */
  onKeysChanged?: () => Promise<void>
}): JSX.Element {
  const [rows, setRows] = useState<readonly ProjectClaudeRow[] | null>(null)
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    admin.projectClaude().then(
      (next) => {
        if (!cancelled) setRows(next)
      },
      (cause: unknown) => {
        if (!cancelled) setStatus({ text: plainError(cause), error: true })
      }
    )
    return () => {
      cancelled = true
    }
  }, [admin, refresh])

  async function save(row: ProjectClaudeRow, claude: ProjectClaudeSettings): Promise<void> {
    setBusy(true)
    try {
      const saved = await admin.updateProjectSettings({ projectId: row.projectId, claude })
      setRows((current) =>
        (current ?? []).map((item) =>
          item.projectId === row.projectId ? { ...item, claude: saved.claude } : item
        )
      )
      setStatus({ text: `Saved for ${row.name}.`, error: false })
    } catch (cause) {
      setStatus({ text: plainError(cause), error: true })
    } finally {
      setBusy(false)
    }
  }

  /** The new key comes back as this project's connection. */
  function addKeyFor(row: ProjectClaudeRow): void {
    openDrawer(
      'add-key',
      { 'key.provider': 'anthropic' },
      {
        onResult: (id) => {
          if (typeof id !== 'string') return
          void (onKeysChanged?.() ?? Promise.resolve()).finally(
            () => void save(row, withConnection(row.claude, `key:${id}`))
          )
        }
      }
    )
  }

  const columns: ListColumn<ProjectClaudeRow>[] = [
    {
      id: 'project',
      label: 'Project',
      width: 'fill',
      minWidth: 180,
      sort: (row) => row.name.toLowerCase(),
      render: (row) => (
        <ProjectName id={row.projectId} name={row.name} activeProjectId={activeProjectId} />
      )
    },
    {
      id: 'client',
      label: 'Client',
      width: 150,
      sort: (row) => row.clientName,
      render: (row) => <span className="faint">{row.clientName ?? '—'}</span>
    },
    {
      id: 'use',
      label: 'Use',
      width: 230,
      render: (row) => (
        <>
          <label className="sr-only" htmlFor={`pc-use-${row.projectId}`}>
            {row.name} connection
          </label>
          <PickerSelect
            id={`pc-use-${row.projectId}`}
            className="select conn-cell-select"
            value={connectionValue(row.claude)}
            disabled={busy}
            onChange={(value) => void save(row, withConnection(row.claude, value))}
            options={connectionOptions(anthropic)}
            createLabel="+ Add an Anthropic API key…"
            onCreate={() => addKeyFor(row)}
          />
        </>
      )
    },
    {
      id: 'fallback',
      label: 'If it hits a limit or fails',
      width: 260,
      render: (row) => (
        <>
          <label className="sr-only" htmlFor={`pc-fb-${row.projectId}`}>
            {row.name} fallback
          </label>
          <select
            id={`pc-fb-${row.projectId}`}
            className="select conn-cell-select"
            value={fallbackValue(row.claude)}
            disabled={busy}
            onChange={(event) => void save(row, withFallback(row.claude, event.target.value))}
          >
            {fallbackOptions(anthropic, row.claude).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </>
      )
    }
  ]

  return (
    <div className="conn-block conn-projects-claude">
      <SectionHead title="Which connection each project uses" level={3} />
      {rows === null ? (
        <p className="hint">Loading projects…</p>
      ) : (
        <ListGrid
          label="Claude connection and fallback for each project"
          noun={['project', 'projects']}
          rows={rows}
          rowKey={(row) => row.projectId}
          rowLabel={(row) => row.name}
          columns={columns}
          {...(rows.length > 8
            ? { search: { text: (row: ProjectClaudeRow) => `${row.name} ${row.clientName ?? ''}` } }
            : {})}
          empty={
            <EmptyState
              compact
              title="No projects yet"
              body="Each new project starts on the app default."
            />
          }
        />
      )}
      {status ? (
        <p
          className={status.error ? 'field-error' : 'hint'}
          role={status.error ? 'alert' : 'status'}
        >
          {status.text}
        </p>
      ) : null}
      <p className="hint">
        &quot;Wait for the plan limit to reset&quot; pauses analysis and finishes it later; searches
        already made are kept, so nothing is paid for twice.
      </p>
    </div>
  )
}

/** A project name that opens its Project settings › Claude. */
function ProjectName({
  id,
  name,
  activeProjectId
}: {
  id: string
  name: string
  activeProjectId: string | null
}): JSX.Element {
  const link = projectSettingsLink({ id, name }, activeProjectId, 'Claude')
  return (
    <DrillLink target={link.target} label={link.label}>
      {name}
    </DrillLink>
  )
}
