import { useCallback, useEffect, useState } from 'react'
import type { OpenTestProfileResult } from '@shared/ipc'
import { copyText } from '../components/clipboard'
import { COPIED_MS } from '../components/UrlText'
import { errorText } from '../components/errorText'
import { useAppInfo } from './appInfoStore'
import { useBuildTools } from './buildClient'
import { buildInfoText, platformLabel } from './buildInfo'
import { openBuildDialog, type BuildDialog } from './dialogHash'

/** The toast line for an `app:openTestProfile` result. */
export function testProfileNotice(
  result: OpenTestProfileResult,
  fresh: boolean
): { message: string; tone: 'ok' | 'bad' } {
  if (!result.ok) return { message: result.message, tone: 'bad' }
  if (result.alreadyOpen) return { message: 'Test window is already open', tone: 'ok' }
  return { message: fresh ? 'Fresh test window opened' : 'Test window opened', tone: 'ok' }
}

/** Menu and panel labels, which change inside a test profile. */
export function resetLabel(testProfile: boolean): string {
  return testProfile ? 'Reset this test profile, keep its keys…' : 'Reset CiteFox, keep my keys…'
}

export const TEST_AS_NEW_USER = 'Test as a new user'
export const FRESH_TEST_PROFILE = 'Start a fresh test profile…'
export const COPY_BUILD_INFO = 'Copy build info'

/**
 * What the build chip and Settings › About share: the app info, Copy build
 * info (a green tick for about 1.5 s), Test as a new user (result in the
 * build toast) and the two confirm dialogs (opened on the URL).
 */
export function useBuildActions(fetchInfo?: Parameters<typeof useAppInfo>[0]): {
  info: ReturnType<typeof useAppInfo>
  testProfile: boolean
  copied: boolean
  copyBuildInfo: () => Promise<void>
  opening: boolean
  testAsNewUser: () => Promise<void>
  openDialog: (dialog: BuildDialog) => void
} {
  const { client, notify } = useBuildTools()
  const info = useAppInfo(fetchInfo)
  const [copied, setCopied] = useState(false)
  const [opening, setOpening] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  const copyBuildInfo = useCallback(async () => {
    if (!info) return
    const ok = await copyText(buildInfoText(info, platformLabel()))
    if (ok) setCopied(true)
    else notify('Could not copy the build info.', 'bad')
  }, [info, notify])

  const testAsNewUser = useCallback(async () => {
    setOpening(true)
    try {
      const notice = testProfileNotice(await client.openTestProfile({ fresh: false }), false)
      notify(notice.message, notice.tone)
    } catch (cause) {
      notify(errorText(cause, 'Could not open the test window.'), 'bad')
    } finally {
      setOpening(false)
    }
  }, [client, notify])

  return {
    info,
    testProfile: info?.testProfile === true,
    copied,
    copyBuildInfo,
    opening,
    testAsNewUser,
    openDialog: openBuildDialog
  }
}
