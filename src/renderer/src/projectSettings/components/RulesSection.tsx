import { useEffect, useId, useMemo, useState, type JSX } from 'react'
import { PROJECT_RULE_MAX, type ProjectRule } from '@shared/ipc'
import { Button, IconButton } from '../../ui'
import { useSave } from '../hooks/useSave'
import { createProjectRulesSource, type ProjectRulesSource } from '../rulesClient'
import { errorText } from '../utils/model'
import { SaveStatus, Section } from './bits'

/**
 * Project settings › Project rules: the owner's standing instructions for this
 * project ("don't call us a cloud service"). Saved from a setup card's Redo box or
 * typed here. Every AI answer CiteFox writes for the project follows the rules
 * that are on: setup, fix briefs, page edits, Why Google picks and Help me fill this.
 */
export function RulesSection({
  projectId,
  projectName,
  source
}: {
  projectId: string
  projectName: string
  source?: ProjectRulesSource
}): JSX.Element {
  const api = useMemo(() => source ?? createProjectRulesSource(), [source])
  const base = useId()
  const [rules, setRules] = useState<readonly ProjectRule[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const save = useSave()

  useEffect(() => {
    let live = true
    void Promise.resolve()
      .then(() => api['projectRules:list']({ projectId }))
      .then(
        (list) => {
          if (live) setRules(list.rules)
        },
        (cause: unknown) => {
          if (live) setLoadError(errorText(cause))
        }
      )
    return () => {
      live = false
    }
  }, [api, projectId])

  async function add(): Promise<void> {
    const text = draft.trim()
    if (text.length === 0) {
      save.fail('Write the rule first.')
      return
    }
    const ok = await save.run(async () => {
      const list = await api['projectRules:save']({ projectId, id: null, text, enabled: true })
      setRules(list.rules)
    }, 'Rule added. CiteFox AI follows it from the next answer.')
    if (ok) setDraft('')
  }

  async function update(
    rule: ProjectRule,
    change: { text?: string; enabled?: boolean }
  ): Promise<void> {
    const ok = await save.run(
      async () => {
        const list = await api['projectRules:save']({
          projectId,
          id: rule.id,
          text: change.text ?? rule.text,
          enabled: change.enabled ?? rule.enabled
        })
        setRules(list.rules)
      },
      change.enabled === undefined ? 'Rule saved.' : change.enabled ? 'Rule on.' : 'Rule off.'
    )
    if (ok && change.text !== undefined) setEditing(null)
  }

  async function remove(rule: ProjectRule): Promise<void> {
    await save.run(async () => {
      const list = await api['projectRules:delete']({ projectId, id: rule.id })
      setRules(list.rules)
    }, 'Rule deleted.')
  }

  return (
    <Section
      id="ps-rules-sec"
      title="Project rules"
      intro={`CiteFox AI follows these in everything it writes for ${projectName}: setup, fix briefs, page edits, Why Google picks and Help me fill this. Turn one off to keep it without using it.`}
    >
      {loadError ? (
        <p className="field-error" role="alert">
          {loadError}
        </p>
      ) : rules === null ? (
        <p role="status">Loading rules…</p>
      ) : rules.length === 0 ? (
        <p className="hint">
          No rules yet. Add one below, or tick &ldquo;Save as a project rule&rdquo; in a Redo box.
        </p>
      ) : (
        <ul className="ps-rules" aria-label="Project rules">
          {rules.map((rule) => (
            <li key={rule.id} className="ps-rule" data-off={rule.enabled ? undefined : true}>
              {editing?.id === rule.id ? (
                <>
                  <input
                    className="ui-input ps-rule-text"
                    aria-label="Edit the rule"
                    value={editing.text}
                    maxLength={PROJECT_RULE_MAX}
                    onChange={(event) => setEditing({ id: rule.id, text: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void update(rule, { text: editing.text })
                      if (event.key === 'Escape') setEditing(null)
                    }}
                  />
                  <Button size="sm" onClick={() => void update(rule, { text: editing.text })}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <label className="ps-rule-on">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      aria-label={`Use the rule: ${rule.text}`}
                      onChange={(event) => void update(rule, { enabled: event.target.checked })}
                    />
                  </label>
                  <span className="ps-rule-text">{rule.text}</span>
                  <IconButton
                    icon="pencil"
                    size="sm"
                    label={`Edit the rule: ${rule.text}`}
                    onClick={() => setEditing({ id: rule.id, text: rule.text })}
                  />
                  <IconButton
                    icon="trash"
                    size="sm"
                    label={`Delete the rule: ${rule.text}`}
                    onClick={() => void remove(rule)}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="ps-rule-add">
        <label htmlFor={`${base}-add`} className="sr-only">
          New rule
        </label>
        <input
          id={`${base}-add`}
          className="ui-input"
          value={draft}
          maxLength={PROJECT_RULE_MAX}
          placeholder={'e.g. "Don\'t call us a cloud service"'}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void add()
          }}
        />
        <Button size="sm" variant="secondary" icon="plus" onClick={() => void add()}>
          Add rule
        </Button>
      </div>
      <SaveStatus state={save.state} />
    </Section>
  )
}
