import { useEffect, useRef, type JSX } from 'react'
import type { ApiKeyMetadata, JinaMode } from '@shared/domain'
import { CheckupControls } from '../../connections/CheckupControls'
import { DrillButton } from '../../drill'
import { describedBy } from '../../onboarding/copy'
import type { OnboardingClient } from '../../onboarding/client'
import { loginStatusLabel, type OnboardingConnections } from '../../onboarding/claudeLogin'
import { FieldError } from '../../onboarding/parts'
import { sectionHash } from '../../shell/routes'
import { Panel } from '../../ui'
import { claudeModelLabel, DEFAULT_CLAUDE_MODEL_LABEL } from '../modelLabel'
import { checkupDrill } from '../utils/drills'
import { CodexFields } from './CodexFields'
import type { SettingsDraft, SettingsErrors } from '../validate'
import { UsedMonth } from './UsedMonth'
import { PermissionsSummary } from '../../permissions/PermissionsSummary'

const JINA_MODES: readonly { value: JinaMode; label: string }[] = [
  { value: 'fallback', label: 'Only when a normal fetch fails' },
  { value: 'always', label: 'Always' },
  { value: 'never', label: 'Never' }
]

/**
 * App settings › AI & searches: the app-wide settings of each service. Keys are
 * added, tested and replaced on the Connections screen only (one home), so this
 * tab links there in one line; then the search budget and which AI runs the
 * analysis (Claude Code, an Anthropic API key, or Codex). The model, calls at
 * once, the Claude path and when Jina reads pages are under More settings.
 */
export function ConnectionsCard({
  client,
  overview,
  serp,
  draft,
  errors,
  patch,
  onChanged,
  savedClaudePath = null,
  savedCodexPath = null
}: {
  client: OnboardingClient
  overview: OnboardingConnections
  /** The key the monthly budget applies to. */
  serp: ApiKeyMetadata | null
  draft: SettingsDraft
  errors: SettingsErrors
  patch: (partial: Partial<SettingsDraft>) => void
  onChanged: () => Promise<void>
  /** The stored Claude binary path, so Run checkup can tell an unsaved edit. */
  savedClaudePath?: string | null
  /** The stored Codex path, for the same reason. */
  savedCodexPath?: string | null
}): JSX.Element {
  const connections = sectionHash('connections')
  const codex = draft.claudeProvider === 'codex'
  // More settings opens itself when Save finds a problem in one of its fields.
  const moreRef = useRef<HTMLDetailsElement>(null)
  const moreError = Boolean(errors.claudeConcurrency || errors.claudeBinaryPath)
  useEffect(() => {
    if (moreError && moreRef.current) moreRef.current.open = true
  }, [moreError])
  return (
    <div className="stg-grid">
      {/* Keys live in Connections (Setup in the sidebar); each section below links there. */}
      <PermissionsSummary className="stg-span-12" />

      <Panel title="SerpApi searches" className="stg-span-12">
        <div className="grid2">
          <div className="field">
            <label className="field-label" htmlFor="budget">
              Monthly search budget
            </label>
            <input
              id="budget"
              className="ob-input mono"
              inputMode="numeric"
              value={draft.budget}
              disabled={!serp}
              aria-invalid={errors.budget ? true : undefined}
              aria-describedby={describedBy([
                'budget-hint',
                errors.budget ? 'budget-error' : false
              ])}
              onChange={(event) => patch({ budget: event.target.value })}
            />
            <p className="hint" id="budget-hint">
              {serp ? (
                'Empty means no cap. CiteFox stops before a check would go over this.'
              ) : (
                <>
                  <a href={connections}>Add a SerpApi key</a> before setting a budget.
                </>
              )}
            </p>
            {errors.budget ? <FieldError id="budget-error">{errors.budget}</FieldError> : null}
          </div>
          <UsedMonth keys={overview.keys} />
        </div>
      </Panel>

      <Panel title="AI" className="stg-span-12">
        <fieldset>
          <legend>Run analysis with</legend>
          <div className="stack-tight">
            <label
              className={draft.claudeProvider === 'claude-code' ? 'radio on' : 'radio'}
              htmlFor="mode-cli"
            >
              <input
                id="mode-cli"
                type="radio"
                name="claude-mode"
                checked={draft.claudeProvider === 'claude-code'}
                onChange={() => patch({ claudeProvider: 'claude-code' })}
              />
              <span>
                <span className="key-name">Claude Code on this computer</span>
                <span className="mono faint">
                  {overview.claudeCheckup && overview.claudeCheckup.provider !== 'codex'
                    ? [overview.claudeCheckup.binaryPath, overview.claudeCheckup.version]
                        .filter(Boolean)
                        .join(' · ') || 'Saved path'
                    : 'Not tested yet'}
                </span>
              </span>
            </label>
            <label
              className={draft.claudeProvider === 'anthropic-api' ? 'radio on' : 'radio'}
              htmlFor="mode-api"
            >
              <input
                id="mode-api"
                type="radio"
                name="claude-mode"
                checked={draft.claudeProvider === 'anthropic-api'}
                onChange={() => patch({ claudeProvider: 'anthropic-api' })}
              />
              <span>
                <span className="key-name">Anthropic API key</span>
                <span className="faint">For client work, shared computers or CI</span>
              </span>
            </label>
            <label
              className={draft.claudeProvider === 'codex' ? 'radio on' : 'radio'}
              htmlFor="mode-codex"
            >
              <input
                id="mode-codex"
                type="radio"
                name="claude-mode"
                checked={draft.claudeProvider === 'codex'}
                onChange={() => patch({ claudeProvider: 'codex' })}
              />
              <span>
                <span className="key-name">Codex on this computer</span>
                <span
                  className={overview.claudeCheckup?.provider === 'codex' ? 'mono faint' : 'faint'}
                >
                  {overview.claudeCheckup?.provider === 'codex'
                    ? [overview.claudeCheckup.binaryPath, overview.claudeCheckup.version]
                        .filter(Boolean)
                        .join(' · ') || 'Saved path'
                    : 'OpenAI’s Codex, on your own ChatGPT plan'}
                </span>
              </span>
            </label>
          </div>
        </fieldset>
        <p className="hint">
          {overview.claudeCheckup ? (
            <>
              Last checkup: {loginStatusLabel(overview.claudeCheckup)}.{' '}
              <DrillButton drill={checkupDrill(overview.claudeCheckup)} untracked>
                Checkup details
              </DrillButton>
              {' · '}
            </>
          ) : null}
          {draft.claudeProvider === 'anthropic-api' ? (
            <a href={connections}>Add and test Anthropic API keys in Connections</a>
          ) : (
            <a href={connections}>{codex ? 'AI' : 'Claude'} in Connections</a>
          )}
        </p>
        {draft.claudeProvider === 'codex' ? (
          <CodexFields
            client={client}
            overview={overview}
            draft={draft}
            errors={errors}
            patch={patch}
            onChanged={onChanged}
            savedCodexPath={savedCodexPath}
          />
        ) : null}
        {codex ? null : (
          <CheckupControls
            client={client}
            checkup={overview.claudeCheckup}
            claudeModel={draft.claudeModel.trim() ? draft.claudeModel : null}
            onChanged={onChanged}
            typedPath={draft.claudeBinaryPath}
            savedPath={savedClaudePath}
          />
        )}
      </Panel>
      <details ref={moreRef} className="stg-span-12 stg-more">
        <summary>More settings</summary>
        <div className="grid2">
          {codex ? null : (
            <div className="field">
              <label className="field-label" htmlFor="model">
                Model
              </label>
              <input
                id="model"
                className="ob-input mono"
                value={draft.claudeModel}
                placeholder={DEFAULT_CLAUDE_MODEL_LABEL}
                aria-describedby="model-hint"
                onChange={(event) => patch({ claudeModel: event.target.value })}
              />
              <p className="hint" id="model-hint">
                {draft.claudeModel.trim()
                  ? `CiteFox asks Claude for ${claudeModelLabel(draft.claudeModel)}.`
                  : `${DEFAULT_CLAUDE_MODEL_LABEL}. Leave this empty to keep it.`}
              </p>
            </div>
          )}
          <div className="field">
            <label className="field-label" htmlFor="concurrency">
              Calls at once
            </label>
            <input
              id="concurrency"
              className="ob-input mono"
              inputMode="numeric"
              value={draft.claudeConcurrency}
              aria-invalid={errors.claudeConcurrency ? true : undefined}
              aria-describedby={describedBy([
                'concurrency-hint',
                errors.claudeConcurrency ? 'concurrency-error' : false
              ])}
              onChange={(event) => patch({ claudeConcurrency: event.target.value })}
            />
            <p className="hint" id="concurrency-hint">
              How many AI calls CiteFox makes at the same time.
            </p>
            {errors.claudeConcurrency ? (
              <FieldError id="concurrency-error">{errors.claudeConcurrency}</FieldError>
            ) : null}
          </div>
        </div>
        {codex ? null : (
          <div className="field">
            <label className="field-label" htmlFor="claude-path">
              Claude binary path
            </label>
            <input
              id="claude-path"
              className="ob-input mono"
              value={draft.claudeBinaryPath}
              placeholder="PATH and the usual install folders"
              aria-invalid={errors.claudeBinaryPath ? true : undefined}
              aria-describedby={describedBy([
                'claude-path-hint',
                errors.claudeBinaryPath ? 'claude-path-error' : false
              ])}
              onChange={(event) => patch({ claudeBinaryPath: event.target.value })}
            />
            <p className="hint" id="claude-path-hint">
              Empty searches PATH and the usual install folders, or enter the full path, such as
              /Users/you/.local/bin/claude.
            </p>
            {errors.claudeBinaryPath ? (
              <FieldError id="claude-path-error">{errors.claudeBinaryPath}</FieldError>
            ) : null}
          </div>
        )}
        <div className="field">
          <label className="field-label" htmlFor="jina-when">
            Read pages with Jina Reader
          </label>
          <select
            id="jina-when"
            className="select"
            value={draft.jinaMode}
            onChange={(event) => patch({ jinaMode: event.target.value as JinaMode })}
          >
            {JINA_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </div>
      </details>
    </div>
  )
}
