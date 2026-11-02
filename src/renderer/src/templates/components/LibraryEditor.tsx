import { useId, type JSX } from 'react'
import type { GenerationTemplate, GenerationTemplateKind } from '@shared/domain'
import type { TemplateUsage } from '@shared/ipc'
import { Icon } from '../../components/Icon'
import { HeaderActions, type HeaderMoreItem } from '../../components/HeaderActions'
import { Button, Chip, IconButton, ToolButton } from '../../ui'
import type { AppLibrary } from '../hooks/useAppLibrary'
import { deleteBlockedReason, usageCountForKind, usageLine } from '../model'
import { templateNameError, templateNotesError } from '../name'
import { HighlightedTemplate } from './TemplateText'

/**
 * The selected app template's editor (FR-10.2): name, notes and text, with
 * Duplicate, a ⋯ menu (Set as default, Delete) and the green Save on the right.
 * The shipped default is read-only.
 */
export function LibraryEditor({
  kind,
  library,
  shown,
  duplicateSource,
  onUsage
}: {
  kind: GenerationTemplateKind
  library: AppLibrary
  shown: GenerationTemplate | null
  duplicateSource: GenerationTemplate | null
  onUsage: (template: GenerationTemplate) => void
}): JSX.Element {
  const nameId = useId()
  const notesId = useId()
  const nameErrorId = useId()
  const notesErrorId = useId()
  const deleteReasonId = useId()
  const textLabelId = useId()
  const { mode, shipped, editing } = library
  const deleteReason = shown && !shown.isShipped ? deleteBlockedReason(shown) : null
  const bodyEditable = mode === 'create' || (mode === 'selected' && !shipped && editing)
  // Set as default and Delete sit under ⋯; Delete is red and asks first on the URL.
  const more: HeaderMoreItem[] = []
  if (shown && !shown.isDefault) {
    more.push({
      id: 'tpl-default',
      label: 'Set as default',
      icon: 'check',
      disabled: library.busy,
      onSelect: () => void library.makeDefault(shown.id)
    })
  }
  // A blocked Delete shows greyed beside Set as default; alone it would leave an empty ⋯,
  // so the reason line under the head says why instead.
  if (shown && !shown.isShipped && (deleteReason === null || more.length > 0)) {
    more.push({
      id: 'tpl-delete',
      label: 'Delete',
      icon: 'trash',
      disabled: deleteReason !== null || library.busy,
      onSelect: () => void library.remove(),
      danger: {
        title: 'Delete this template?',
        body: `${shown.name} will move to the deleted list. You can restore it. Saved results keep this template id.`,
        confirmLabel: 'Delete'
      }
    })
  }

  return (
    <section className="ui-panel tpl-editor-card" aria-label="App template editor">
      <div className="tpl-editor-head">
        <div className="tpl-editor-title">
          <div className="tpl-title-row">
            <h3>
              {mode === 'create'
                ? 'New template'
                : mode === 'duplicate'
                  ? `Duplicate ${duplicateSource?.name ?? 'template'}`
                  : (shown?.name ?? 'Template')}
            </h3>
            {shown?.isDefault ? (
              <Chip size="sm" tone="ok">
                Default
              </Chip>
            ) : null}
            {shown?.isShipped ? <Chip size="sm">Read-only</Chip> : null}
          </div>
          {shown ? (
            <UsageText
              kind={kind}
              template={shown}
              usage={library.usages[shown.id]}
              onOpen={onUsage}
            />
          ) : null}
          {mode === 'duplicate' && duplicateSource ? (
            <p className="hint">
              This copies {duplicateSource.name}. The new template is not shipped and is not the
              default.
            </p>
          ) : null}
        </div>
        <div className="tpl-actions">
          {shown ? (
            <ToolButton
              kind="copy"
              label={shown.isShipped ? 'Duplicate to edit' : 'Duplicate'}
              onClick={() => library.openDuplicate(shown)}
            />
          ) : null}
          {more.length > 0 ? <HeaderActions more={more} moreLabel="Template actions" /> : null}
          {mode !== 'selected' || (shown && !shown.isShipped) ? (
            <Button variant="primary" disabled={library.busy} onClick={() => void library.save()}>
              {mode === 'selected' ? 'Save' : mode === 'duplicate' ? 'Duplicate' : 'Create'}
            </Button>
          ) : null}
        </div>
      </div>
      {deleteReason ? (
        <p id={deleteReasonId} className="hint">
          {deleteReason}
        </p>
      ) : null}
      {library.savedNote ? (
        <p className="tpl-saved" role="status">
          <Icon name="check" />
          <span>{library.savedNote}</span>
        </p>
      ) : null}
      {library.formError ? (
        <p className="field-error" role="alert">
          <Icon name="warning" size="chev" />
          {library.formError}
        </p>
      ) : null}

      {shipped && shown ? (
        <p>
          <span className="field-label">Name</span> {shown.name}
        </p>
      ) : (
        <div className="tpl-editor-title">
          <label className="field" htmlFor={nameId}>
            <span className="field-label">Name</span>
            <input
              id={nameId}
              className="ob-input"
              value={library.nameDraft}
              aria-invalid={library.nameError ? true : undefined}
              aria-describedby={library.nameError ? nameErrorId : undefined}
              onChange={(event) => {
                library.setNameDraft(event.target.value)
                library.setNameError(null)
              }}
              onBlur={() => library.setNameError(templateNameError(library.nameDraft))}
            />
          </label>
          {library.nameError ? (
            <p id={nameErrorId} className="field-error" role="alert">
              {library.nameError}
            </p>
          ) : null}
          <label className="field" htmlFor={notesId}>
            <span className="field-label">Notes</span>
            <textarea
              id={notesId}
              className="ob-input"
              rows={2}
              value={library.notesDraft}
              aria-invalid={library.notesError ? true : undefined}
              aria-describedby={library.notesError ? notesErrorId : undefined}
              onChange={(event) => {
                library.setNotesDraft(event.target.value)
                library.setNotesError(null)
              }}
              onBlur={() => library.setNotesError(templateNotesError(library.notesDraft))}
            />
          </label>
          {library.notesError ? (
            <p id={notesErrorId} className="field-error" role="alert">
              {library.notesError}
            </p>
          ) : null}
        </div>
      )}

      <div className="tpl-text">
        <div className="tpl-text-bar">
          <span className="field-label" id={textLabelId}>
            Template text
          </span>
          {mode === 'selected' && shown && !shown.isShipped ? (
            <IconButton
              size="sm"
              tip
              icon={editing ? 'check' : 'pencil'}
              label={editing ? 'Done editing' : 'Edit text'}
              aria-pressed={editing}
              onClick={() => library.setEditing((current) => !current)}
            />
          ) : null}
        </div>
        {bodyEditable ? (
          <textarea
            className="ob-input mono tpl-textarea"
            rows={10}
            spellCheck={false}
            aria-labelledby={textLabelId}
            value={library.bodyDraft}
            onChange={(event) => {
              library.setBodyDraft(event.target.value)
              library.setFormError(null)
              library.setSavedNote(null)
            }}
          />
        ) : (
          <HighlightedTemplate body={library.bodyDraft} kind={kind} labelledBy={textLabelId} />
        )}
      </div>
    </section>
  )
}

/** The usage line. A non-zero count opens the drawer of what used the template. */
export function UsageText({
  kind,
  template,
  usage,
  onOpen
}: {
  kind: GenerationTemplateKind
  template: GenerationTemplate
  usage: TemplateUsage | undefined
  onOpen: (template: GenerationTemplate) => void
}): JSX.Element {
  if (!usage) return <span className="faint tpl-when">Usage loading…</span>
  const line = usageLine(kind, usage)
  if (usageCountForKind(kind, usage) === 0) return <span className="faint tpl-when">{line}</span>
  return (
    <button
      type="button"
      className="m3-link tpl-when"
      aria-label={`Where it was used: ${line}`}
      title={`Where ${template.name} was used`}
      onClick={() => onOpen(template)}
    >
      {line}
    </button>
  )
}
