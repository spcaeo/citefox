import type {
  BuildDiagnosticsRequest,
  CiteFoxApi,
  DiagnosticsMenuEvent,
  DiagnosticsOpenResult,
  DiagnosticsReport,
  SaveDiagnosticsResult,
  SendDiagnosticsRequest,
  SendDiagnosticsResult
} from '@shared/ipc'

/**
 * Report a problem. Main builds the report text and removes secrets; the renderer shows it
 * and only ever hands the same text back to save. Nothing here sends anything anywhere.
 */
export interface DiagnosticsClient {
  build(request: BuildDiagnosticsRequest): Promise<DiagnosticsReport>
  send(request: SendDiagnosticsRequest): Promise<SendDiagnosticsResult>
  save(text: string): Promise<SaveDiagnosticsResult>
  revealLogs(): Promise<DiagnosticsOpenResult>
  openMail(note: string): Promise<DiagnosticsOpenResult>
  /** Help › Report a problem… Returns the unsubscribe. */
  onMenu(listener: (event: DiagnosticsMenuEvent) => void): () => void
}

function api(): CiteFoxApi {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}

export function createDiagnosticsClient(): DiagnosticsClient {
  return {
    build: (request) => api()['diagnostics:build'](request),
    send: (request) => api()['diagnostics:send'](request),
    save: (text) => api()['diagnostics:save']({ text }),
    revealLogs: () => api()['diagnostics:reveal-logs'](),
    openMail: (note) => api()['diagnostics:open-mail']({ note }),
    onMenu: (listener) => {
      if (
        typeof window === 'undefined' ||
        typeof window.citefox?.['diagnostics:menu'] !== 'function'
      ) {
        return () => undefined
      }
      return window.citefox['diagnostics:menu'](listener)
    }
  }
}

let shared: DiagnosticsClient | null = null

/** The preload client, or a test's fake set with {@link setDiagnosticsClient}. */
export function diagnosticsClient(): DiagnosticsClient {
  shared ??= createDiagnosticsClient()
  return shared
}

export function setDiagnosticsClient(client: DiagnosticsClient | null): void {
  shared = client
}
