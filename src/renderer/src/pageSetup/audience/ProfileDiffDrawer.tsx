import { useMemo, useState, type JSX } from 'react'
import type { BuyerProfile } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import {
  Drawer,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection,
  SegmentedControl
} from '../../ui'
import { TemplateProvenance } from '../TemplateProvenance'
import { applyDiff, changedLines, profileDiff, type DiffChoice, type DiffLine } from './diff'
import { PART_LABEL, type PlainPoint, type ProfilePatch } from './model'

export interface ProfileDiffDrawerProps {
  /** The profile as it was before Regenerate (still the saved one). */
  before: BuyerProfile
  /** Claude's new profile. */
  after: BuyerProfile
  /** Writes the chosen points. */
  onApply: (patch: ProfilePatch) => Promise<void>
  /** Leaves the saved profile as it is. */
  onClose: () => void
}

function choiceLabels(line: DiffLine): { keep: string; replace: string } {
  if (line.before === null) return { keep: 'Skip', replace: 'Add' }
  if (line.after === null) return { keep: 'Keep', replace: 'Remove' }
  return { keep: 'Keep', replace: 'Replace' }
}

function Point({ point, empty }: { point: PlainPoint | null; empty: string }): JSX.Element {
  if (point === null) return <p className="au-diff-empty">{empty}</p>
  return (
    <p className="au-diff-text">
      {point.text}
      {point.reason ? <span className="au-point-reason">{point.reason}</span> : null}
    </p>
  )
}

/**
 * Regenerate's review (`?drawer=profile-diff&pdiff=<new profile id>`): the
 * saved profile and Claude's new one side by side, section by section. Each
 * changed point keeps the old wording or takes the new; "Replace all" takes
 * every new point. Nothing changes until Apply.
 */
export function ProfileDiffDrawer({
  before,
  after,
  onApply,
  onClose
}: ProfileDiffDrawerProps): JSX.Element {
  const diff = useMemo(() => profileDiff(before, after), [before, after])
  const changed = useMemo(() => changedLines(diff), [diff])
  const [choices, setChoices] = useState<Record<string, DiffChoice>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const replacing = changed.filter((line) => choices[line.id] === 'replace').length
  const allReplaced = changed.length > 0 && replacing === changed.length
  const same = diff.reduce(
    (sum, part) => sum + part.lines.filter((line) => line.kind === 'same').length,
    0
  )

  async function apply(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      await onApply(applyDiff(diff, choices))
    } catch (cause: unknown) {
      setError(cause instanceof Error && cause.message ? cause.message : 'Could not save.')
      setSaving(false)
    }
  }

  function setAll(choice: DiffChoice): void {
    setChoices(Object.fromEntries(changed.map((line) => [line.id, choice])))
  }

  const summary = error ? (
    <span className="au-drawer-error" role="alert">
      {error}
    </span>
  ) : changed.length === 0 ? (
    'CiteFox AI wrote the same profile. Nothing to change.'
  ) : (
    `${pluralize(replacing, 'point')} from the new profile · ${pluralize(changed.length - replacing, 'point')} kept as they are`
  )

  return (
    <Drawer
      id="profile-diff"
      title="Review the new buyer profile"
      subtitle="Your profile and CiteFox AI’s new one, side by side. Nothing changes until you apply."
      testId="profile-diff-drawer"
      dirty={replacing > 0 && !saving}
      guard={{
        title: 'Keep your profile as it is?',
        body: 'The new points are dropped. You can regenerate again later.',
        keepLabel: 'Keep reviewing',
        discardLabel: 'Drop the new points'
      }}
      busy={saving}
      closeDisabled={saving}
      onClose={onClose}
      footer={{
        summary,
        cancel: 'Keep my profile',
        ...(changed.length > 0
          ? {
              secondary: {
                label: allReplaced ? 'Keep all' : 'Replace all',
                disabled: saving,
                onClick: () => setAll(allReplaced ? 'keep' : 'replace')
              }
            }
          : {}),
        primary: {
          label: 'Apply',
          busy: saving,
          disabled: saving || replacing === 0,
          onClick: () => void apply()
        }
      }}
    >
      <DrawerGrid>
        <DrawerMain>
          {diff.map(({ part, lines }) =>
            lines.length === 0 ? null : (
              <DrawerSection key={part} title={PART_LABEL[part]}>
                <div className="au-diff" role="list" aria-label={PART_LABEL[part]}>
                  <div className="au-diff-head" aria-hidden="true">
                    <span>Now</span>
                    <span>New</span>
                    <span />
                  </div>
                  {lines.map((line) => {
                    const labels = choiceLabels(line)
                    const name = line.before?.text ?? line.after?.text ?? ''
                    return (
                      <div
                        key={line.id}
                        role="listitem"
                        className="au-diff-line"
                        data-kind={line.kind}
                        data-choice={choices[line.id] ?? 'keep'}
                      >
                        <Point point={line.before} empty="Not in your profile" />
                        {line.kind === 'same' ? (
                          <p className="au-diff-empty">Same</p>
                        ) : (
                          <Point point={line.after} empty="Not in the new profile" />
                        )}
                        {line.kind === 'same' ? (
                          <span />
                        ) : (
                          <SegmentedControl<DiffChoice>
                            size="sm"
                            label={`${labels.keep} or ${labels.replace.toLowerCase()}: ${name}`}
                            value={choices[line.id] ?? 'keep'}
                            onChange={(choice) =>
                              setChoices((current) => ({ ...current, [line.id]: choice }))
                            }
                            options={[
                              { value: 'keep', label: labels.keep },
                              { value: 'replace', label: labels.replace }
                            ]}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              </DrawerSection>
            )
          )}
        </DrawerMain>
        <DrawerRail label="About the new profile">
          <DrawerSection title="What changed">
            <dl className="au-rail-facts">
              <div>
                <dt>Changed</dt>
                <dd>{pluralize(changed.length, 'point')}</dd>
              </div>
              <div>
                <dt>Same</dt>
                <dd>{pluralize(same, 'point')}</dd>
              </div>
              <div>
                <dt>Template</dt>
                <dd>
                  <TemplateProvenance
                    templateId={after.templateId}
                    templateName={after.templateName}
                    templateHash={after.templateHash}
                    edited={after.templateUpdatedAt !== null}
                  />
                </dd>
              </div>
            </dl>
            <p className="au-note">
              Saved questions stay as they are until you rewrite them. Undo puts your profile back
              after you apply.
            </p>
          </DrawerSection>
        </DrawerRail>
      </DrawerGrid>
    </Drawer>
  )
}

/** The drawer opened from a link after the comparison it showed is gone (a reload). */
export function ProfileDiffMissing({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <Drawer
      id="profile-diff"
      title="Review the new buyer profile"
      testId="profile-diff-drawer"
      onClose={onClose}
      focusOnOpen="close"
      footer={{ summary: 'Your saved profile is unchanged.' }}
    >
      <DrawerMain>
        <DrawerSection title="Nothing to compare">
          <p className="au-note">
            This comparison was not kept. Regenerate from Profile settings to compare a new profile
            with yours.
          </p>
        </DrawerSection>
      </DrawerMain>
    </Drawer>
  )
}
