import { useEffect, useId, useState, type JSX } from 'react'
import { Button, PickerSelect } from '../../ui'
import { openDrawer } from '../../shell/drawers'
import { sectionHash } from '../../shell/routes'
import { useSave } from '../hooks/useSave'
import type { SectionProps } from '../types'
import {
  claudeFromForm,
  connectionOptions,
  connectionValue,
  fallbackOptions,
  fallbackValue,
  keysOf,
  usesClaudeCode
} from '../utils/model'
import { SaveStatus, Section } from './bits'

/** FR-11.7, LLM-5, LLM-10. The project's Claude connection, fallback, and model. */
export function ClaudeSection({ view, admin, client, keys, refresh }: SectionProps): JSX.Element {
  const base = useId()
  const anthropic = keysOf(keys, 'anthropic')
  const [connection, setConnection] = useState(connectionValue(view.claude))
  const [fallback, setFallback] = useState(fallbackValue(view.claude))
  const [model, setModel] = useState(view.claude.model ?? '')
  const [appProvider, setAppProvider] = useState<'claude-code' | 'anthropic-api' | 'codex' | null>(
    null
  )
  const [appModel, setAppModel] = useState<string | null>(null)
  const save = useSave()
  const connections = connectionOptions(anthropic)
  const fallbacks = fallbackOptions(anthropic, connection)
  const shownFallback = fallbacks.some((item) => item.value === fallback) ? fallback : 'wait'
  const clientWarning = view.project.clientName !== null && usesClaudeCode(connection, appProvider)

  useEffect(() => {
    let cancelled = false
    client.getSettings().then(
      (snapshot) => {
        if (cancelled) return
        setAppProvider(snapshot.settings.claudeProvider)
        setAppModel(snapshot.settings.claudeModel)
      },
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [client])

  function pickConnection(value: string): void {
    setConnection(value)
    // Switching to the key the project now uses is no longer a fallback.
    if (fallback === `switch_key:${value.slice('api_key:'.length)}`) setFallback('wait')
  }

  /** "+ Add an Anthropic API key…": the new key comes back as the connection. */
  function addKey(): void {
    openDrawer(
      'add-key',
      { 'key.provider': 'anthropic' },
      {
        onResult: (id) => {
          if (typeof id !== 'string') return
          void refresh().finally(() => pickConnection(`api_key:${id}`))
        }
      }
    )
  }

  async function onSave(): Promise<void> {
    await save.run(async () => {
      await admin.updateProjectSettings({
        projectId: view.project.id,
        claude: claudeFromForm(connection, shownFallback, model)
      })
      await refresh()
    }, 'CiteFox AI settings saved.')
  }

  return (
    <Section id={'ps-claude'} title="CiteFox AI">
      <div className="ps-grid3">
        <div className="field">
          <label className="field-label" htmlFor={`${base}-use`}>
            Connection
          </label>
          <PickerSelect
            id={`${base}-use`}
            className="select"
            aria-describedby={`${base}-use-h`}
            value={connection}
            onChange={pickConnection}
            options={connections}
            createLabel="+ Add an Anthropic API key…"
            onCreate={addKey}
          />
          <span className="hint" id={`${base}-use-h`}>
            {connection === 'app_default'
              ? `Follows Settings (${appProvider === 'anthropic-api' ? 'Anthropic API' : 'Claude Code'}).`
              : connection === 'claude_code'
                ? 'Whoever is logged in on this computer.'
                : 'Billed to that Anthropic account.'}
          </span>
        </div>
        <label className="field" htmlFor={`${base}-fb`}>
          <span className="field-label">If it hits a limit or fails</span>
          <select
            id={`${base}-fb`}
            className="select"
            value={shownFallback}
            onChange={(event) => setFallback(event.target.value)}
          >
            {fallbacks.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <label className="field-label" htmlFor={`${base}-model`}>
            Model for this project
          </label>
          <input
            id={`${base}-model`}
            className="ob-input mono"
            aria-describedby={`${base}-model-h`}
            placeholder={appModel ? `App default (${appModel})` : 'App default'}
            value={model}
            onChange={(event) => setModel(event.target.value)}
          />
          <span className="hint" id={`${base}-model-h`}>
            Leave empty to use the app model.
          </span>
        </div>
      </div>
      {clientWarning ? (
        <div className="note note-warn" role="note">
          <p className="muted">
            This is a client project running on Claude Code. Claude Code login is for running
            CiteFox yourself, under your own plan; for client work, use an Anthropic API key.
          </p>
        </div>
      ) : null}
      <p className="hint">
        &quot;Wait for the plan limit to reset&quot; pauses analysis and finishes it later; searches
        already made are kept, so nothing is paid for twice. Connections are added in{' '}
        <a href={sectionHash('connections')}>Connections</a>. Claude Code uses whoever is logged in
        on this computer; CiteFox never sees that login.
      </p>
      <div className="actions">
        <Button
          variant="primary"
          disabled={save.state.kind === 'saving'}
          onClick={() => void onSave()}
        >
          Save CiteFox AI settings
        </Button>
      </div>
      <SaveStatus state={save.state} />
    </Section>
  )
}
