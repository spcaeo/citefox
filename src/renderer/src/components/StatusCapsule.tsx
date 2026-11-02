import type { ApiKeyMetadata, JinaMode } from '@shared/domain'
import type { StatusCapsule as StatusCapsuleData } from '@shared/ipc'
import { useEffect, useMemo, useRef, type JSX } from 'react'
import { statusButtonTip } from '../shell/model'
import type { OnboardingCheckupResult } from '../onboarding/claudeLogin'
import { StatusPopover } from '../shell/StatusPopover'
import { createLiveSource, type LiveSource } from '../status/live/source'
import { useNotices } from '../status/live/useNotices'
import { useSetupStatus } from '../status/live/useSetupStatus'
import { UiIcon } from '../ui/UiIcon'
import { claudeCapsuleText } from '../ui/claudeChip'
import { usePermissions } from '../ui/permissionsContext'
import { useReadiness } from '../permissions/useReadiness'

/**
 * Searches left, the top bar's icon button (Header.dc.html): its tooltip says
 * "31,898 searches left this month · Setup: 1 step left", and a small badge
 * counts what needs you (setup steps left and decisions waiting). It opens the
 * Credits and connections popover, as the ⚙ menu's "searches left · details"
 * does.
 */
export function StatusCapsule({
  capsule,
  keys,
  checkup,
  jinaMode,
  open,
  onOpenChange,
  current = false,
  live
}: {
  capsule: StatusCapsuleData
  keys: readonly ApiKeyMetadata[]
  checkup: OnboardingCheckupResult | null
  jinaMode: JinaMode | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** True on the Status screen (FR-24.1). */
  current?: boolean
  /** Tests only. Notices and page setup; production uses the preload bridge. */
  live?: LiveSource | null
}): JSX.Element {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const source = useMemo(() => (live === undefined ? createLiveSource() : live), [live])
  const notices = useNotices(source)
  const setup = useSetupStatus(source)
  const waiting = notices.notices.length
  const permissions = usePermissions()
  const claudeText = claudeCapsuleText(permissions?.claude ?? null, permissions?.checking === true)
  const claudeState = permissions?.checking ? 'checking' : (permissions?.claude?.state ?? null)
  const ready = useReadiness(capsule)
  const tip = statusButtonTip(capsule, ready)
  const ariaLabel = [
    tip,
    claudeText,
    waiting > 0 ? `${waiting} ${waiting === 1 ? 'decision' : 'decisions'} waiting for you` : null
  ]
    .filter(Boolean)
    .join('. ')
  const needsYou = (ready?.steps ?? 0) + waiting
  const warn = (ready?.items.length ?? capsule.issueCount) > 0 || waiting > 0
  const wrapRef = useRef<HTMLDivElement>(null)

  // A press anywhere outside the capsule and its popover closes it (the mock-up popover).
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent | MouseEvent): void {
      const target = event.target
      if (target instanceof Node && wrapRef.current?.contains(target)) return
      onOpenChange(false)
    }
    // A route change (a link in the popover, the sidebar, Back) closes it too.
    function onRoute(): void {
      onOpenChange(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('hashchange', onRoute)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('hashchange', onRoute)
    }
  }, [open, onOpenChange])

  function close(): void {
    onOpenChange(false)
    buttonRef.current?.focus()
  }

  return (
    <div className="status-wrap" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="topbar-icon status-pill"
        aria-expanded={open}
        aria-controls="status-pop"
        aria-haspopup="dialog"
        aria-current={current ? 'page' : undefined}
        aria-label={ariaLabel}
        data-tip={tip}
        data-tone={warn ? 'warn' : undefined}
        data-claude={claudeState ?? undefined}
        onClick={() => onOpenChange(!open)}
      >
        <UiIcon name="gauge" />
        {needsYou > 0 ? (
          <span className="topbar-badge sp-badge" aria-hidden="true">
            {needsYou}
          </span>
        ) : null}
      </button>
      {open ? (
        <StatusPopover
          capsule={capsule}
          ready={ready}
          keys={keys}
          checkup={checkup}
          jinaMode={jinaMode}
          onClose={close}
          onNavigate={() => onOpenChange(false)}
          notices={notices}
          setup={setup.status}
        />
      ) : null}
    </div>
  )
}
