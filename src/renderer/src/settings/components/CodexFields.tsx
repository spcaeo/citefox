import type { JSX } from 'react'
import { CheckupControls } from '../../connections/CheckupControls'
import {
  DEFAULT_CODEX_MODEL_LABEL,
  DEFAULT_CODEX_QUICK_MODEL_LABEL
} from '../../connections/aiProvider'
import { describedBy } from '../../onboarding/copy'
import type { OnboardingClient } from '../../onboarding/client'
import type { OnboardingConnections } from '../../onboarding/claudeLogin'
import { FieldError } from '../../onboarding/parts'
import type { SettingsDraft, SettingsErrors } from '../validate'

/**
 * Settings › Connections › AI when Codex runs the analysis: its two models (heavy
 * jobs and quick jobs), calls at once, the program path, and its checkup.
 */
export function CodexFields({
  client,
  overview,
  draft,
  errors,
  patch,
  onChanged,
  savedCodexPath
}: {
  client: OnboardingClient
  overview: OnboardingConnections
  draft: SettingsDraft
  errors: SettingsErrors
  patch: (partial: Partial<SettingsDraft>) => void
  onChanged: () => Promise<void>
  savedCodexPath: string | null
}): JSX.Element {
  return (
    <>
      <div className="grid2">
        <div className="field">
          <label className="field-label" htmlFor="codex-model">
            Model
          </label>
          <input
            id="codex-model"
            className="ob-input mono"
            value={draft.codexModel}
            placeholder={DEFAULT_CODEX_MODEL_LABEL}
            aria-describedby="codex-model-hint"
            onChange={(event) => patch({ codexModel: event.target.value })}
          />
          <p className="hint" id="codex-model-hint">
            For check analysis, reports, page reads, Ask CiteFox and the competitor web search.
          </p>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="codex-quick-model">
            Quick model
          </label>
          <input
            id="codex-quick-model"
            className="ob-input mono"
            value={draft.codexQuickModel}
            placeholder={DEFAULT_CODEX_QUICK_MODEL_LABEL}
            aria-describedby="codex-quick-model-hint"
            onChange={(event) => patch({ codexQuickModel: event.target.value })}
          />
          <p className="hint" id="codex-quick-model-hint">
            For short jobs such as form helpers and the test call. Leave empty for the default.
          </p>
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="codex-path">
          Codex program path
        </label>
        <input
          id="codex-path"
          className="ob-input mono"
          value={draft.codexBinaryPath}
          placeholder="PATH and the usual install folders"
          aria-invalid={errors.codexBinaryPath ? true : undefined}
          aria-describedby={describedBy([
            'codex-path-hint',
            errors.codexBinaryPath ? 'codex-path-error' : false
          ])}
          onChange={(event) => patch({ codexBinaryPath: event.target.value })}
        />
        <p className="hint" id="codex-path-hint">
          Empty searches PATH and the usual install folders, or enter the full path, such as
          /Users/you/.local/bin/codex.
        </p>
        {errors.codexBinaryPath ? (
          <FieldError id="codex-path-error">{errors.codexBinaryPath}</FieldError>
        ) : null}
      </div>
      <CheckupControls
        client={client}
        provider="codex"
        checkup={overview.claudeCheckup}
        claudeModel={null}
        codexModel={draft.codexModel.trim() ? draft.codexModel : null}
        onChanged={onChanged}
        typedPath={draft.codexBinaryPath}
        savedPath={savedCodexPath}
      />
    </>
  )
}
