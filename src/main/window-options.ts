/** Renderer hardening required by NFR-16. Literal types keep a wrong flag from compiling. */
export interface RendererWebPreferences {
  preload: string
  contextIsolation: true
  nodeIntegration: false
  sandbox: true
  webviewTag: false
  nodeIntegrationInWorker: false
  nodeIntegrationInSubFrames: false
  webSecurity: true
  allowRunningInsecureContent: false
  experimentalFeatures: false
  navigateOnDragDrop: false
  /** False in a packaged build. Dev and e2e (unpackaged `out/main`) keep DevTools. */
  devTools: boolean
}

export function mainWindowWebPreferences(
  preloadPath: string,
  options: { devTools: boolean }
): RendererWebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webviewTag: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    navigateOnDragDrop: false,
    devTools: options.devTools
  }
}
