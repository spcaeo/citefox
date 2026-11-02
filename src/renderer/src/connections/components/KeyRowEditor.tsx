import { useId, useState, type JSX } from 'react'
import type { ApiKeyMetadata } from '@shared/domain'
import { KeySecretRow } from '../../keys/KeyEditor'
import { FieldError } from '../../onboarding/parts'
import { parseSearchBudget } from '../../onboarding/validate'
import type { KeyActions } from '../hooks/useKeyActions'
import { knownProjectIds, planOf, type ProjectRef } from '../utils/model'
import { HeaderActions } from '../../components/HeaderActions'
import { Button } from '../../ui'
import '../connections.css'

/**
 * Edit one key: name, plan and monthly cap (SerpApi), the projects it serves,
 * replace the secret (⋯), or remove the key (⋯, red: asks first on the URL) (FR-11.1).
 */
export function KeyRowEditor({
  keyMeta,
  title,
  actions,
  projects,
  showPlanAndCap,
  showProjects,
  onClose
}: {
  keyMeta: ApiKeyMetadata
  title: string
  actions: KeyActions
  projects: readonly ProjectRef[]
  showPlanAndCap: boolean
  showProjects: boolean
  onClose: () => void
}): JSX.Element {
  const base = useId()
  const [name, setName] = useState(keyMeta.name)
  const [plan, setPlan] = useState(keyMeta.plan ?? '')
  const currentCap = keyMeta.monthlyCap !== undefined ? keyMeta.monthlyCap : keyMeta.cap
  const [cap, setCap] = useState(currentCap === null ? '' : String(currentCap))
  const [serves, setServes] = useState<readonly string[]>(
    knownProjectIds(keyMeta.projectIds, projects)
  )
  const [capError, setCapError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [replacing, setReplacing] = useState(false)
  const [secret, setSecret] = useState('')
  const [shown, setShown] = useState(false)
  const [secretError, setSecretError] = useState<string | null>(null)
  const secretId = `${keyMeta.id}-replace-secret`

  async function saveDetails(): Promise<void> {
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      setNameError('Enter a name.')
      return
    }
    const parsed = showPlanAndCap ? parseSearchBudget(cap) : { cap: currentCap }
    if ('error' in parsed) {
      setCapError(parsed.error)
      return
    }
    const ok = await actions.save(keyMeta, {
      name: trimmed,
      ...(showPlanAndCap ? { plan: plan.trim() ? plan.trim() : null, monthlyCap: parsed.cap } : {}),
      ...(showProjects ? { projectIds: knownProjectIds(serves, projects) } : {})
    })
    if (ok) onClose()
  }

  return (
    <div className="conn-editor" role="group" aria-label={`Edit ${keyMeta.name}`}>
      <div className="conn-editor-grid">
        <div className="field">
          <label className="field-label" htmlFor={`${base}-name`}>
            Key name
          </label>
          <input
            id={`${base}-name`}
            className="ob-input"
            value={name}
            aria-invalid={nameError ? true : undefined}
            onChange={(event) => {
              setName(event.target.value)
              setNameError(null)
            }}
          />
          {nameError ? <FieldError id={`${base}-name-error`}>{nameError}</FieldError> : null}
        </div>
        {showPlanAndCap ? (
          <>
            <div className="field">
              <label className="field-label" htmlFor={`${base}-plan`}>
                Plan
              </label>
              <input
                id={`${base}-plan`}
                className="ob-input"
                placeholder={planOf({ ...keyMeta, plan: null }) ?? 'e.g. Developer'}
                value={plan}
                onChange={(event) => setPlan(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${base}-cap`}>
                Monthly cap
              </label>
              <input
                id={`${base}-cap`}
                className="ob-input mono"
                inputMode="numeric"
                value={cap}
                aria-invalid={capError ? true : undefined}
                aria-describedby={`${base}-cap-hint`}
                onChange={(event) => {
                  setCap(event.target.value)
                  setCapError(null)
                }}
              />
              <p className="hint" id={`${base}-cap-hint`}>
                Empty means no cap.
              </p>
              {capError ? <FieldError id={`${base}-cap-error`}>{capError}</FieldError> : null}
            </div>
          </>
        ) : null}
      </div>
      {showProjects ? (
        <fieldset className="conn-projects">
          <legend>Projects it serves</legend>
          <p className="hint">None checked means every project can use this key.</p>
          {projects.length === 0 ? <p className="hint">No projects yet.</p> : null}
          {projects.map((project) => (
            <label key={project.id} className="pop-check">
              <input
                type="checkbox"
                checked={serves.includes(project.id)}
                onChange={() =>
                  setServes((current) =>
                    current.includes(project.id)
                      ? current.filter((id) => id !== project.id)
                      : [...current, project.id]
                  )
                }
              />
              <span>{project.name}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <div className="actions conn-editor-actions">
        <Button size="sm" onClick={onClose}>
          Close
        </Button>
        <HeaderActions
          more={[
            {
              id: `key-replace-${keyMeta.id}`,
              label: 'Replace key',
              icon: 'refresh',
              disabled: actions.busy,
              onSelect: () => setReplacing(true)
            },
            {
              id: `key-remove-${keyMeta.id}`,
              label: 'Remove key…',
              icon: 'trash',
              disabled: actions.busy,
              onSelect: () => void actions.remove(keyMeta),
              danger: {
                title: `Remove ${keyMeta.name}?`,
                body: "The key is deleted from the keychain. Searches it already made this month still count toward each project's cap.",
                confirmLabel: `Remove ${keyMeta.name}`
              }
            }
          ]}
          moreLabel={`${keyMeta.name} actions`}
        />
        <Button
          variant="primary"
          size="sm"
          disabled={actions.busy}
          onClick={() => void saveDetails()}
        >
          Save changes
        </Button>
      </div>
      {replacing ? (
        <form
          className="field"
          onSubmit={(event) => {
            event.preventDefault()
            const sent = secret
            if (sent.trim().length === 0) {
              setSecretError(`Paste a new ${title} key.`)
              return
            }
            setSecret('')
            setShown(false)
            void actions.replace(keyMeta, sent).then((ok) => {
              if (ok) setReplacing(false)
            })
          }}
        >
          <label className="field-label" htmlFor={secretId}>
            New {title} key
          </label>
          <KeySecretRow
            id={secretId}
            value={secret}
            shown={shown}
            error={secretError}
            errorId={`${secretId}-error`}
            onToggle={() => setShown((value) => !value)}
            onChange={(value) => {
              setSecret(value)
              setSecretError(null)
            }}
          />
          <div className="actions conn-editor-actions">
            <Button
              size="sm"
              onClick={() => {
                setReplacing(false)
                setSecret('')
                setSecretError(null)
              }}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={actions.busy}>
              Save new key
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
