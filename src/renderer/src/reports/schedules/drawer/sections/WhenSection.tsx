import type { JSX } from 'react'
import { DrawerField, DrawerFields, DrawerSection } from '../../../../ui'
import { TimeZoneSelect } from '../../../../ui/TimeZoneSelect'
import {
  CHANGE_OPTIONS,
  TRIGGER_OPTIONS,
  timingHint,
  weekdayChoices,
  type ScheduleDraft
} from '../../../scheduleModel'

/** When: the trigger, its day and time, the events that send, and the time zone. */
export function WhenSection({
  draft,
  patch,
  projectName,
  now
}: {
  draft: ScheduleDraft
  patch: (partial: Partial<ScheduleDraft>) => void
  projectName: string | null
  now: Date
}): JSX.Element {
  const timed = draft.trigger === 'weekly' || draft.trigger === 'monthly'
  return (
    <DrawerSection title="When" description={timingHint(draft, now, projectName)} testId="sd-when">
      <fieldset className="rpt-field">
        <legend className="sr-only">When to send</legend>
        <div className="rpt-trig" role="radiogroup" aria-label="When to send">
          {TRIGGER_OPTIONS.map((option) => (
            <label key={option.id} className="rpt-check" title={option.desc}>
              <input
                type="radio"
                name="trigger"
                value={option.id}
                checked={draft.trigger === option.id}
                onChange={() =>
                  patch({
                    trigger: option.id,
                    time:
                      option.id === 'monthly'
                        ? '07:00'
                        : option.id === 'weekly'
                          ? '08:00'
                          : draft.time
                  })
                }
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
      <DrawerFields columns={2}>
        {draft.trigger === 'weekly' ? (
          <DrawerField label="Day" htmlFor="n-day">
            <select
              id="n-day"
              className="ui-input rpt-select"
              value={String(draft.day)}
              onChange={(event) =>
                patch({ day: Number(event.target.value) as ScheduleDraft['day'] })
              }
            >
              {weekdayChoices().map((day) => (
                <option key={day.day} value={day.day}>
                  {day.label}
                </option>
              ))}
            </select>
          </DrawerField>
        ) : null}
        {draft.trigger === 'monthly' ? (
          <DrawerField label="Day" htmlFor="n-mday">
            <select
              id="n-mday"
              className="ui-input rpt-select"
              value={draft.mday}
              onChange={(event) => patch({ mday: event.target.value as ScheduleDraft['mday'] })}
            >
              <option value="1">1st</option>
              <option value="15">15th</option>
              <option value="last">Last day</option>
            </select>
          </DrawerField>
        ) : null}
        {timed ? (
          <DrawerField label="Time" htmlFor={draft.trigger === 'monthly' ? 'n-mtime' : 'n-time'}>
            <input
              id={draft.trigger === 'monthly' ? 'n-mtime' : 'n-time'}
              className="ui-input"
              type="time"
              value={draft.time}
              onChange={(event) => patch({ time: event.target.value })}
            />
          </DrawerField>
        ) : null}
        <DrawerField
          label="Time zone"
          htmlFor="n-tz"
          wide={!timed}
          hint={timed ? 'The day and time are in this zone.' : 'Dates in the email use this zone.'}
        >
          {({ id, describedBy }) => (
            <TimeZoneSelect
              id={id}
              value={draft.timeZone}
              onChange={(timeZone) => patch({ timeZone })}
              describedBy={describedBy}
              at={now}
              testId="sd-tz"
            />
          )}
        </DrawerField>
      </DrawerFields>
      {draft.trigger === 'on_change' ? (
        <div className="stack-tight rpt-events">
          {CHANGE_OPTIONS.map((option) =>
            option.id === 'score_drop' ? (
              <span className="rpt-check" key={option.id}>
                <input
                  id="n-drop"
                  type="checkbox"
                  checked={draft.events.score_drop}
                  onChange={() =>
                    patch({ events: { ...draft.events, score_drop: !draft.events.score_drop } })
                  }
                />
                <label htmlFor="n-drop">The score dropped by more than</label>
                <input
                  className="ui-input rpt-points"
                  inputMode="numeric"
                  aria-label="Points"
                  value={String(draft.drop)}
                  onChange={(event) => patch({ drop: Number(event.target.value) || 0 })}
                />
                <span>points</span>
              </span>
            ) : (
              <label className="rpt-check" key={option.id}>
                <input
                  type="checkbox"
                  checked={draft.events[option.id]}
                  onChange={() =>
                    patch({ events: { ...draft.events, [option.id]: !draft.events[option.id] } })
                  }
                />
                {option.label}
              </label>
            )
          )}
        </div>
      ) : null}
    </DrawerSection>
  )
}
