import { isValidElement, useEffect, useState, type JSX, type ReactNode } from 'react'
import { navigateHash, replaceHash } from '../shell/routes'
import { Button, LinkButton } from '../ui/Button'
import { Confirm } from '../ui/Confirm'
import { IconButton } from '../ui/IconButton'
import { MenuButton, type MenuItem } from '../ui/Menu'
import { ToolButton } from '../ui/Tools'
import type { ToolKind } from '../ui/toolKinds'
import type { UiIconName } from '../ui/UiIcon'
import { headerConfirmId, withHeaderConfirm } from './headerConfirm'

/** A screen's one main action: the green button at the header's right end. */
export interface HeaderPrimary {
  label: string
  icon?: UiIconName
  /** A route (`#/…`) opens as a link; otherwise `onClick` runs. */
  href?: string
  onClick?: () => void
  busy?: boolean
  disabled?: boolean
  /** `data-guide` on the button, for the first-run guide's coachmark. */
  guide?: string
}

/**
 * One tool icon at the header's right end (Download, Print / PDF, Email on a
 * schedule, Copy link…): icon only, its name as tooltip and accessible name
 * (Docs/DESIGN-GUIDELINES.md §1).
 */
export interface HeaderTool {
  id: string
  /** The standard tool (ui/Tools): its one icon and default name. */
  kind: ToolKind
  /** A more exact name ("Download CSV of 12 pages"); default: the kind's name. */
  label?: string
  /** A route (`#/…`) or an https link; otherwise `onClick` runs. */
  href?: string
  onClick?: () => void
  disabled?: boolean
}

/** What a red ⋯ item asks before it runs (ui/Confirm). */
export interface HeaderConfirm {
  /** The question, such as "Delete this topic?". */
  title: string
  body?: ReactNode
  /** Verb + object, such as "Delete topic". */
  confirmLabel: string
}

/** One line of the header's ⋯ menu. */
export interface HeaderMoreItem {
  /** Stable id: names the confirm on the URL (`?dialog=head-<id>`). */
  id: string
  label: string
  icon?: UiIconName
  /** A route (`#/…`) or an https link (opens in the browser). */
  href?: string
  onSelect?: () => void
  disabled?: boolean
  /** Red, and asks first: `onSelect` runs only after Confirm. */
  danger?: HeaderConfirm
}

function useHeaderConfirmId(): string | null {
  const [id, setId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : headerConfirmId(window.location.hash)
  )
  useEffect(() => {
    function onHash(): void {
      setId(headerConfirmId(window.location.hash))
    }
    onHash()
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return id
}

function follow(href: string): void {
  if (href.startsWith('#')) navigateHash(href)
  else window.open(href, '_blank', 'noopener,noreferrer')
}

/**
 * The right end of a screen header (Docs/HEADER.md, Docs/DESIGN-GUIDELINES.md §2),
 * always in this order: tool icons (`tools`), the legacy `actions`, the ⋯ menu,
 * then the one green primary at the far right. A red ⋯ item opens ui/Confirm
 * on the URL (`?dialog=head-<id>`), so Back closes it and a pasted link
 * reopens it; its `onSelect` runs only after the confirm.
 */
export function HeaderActions({
  tools,
  actions,
  primary,
  more,
  moreLabel = 'More actions'
}: {
  tools?: readonly HeaderTool[]
  actions?: ReactNode
  primary?: HeaderPrimary | ReactNode
  more?: readonly HeaderMoreItem[]
  moreLabel?: string
}): JSX.Element | null {
  const confirmId = useHeaderConfirmId()
  const asking = more?.find((item) => item.danger && item.id === confirmId) ?? null
  const hasMore = more !== undefined && more.length > 0
  // A menu of only disabled items cannot open, so its ⋯ says so instead of doing nothing.
  const moreDisabled = hasMore && more.every((item) => item.disabled)
  const hasTools = tools !== undefined && tools.length > 0
  if (!hasTools && !actions && !primary && !hasMore) return null

  const items: MenuItem[] = (more ?? []).map((item) => ({
    id: item.id,
    label: item.label,
    ...(item.icon ? { icon: item.icon } : {}),
    ...(item.disabled ? { disabled: true } : {}),
    // A red item starts its own group at the end, like a row menu's Delete.
    ...(item.danger ? { tone: 'danger' as const, groupStart: true } : {}),
    onSelect: () => {
      if (item.danger) navigateHash(withHeaderConfirm(window.location.hash, item.id))
      else if (item.href) follow(item.href)
      else item.onSelect?.()
    }
  }))

  function closeConfirm(): void {
    replaceHash(withHeaderConfirm(window.location.hash, null))
  }

  return (
    <>
      {hasTools
        ? tools.map((tool) => (
            <ToolButton
              key={tool.id}
              kind={tool.kind}
              {...(tool.label ? { label: tool.label } : {})}
              disabled={tool.disabled ?? false}
              onClick={() => {
                if (tool.href) follow(tool.href)
                else tool.onClick?.()
              }}
            />
          ))
        : null}
      {actions}
      {hasMore ? (
        <MenuButton
          label={moreLabel}
          items={items}
          width={248}
          trigger={({ ref, ...props }) => (
            <IconButton
              ref={ref}
              icon="dots"
              label={moreLabel}
              data-tip={moreLabel}
              className="ui-head-more"
              disabled={moreDisabled}
              {...props}
            />
          )}
        />
      ) : null}
      {primary === undefined || primary === null ? null : isValidElement(primary) ? (
        primary
      ) : (
        <PrimaryButton action={primary as HeaderPrimary} />
      )}
      {asking?.danger ? (
        <Confirm
          title={asking.danger.title}
          body={asking.danger.body}
          confirmLabel={asking.danger.confirmLabel}
          onCancel={closeConfirm}
          onConfirm={() => {
            closeConfirm()
            if (asking.href) follow(asking.href)
            else asking.onSelect?.()
          }}
        />
      ) : null}
    </>
  )
}

function PrimaryButton({ action }: { action: HeaderPrimary }): JSX.Element {
  if (action.href && !action.disabled) {
    return (
      <LinkButton
        href={action.href}
        variant="primary"
        {...(action.icon ? { icon: action.icon } : {})}
        onClick={action.onClick}
        data-guide={action.guide}
      >
        {action.label}
      </LinkButton>
    )
  }
  return (
    <Button
      variant="primary"
      {...(action.icon ? { icon: action.icon } : {})}
      busy={action.busy ?? false}
      disabled={action.disabled}
      onClick={action.onClick}
      data-guide={action.guide}
    >
      {action.label}
    </Button>
  )
}
