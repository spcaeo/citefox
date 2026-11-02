import { useMemo, useState, type JSX } from 'react'
import {
  templateKindInfo,
  type GenerationTemplate,
  type GenerationTemplateKind
} from '@shared/domain'
import {
  Button,
  Chip,
  Confirm,
  EmptyState,
  ListGrid,
  SectionHead,
  SegmentedControl,
  type ListColumn,
  type MenuItem
} from '../../ui'
import type { AppLibrary } from '../hooks/useAppLibrary'
import { listLabel, statusName, templateVersion, templateVersionLine, templateWhen } from '../list'
import { deleteBlockedReason, deletedCountLabel, usageCountForKind } from '../model'
import { LibraryEditor, UsageText } from './LibraryEditor'
import { HighlightedTemplate } from './TemplateText'

/**
 * App templates for the selected step (FR-10.2): every named template of that
 * kind, shared by every project, as the v2 list grid, with the selected one's
 * editor below. The default runs unless a project has its own version. The
 * shipped CiteFox default is read-only; duplicate it to edit a copy.
 */
export function AppTemplates({
  kind,
  library,
  projectOpen,
  onUsage
}: {
  kind: GenerationTemplateKind
  library: AppLibrary
  projectOpen: boolean
  /** Opens the drawer of saved artifacts behind a template's usage count. */
  onUsage: (template: GenerationTemplate) => void
}): JSX.Element {
  const label = templateKindInfo(kind).label
  const [confirmDelete, setConfirmDelete] = useState<GenerationTemplate | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const { mode, selected, duplicateSource, live, deleted, usages } = library
  const shown = mode === 'selected' ? selected : null

  const columns = useMemo(
    (): ListColumn<GenerationTemplate>[] => [
      {
        id: 'name',
        label: 'Name',
        width: 'fill',
        minWidth: 200,
        sort: (template) => template.name.toLowerCase(),
        render: (template) => <span className="tpl-grid-label">{template.name}</span>
      },
      {
        id: 'status',
        label: 'Status',
        width: 150,
        sort: (template) => (template.isDefault ? 0 : 1),
        render: (template) => (
          <span className="tpl-badges">
            {template.isDefault ? (
              <Chip size="sm" tone="ok">
                Default
              </Chip>
            ) : null}
            {statusName(template) === 'Edited' ? (
              <Chip size="sm" tone="info">
                Edited
              </Chip>
            ) : null}
          </span>
        )
      },
      {
        id: 'version',
        label: 'Version',
        width: 96,
        numeric: true,
        sort: (template) => template.version,
        render: (template) => (
          <span title={templateVersionLine(template)}>{templateVersion(template)}</span>
        )
      },
      {
        id: 'when',
        label: 'Changed',
        width: 130,
        sort: (template) => template.updatedAt ?? template.createdAt,
        render: (template) =>
          template.updatedAt === null ? <span className="faint">—</span> : templateWhen(template)
      },
      {
        id: 'usage',
        label: 'Usage',
        width: 220,
        sort: (template) => {
          const usage = usages[template.id]
          return usage ? usageCountForKind(kind, usage) : null
        },
        render: (template) => (
          <UsageText kind={kind} template={template} usage={usages[template.id]} onOpen={onUsage} />
        )
      }
    ],
    [kind, usages, onUsage]
  )

  if (library.loading) return <p role="status">Loading app templates…</p>
  if (library.loadError) {
    return (
      <p className="field-error" role="alert">
        {library.loadError}
      </p>
    )
  }

  function rowMenu(template: GenerationTemplate): MenuItem[] {
    const reason = template.isShipped ? null : deleteBlockedReason(template)
    return [
      { id: 'open', label: 'Open', icon: 'eye', onSelect: () => library.fill(template) },
      {
        id: 'duplicate',
        label: template.isShipped ? 'Duplicate to edit' : 'Duplicate',
        icon: 'copy',
        onSelect: () => library.openDuplicate(template)
      },
      {
        id: 'default',
        label: 'Set as default',
        icon: 'check',
        disabled: template.isDefault,
        onSelect: () => void library.makeDefault(template.id)
      },
      {
        id: 'delete',
        label: 'Delete',
        icon: 'trash',
        tone: 'danger',
        disabled: template.isShipped || reason !== null,
        onSelect: () => {
          library.fill(template)
          setConfirmDelete(template)
        }
      }
    ]
  }

  return (
    <section className="tpl-library" aria-labelledby="tpl-library-h">
      <SectionHead
        id="tpl-library-h"
        title={`App templates for ${label}`}
        description="Shared by every project. The default runs unless a project has its own version."
      />
      <ListGrid<GenerationTemplate>
        label="App templates"
        noun={['template', 'templates']}
        rows={live}
        rowKey={(template) => template.id}
        rowLabel={(template) => template.name}
        columns={columns}
        search={{ text: (template) => template.name, placeholder: 'Search app templates' }}
        toolbar={
          projectOpen ? (
            <SegmentedControl
              label="Usage"
              size="sm"
              options={[
                { value: 'all', label: 'All projects' },
                { value: 'project', label: 'This project' }
              ]}
              value={library.scope}
              onChange={library.setScope}
            />
          ) : null
        }
        actions={
          <Button size="sm" icon="plus" disabled={library.busy} onClick={library.openCreate}>
            New template
          </Button>
        }
        rowMenu={rowMenu}
        onActivate={library.fill}
        isRowCurrent={(template) => shown?.id === template.id}
        pageSize="all"
        maxBodyHeight={Math.max(library.live.length, 1) * 48}
        summary={(info) => listLabel(info.matching, info.total, info.matching !== info.total)}
        empty={
          <EmptyState
            title={`No live templates for ${label}.`}
            action={
              <Button size="sm" icon="plus" onClick={library.openCreate}>
                New template
              </Button>
            }
          />
        }
      />
      <div className="tpl-deleted-bar">
        <Button
          variant="ghost"
          size="sm"
          icon={library.showDeleted ? 'chevron-down' : 'chevron-right'}
          aria-expanded={library.showDeleted}
          aria-controls="tpl-deleted"
          onClick={() => library.setShowDeleted((current) => !current)}
        >
          {deletedCountLabel(deleted.length)}
        </Button>
      </div>
      {library.showDeleted ? (
        <div
          id="tpl-deleted"
          role="region"
          aria-label="Deleted templates"
          className="tpl-deleted-box"
        >
          <p role="status" className="faint">
            {deleted.length === 1 ? '1 deleted template' : `${deleted.length} deleted templates`}
          </p>
          {deleted.length === 0 ? (
            <p className="hint">Nothing is deleted for {label}.</p>
          ) : (
            <ul className="tpl-deleted">
              {deleted.map((template) => {
                const previewing = previewId === template.id
                const regionId = `tpl-deleted-preview-${template.id}`
                return (
                  <li key={template.id} className="tpl-deleted-item">
                    <span id={`${regionId}-name`}>{template.name}</span>
                    <span className="tpl-actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-expanded={previewing}
                        aria-controls={regionId}
                        onClick={() => setPreviewId(previewing ? null : template.id)}
                      >
                        {previewing ? 'Hide' : 'Preview'}
                        <span className="sr-only"> {template.name}</span>
                      </Button>
                      <Button size="sm" onClick={() => void library.restore(template.id)}>
                        Restore {template.name}
                      </Button>
                    </span>
                    {previewing ? (
                      <div id={regionId} className="tpl-deleted-preview">
                        <span className="faint tpl-when mono">{templateVersionLine(template)}</span>
                        <HighlightedTemplate
                          body={template.body}
                          kind={kind}
                          labelledBy={`${regionId}-name`}
                        />
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
      <LibraryEditor
        kind={kind}
        library={library}
        shown={shown}
        duplicateSource={duplicateSource}
        onUsage={onUsage}
      />
      {confirmDelete ? (
        <Confirm
          title="Delete this template?"
          body={`${confirmDelete.name} will move to the deleted list. You can restore it. Saved results keep this template id.`}
          confirmLabel="Delete"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            setConfirmDelete(null)
            void library.remove()
          }}
        />
      ) : null}
    </section>
  )
}
