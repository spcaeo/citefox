import type { JSX, ReactNode } from 'react'
import { Chip } from './Chip'
import { UiIcon, type UiIconName } from './UiIcon'

/** One way to start: a compact radio row. */
export interface WayOption<Id extends string> {
  id: Id
  icon: UiIconName
  title: string
  /** The one-line example from the user's profile, such as "e.g. https://example.com/pricing". */
  example: string
  /** Short tags at the end of the row, such as "Needs a URL". */
  tags?: readonly string[]
  /** A fox "Suggested" tag after the others. */
  suggested?: boolean
  /** Not offered yet: the radio is disabled and the row says "Coming later". */
  later?: boolean
}

/**
 * The one chooser for "which way do you want to start?" (owner rule: one
 * compact chooser): a list of radio rows, each with an icon, the title, a
 * one-line example from the user's own profile and optional tags. Used by
 * "How do you want to start?" (start/ChooseScreen) and "What do you want to
 * track?" (topics/wizard ChooserScreen). `after` adds a plain row under the
 * radios, outside the group (Search Console, coming later). Styles live in
 * ui/way-list.css.
 */
export function WayList<Id extends string>({
  label,
  role = 'radiogroup',
  name,
  options,
  value,
  onChange,
  after
}: {
  /** Accessible name of the group, such as "Starting point". */
  label: string
  /** `group` for a set that is optional inside a larger choice. Default `radiogroup`. */
  role?: 'radiogroup' | 'group'
  /** The radios' shared name. */
  name: string
  options: readonly WayOption<Id>[]
  value: Id | null
  onChange: (id: Id) => void
  after?: ReactNode
}): JSX.Element {
  return (
    <div className="ui-way-list">
      <div role={role} aria-label={label} className="ui-way-group">
        {options.map((option) => {
          const on = value === option.id
          return (
            <label
              key={option.id}
              className={`ui-way-row${on ? ' on' : ''}${option.later ? ' off' : ''}`}
            >
              <input
                type="radio"
                name={name}
                className="ui-way-radio"
                checked={on}
                disabled={option.later === true}
                onChange={() => onChange(option.id)}
              />
              <WayText
                icon={option.icon}
                title={option.title}
                example={option.example}
                badge={option.later ? <Chip size="sm">Coming later</Chip> : null}
              />
              {option.tags?.length || option.suggested ? (
                <span className="ui-way-tags">
                  {option.tags?.map((tag) => (
                    <Chip key={tag} size="sm">
                      {tag}
                    </Chip>
                  ))}
                  {option.suggested ? (
                    <Chip size="sm" tone="fox">
                      Suggested
                    </Chip>
                  ) : null}
                </span>
              ) : null}
            </label>
          )
        })}
      </div>
      {after}
    </div>
  )
}

/** A plain row in the list's look, for a way that is not a radio (Search Console). */
export function WayNote({
  icon,
  title,
  example,
  badge,
  action
}: {
  icon: UiIconName
  title: string
  example: string
  badge?: ReactNode
  action?: ReactNode
}): JSX.Element {
  return (
    <div className="ui-way-row off ui-way-note">
      <span className="ui-way-radio-space" aria-hidden="true" />
      <WayText icon={icon} title={title} example={example} badge={badge ?? null} />
      {action ? <span className="ui-way-tags">{action}</span> : null}
    </div>
  )
}

function WayText({
  icon,
  title,
  example,
  badge
}: {
  icon: UiIconName
  title: string
  example: string
  badge: ReactNode
}): JSX.Element {
  const url = example.startsWith('e.g. https://') || example.startsWith('e.g. http://')
  return (
    <>
      <span className="ui-way-icon" aria-hidden="true">
        <UiIcon name={icon} size={16} />
      </span>
      <span className="ui-way-text">
        <span className="ui-way-title">
          {title}
          {badge}
        </span>
        <span className="ui-way-example">
          {url ? (
            <>
              e.g. <span className="ui-way-mono">{example.slice(5)}</span>
            </>
          ) : (
            example
          )}
        </span>
      </span>
    </>
  )
}
