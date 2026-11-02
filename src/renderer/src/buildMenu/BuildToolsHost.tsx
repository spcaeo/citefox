import { useCallback, useEffect, useMemo, useState, type JSX, type ReactNode } from 'react'
import { UiIcon } from '../ui/UiIcon'
import { useAppInfo } from './appInfoStore'
import {
  BuildToolsContext,
  type BuildClient,
  type BuildNoticeAction,
  type BuildNoticeLink,
  type BuildNoticeTone
} from './buildClient'
import { FreshTestDialog, ResetDialog } from './BuildDialogs'
import { closeBuildDialog, useBuildDialog } from './dialogHash'

/** How long a build toast stays. */
export const BUILD_TOAST_MS = 5000
/** How long a toast with an action (Undo) stays, so there is time to press it. */
export const BUILD_TOAST_ACTION_MS = 10000

interface Notice {
  id: number
  message: string
  tone: BuildNoticeTone
  link: BuildNoticeLink | null
  action: BuildNoticeAction | null
}

/**
 * Mounted once per window (App.tsx, around onboarding and the shell): gives
 * every build chip and Settings › About the client, shows the confirm dialog
 * the URL asks for (`?dialog=reset`, `?dialog=fresh-test`) and the one
 * result toast ("Test window opened").
 */
export function BuildToolsHost({
  client,
  children
}: {
  client: BuildClient
  children: ReactNode
}): JSX.Element {
  const [notice, setNotice] = useState<Notice | null>(null)
  const dialog = useBuildDialog()

  const notify = useCallback(
    (
      message: string,
      tone: BuildNoticeTone = 'ok',
      link?: BuildNoticeLink,
      action?: BuildNoticeAction
    ) => {
      setNotice((current) => ({
        id: (current?.id ?? 0) + 1,
        message,
        tone,
        link: link ?? null,
        action: action ?? null
      }))
    },
    []
  )
  const clearNotice = useCallback(() => setNotice(null), [])
  const tools = useMemo(() => ({ client, notify }), [client, notify])

  return (
    <BuildToolsContext.Provider value={tools}>
      {children}
      <HostDialogs dialog={dialog} client={client} notify={notify} />
      {/* Always mounted (no status role, so screens keep their one status), and read aloud on change. */}
      <div className="bm-toast-region" aria-live="polite" aria-atomic="true">
        {notice ? <BuildToast key={notice.id} notice={notice} onClose={clearNotice} /> : null}
      </div>
    </BuildToolsContext.Provider>
  )
}

function HostDialogs({
  dialog,
  client,
  notify
}: {
  dialog: ReturnType<typeof useBuildDialog>
  client: BuildClient
  notify: (message: string, tone?: BuildNoticeTone) => void
}): JSX.Element | null {
  const info = useAppInfo()
  if (dialog === 'reset') {
    return (
      <ResetDialog
        client={client}
        testProfile={info?.testProfile === true}
        onClose={closeBuildDialog}
      />
    )
  }
  // A test window cannot open another one; its own reset does the same.
  if (dialog === 'fresh-test' && info?.testProfile !== true) {
    return (
      <FreshTestDialog
        client={client}
        onClose={closeBuildDialog}
        onDone={(message, tone) => {
          closeBuildDialog()
          notify(message, tone)
        }}
      />
    )
  }
  return null
}

function BuildToast({ notice, onClose }: { notice: Notice; onClose: () => void }): JSX.Element {
  useEffect(() => {
    const timer = window.setTimeout(onClose, notice.action ? BUILD_TOAST_ACTION_MS : BUILD_TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [notice.id, notice.action, onClose])
  return (
    <div className="bm-toast" data-tone={notice.tone}>
      <UiIcon name={notice.tone === 'ok' ? 'check' : 'warning'} size={16} />
      <span className="bm-toast-text">{notice.message}</span>
      {notice.action ? (
        <button
          type="button"
          className="bm-toast-action"
          onClick={() => {
            onClose()
            notice.action?.onClick()
          }}
        >
          {notice.action.label}
        </button>
      ) : null}
      {notice.link ? (
        <a className="bm-toast-link" href={notice.link.href} onClick={onClose}>
          {notice.link.label}
        </a>
      ) : null}
      <button type="button" className="bm-toast-close" aria-label="Close" onClick={onClose}>
        <UiIcon name="x" size={14} />
      </button>
    </div>
  )
}
