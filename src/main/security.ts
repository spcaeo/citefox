import {
  classifyUrl,
  devServerUrlFrom,
  navigationAction,
  redirectAction,
  type UrlPolicy
} from './navigation'
import { app, session, shell, type Session, type WebContents } from 'electron'
import { join } from 'node:path'

export function appOutputRoot(): string {
  return join(__dirname, '..')
}

/** The renderer dev server. Always null in a packaged build (NFR-16). */
export function devServerOrigin(): string | null {
  return devServerUrlFrom(process.env, app.isPackaged)
}

export function urlPolicy(): UrlPolicy {
  return {
    devServerOrigin: devServerOrigin(),
    appRoot: appOutputRoot()
  }
}

/**
 * Blocks remote content in app windows and sends external links to the
 * system browser (NFR-16). Renderer permissions are denied, both when a page
 * requests one and when it only checks (`navigator.permissions.query`, etc.).
 */
export function installContentGuards(target: Session = session.defaultSession): void {
  const policy = urlPolicy()

  target.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })
  target.setPermissionCheckHandler(() => false)

  target.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: classifyUrl(details.url, policy) !== 'app' })
  })

  app.on('web-contents-created', (_event, contents) => {
    hardenWebContents(contents, policy)
  })
}

function hardenWebContents(contents: WebContents, policy: UrlPolicy): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (navigationAction(classifyUrl(url, policy)) === 'open-external') {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    const action = navigationAction(classifyUrl(url, policy))
    if (action === 'allow') return
    event.preventDefault()
    if (action === 'open-external') {
      void shell.openExternal(url)
    }
  })

  contents.on('will-redirect', (event, url) => {
    if (redirectAction(classifyUrl(url, policy)) === 'cancel') {
      event.preventDefault()
    }
  })

  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
}
