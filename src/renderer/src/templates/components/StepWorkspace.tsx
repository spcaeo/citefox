import { useEffect, useId, useRef, useState, type JSX } from 'react'
import { templateKindInfo } from '@shared/domain'
import type { TemplateStep } from '@shared/ipc'
import type { AssistClient } from '../../assist/client'
import { Icon } from '../../components/Icon'
import { Button, Chip, Confirm, IconButton } from '../../ui'
import type { TemplatesClient } from '../client'
import { useStepCalls } from '../hooks/useStepDrills'
import { useStepDraft } from '../hooks/useStepDraft'
import { unknownVariables, variableToken } from '../utils/highlight'
import {
  APP_SCOPE_NOTE,
  PROJECT_SCOPE_NOTE,
  STEP_STATUS_LABEL,
  STEP_STATUS_TONE,
  lastRunLine,
  versionLine
} from '../utils/stepCopy'
import { CompareView } from './CompareView'
import { useImproveMenu } from './ImproveSection'
import { SettingsForm } from './SettingsForm'
import { OutputFields, VariablesTable, VersionHistory } from './StepReference'
import { HighlightedTemplate, TemplateTextarea } from './TemplateText'
import { TryItCard } from './TryItCard'

/**
 * One step's editor (FR-26.2 to FR-26.8): status and version, Compare with
 * default, Reset to default, Save, the AI menu (Improve with Claude), settings, the
 * highlighted template, then Variables, Output fields and Try it. Mounted per
 * step, so switching steps starts a fresh draft.
 */
export function StepWorkspace({
  client,
  assistClient,
  projectId,
  step,
  onStep,
  onAppChanged,
  onDirty,
  onDuplicate,
  onVersions,
  onCalls
}: {
  client: TemplatesClient
  assistClient?: AssistClient
  projectId: string | null
  step: TemplateStep
  onStep: (step: TemplateStep) => void
  onAppChanged: () => Promise<readonly TemplateStep[]>
  onDirty: (dirty: boolean) => void
  /** With no project, the shipped default is read-only: duplicate it under App templates. */
  onDuplicate: () => void
  /** Opens this step's version history drawer. */
  onVersions: () => void
  /** Opens the drawer of Claude calls behind "Last run". */
  onCalls: () => void
}): JSX.Element {
  const draft = useStepDraft({ client, projectId, step, onStep, onAppChanged })
  const calls = useStepCalls(client, projectId, step.kind, draft.versions.length)
  const [editing, setEditing] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement | null>(null)
  const textLabelId = useId()
  const warningsId = useId()
  const info = templateKindInfo(step.kind)
  const projectOpen = projectId !== null
  const unknown = unknownVariables(draft.body, step.kind)
  const lastRun = lastRunLine(step, projectOpen)
  const shownVersion = projectOpen
    ? step.effective
    : { version: step.appDefault.version, hash: step.appDefault.templateHash }
  const { dirty } = draft
  const improve = useImproveMenu({
    kind: step.kind,
    projectId,
    body: draft.body,
    disabled: draft.readOnly,
    assistClient,
    onBody: (next) => {
      draft.setBody(next)
      setEditing(true)
    }
  })

  useEffect(() => {
    onDirty(dirty)
  }, [dirty, onDirty])

  function insertVariable(name: string): void {
    if (draft.readOnly) return
    const token = variableToken(name)
    const area = areaRef.current
    if (!editing || !area) {
      setEditing(true)
      draft.setBody(draft.body.length === 0 ? token : `${draft.body}\n${token}`)
      return
    }
    const start = area.selectionStart
    const end = area.selectionEnd
    draft.setBody(`${draft.body.slice(0, start)}${token}${draft.body.slice(end)}`)
    const caret = start + token.length
    requestAnimationFrame(() => {
      area.focus()
      area.setSelectionRange(caret, caret)
    })
  }

  return (
    <>
      <section className="card tpl-editor-card" aria-label="Template editor">
        <div className="tpl-editor-head">
          <div className="tpl-editor-title">
            <div className="tpl-title-row">
              <h2>{info.label}</h2>
              <span className="mono faint">{info.file}</span>
              <Chip size="sm" tone={STEP_STATUS_TONE[step.status]}>
                {STEP_STATUS_LABEL[step.status]}
              </Chip>
              {dirty ? (
                <Chip size="sm" tone="warn">
                  Unsaved changes
                </Chip>
              ) : null}
            </div>
            <p className="mono faint tpl-when">
              <button
                type="button"
                className="m3-link mono"
                aria-label={`Version history, ${versionLine(shownVersion)}`}
                onClick={onVersions}
              >
                {versionLine(shownVersion)}
              </button>
              {lastRun === null ? null : step.lastRunAt === null ? (
                <span> · {lastRun}</span>
              ) : (
                <>
                  {' · '}
                  <button
                    type="button"
                    className="m3-link"
                    aria-label={`AI calls for this step, ${lastRun}`}
                    onClick={onCalls}
                  >
                    {lastRun}
                  </button>
                </>
              )}
            </p>
            <p className="hint">{info.description}</p>
          </div>
          <div className="tpl-actions">
            <IconButton
              icon="layers"
              label="Compare with default"
              data-tip="Compare with default"
              aria-pressed={comparing}
              onClick={() => setComparing((current) => !current)}
            />
            <IconButton
              icon="refresh"
              label="Reset to default"
              data-tip="Reset to default"
              disabled={!draft.canReset || draft.busy}
              onClick={() => setConfirmReset(true)}
            />
            {step.retired !== null ? null : draft.readOnly ? (
              <Button variant="primary" icon="copy" onClick={onDuplicate}>
                Duplicate to edit
              </Button>
            ) : (
              <Button variant="primary" disabled={draft.busy} onClick={() => void draft.save()}>
                Save
              </Button>
            )}
            {improve.menu}
          </div>
        </div>

        {step.retired !== null ? (
          <p className="tpl-scope" role="note">
            {step.retired.notice}{' '}
            <span className="faint">
              New steps:{' '}
              {step.retired.replacedBy.map((kind) => templateKindInfo(kind).label).join(', ')}.
            </span>
          </p>
        ) : null}

        <p className="tpl-scope">
          {projectOpen
            ? PROJECT_SCOPE_NOTE
            : draft.readOnly
              ? `${APP_SCOPE_NOTE} The default is read-only: duplicate it, then set the copy as the default.`
              : APP_SCOPE_NOTE}
        </p>

        {improve.card}

        {draft.note ? (
          <p className="tpl-saved" role="status">
            <Icon name="check" />
            <span>{draft.note}</span>
          </p>
        ) : null}
        {draft.error ? (
          <p className="field-error" role="alert">
            <Icon name="warning" size="chev" />
            {draft.error}
          </p>
        ) : null}

        {comparing ? (
          <CompareView
            kind={step.kind}
            body={draft.body}
            settings={draft.settings}
            shippedBody={step.shipped.body}
            shippedSettings={step.shipped.settings}
          />
        ) : null}

        <SettingsForm
          kind={step.kind}
          draft={draft.settingsDraft}
          disabled={draft.readOnly}
          onChange={draft.setSettingsDraft}
        />

        <div className="tpl-text">
          <div className="tpl-text-bar">
            <span className="field-label" id={textLabelId}>
              Template
            </span>
            <span className="hint">
              Variables in double braces, such as {'{{ title }}'}. Comments in {'{# … #}'}.
            </span>
            {draft.readOnly ? null : (
              <IconButton
                size="sm"
                tip
                icon={editing ? 'check' : 'pencil'}
                label={editing ? 'Done editing' : 'Edit'}
                aria-pressed={editing}
                onClick={() => setEditing((current) => !current)}
              />
            )}
          </div>
          {editing && !draft.readOnly ? (
            <TemplateTextarea
              body={draft.body}
              kind={step.kind}
              labelledBy={textLabelId}
              describedBy={unknown.length > 0 ? warningsId : undefined}
              textareaRef={areaRef}
              onChange={draft.setBody}
            />
          ) : (
            <HighlightedTemplate body={draft.body} kind={step.kind} labelledBy={textLabelId} />
          )}
          {unknown.length > 0 ? (
            <ul id={warningsId} className="tpl-warnings" aria-label="Unknown variables">
              {unknown.map((name) => (
                <li key={name}>
                  {variableToken(name)} is not a variable for this step. CiteFox will leave it
                  blank.
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <VersionHistory step={step} versions={draft.versions} calls={calls} />
      </section>

      <div className="tpl-lower">
        <VariablesTable
          variables={step.variables}
          disabled={draft.readOnly}
          onInsert={insertVariable}
        />
        <div className="tpl-side">
          <OutputFields kind={step.kind} schema={step.schema} />
          <TryItCard
            client={client}
            projectId={projectId}
            kind={step.kind}
            body={draft.body}
            settings={draft.settings}
            settingsError={draft.settingsError}
            playgroundId={step.appDefault.id}
          />
        </div>
      </div>

      {confirmReset ? (
        <Confirm
          title={`Reset ${info.label} to the default?`}
          body={
            projectOpen
              ? "This project goes back to the app default for this step. Its saved versions are kept, and past question sets and checks don't change."
              : 'The shipped wording and settings are saved as the next version of this template. Earlier versions are kept.'
          }
          confirmLabel="Reset"
          tone="default"
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            setConfirmReset(false)
            setEditing(false)
            void draft.reset()
          }}
        />
      ) : null}
    </>
  )
}
