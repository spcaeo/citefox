import { useId, useState, type JSX } from 'react'
import type { BuyerProfile } from '@shared/domain'
import { TemplatePickerField } from '../../generate/TemplatePicker'
import type { TemplatesClient } from '../../templates/client'
import {
  Button,
  Drawer,
  DrawerField,
  DrawerFields,
  DrawerGrid,
  DrawerSection,
  ExpertOptions,
  Panel
} from '../../ui'
import { TemplateProvenance } from '../TemplateProvenance'
import {
  NAMED_PARTS,
  PART_LABEL,
  PROFILE_PARTS,
  draftOf,
  patchOf,
  type PartKey,
  type ProfilePatch,
  type ProfileRow
} from './model'

/** Add or edit one point, above the grid. */
export function PointEditor({
  editing,
  onSave,
  onCancel
}: {
  editing: { mode: 'add' } | { mode: 'edit'; row: ProfileRow }
  onSave: (part: PartKey, text: string, reason: string) => void
  onCancel: () => void
}): JSX.Element {
  const id = useId()
  const [part, setPart] = useState<PartKey>(editing.mode === 'edit' ? editing.row.part : 'triggers')
  const [text, setText] = useState(editing.mode === 'edit' ? editing.row.text : '')
  const [reason, setReason] = useState(editing.mode === 'edit' ? (editing.row.reason ?? '') : '')
  const named = NAMED_PARTS.has(part)
  return (
    <Panel title={editing.mode === 'add' ? 'Add a point' : 'Edit point'} titleAs="h3" padding={20}>
      <div className="au-editor">
        {editing.mode === 'add' ? (
          <label className="au-field" htmlFor={`${id}-part`}>
            <span>Section</span>
            <select
              id={`${id}-part`}
              className="ui-input"
              value={part}
              onChange={(event) => setPart(event.currentTarget.value as PartKey)}
            >
              {PROFILE_PARTS.filter((key) => key !== 'who').map((key) => (
                <option key={key} value={key}>
                  {PART_LABEL[key]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="au-field au-grow" htmlFor={`${id}-text`}>
          <span>{named ? 'Name' : 'Point'}</span>
          <textarea
            id={`${id}-text`}
            className="ui-input au-textarea"
            rows={2}
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
          />
        </label>
        {named ? (
          <label className="au-field au-grow" htmlFor={`${id}-reason`}>
            <span>Why</span>
            <input
              id={`${id}-reason`}
              className="ui-input"
              value={reason}
              onChange={(event) => setReason(event.currentTarget.value)}
            />
          </label>
        ) : null}
      </div>
      <div className="au-editor-foot">
        <Button
          size="sm"
          disabled={text.trim().length === 0}
          onClick={() => onSave(part, text, reason)}
        >
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <span className="au-note">Saved questions stay as they are until you rewrite them.</span>
      </div>
    </Panel>
  )
}

const HINTS: Readonly<Record<PartKey, string>> = {
  who: 'One or two sentences.',
  environment: 'One tool or place per line.',
  segments: 'One segment per line: name — reason',
  triggers: 'One trigger per line',
  values: 'One value per line',
  poorFit: 'One audience per line: name — reason'
}

/** Who they are and Poor fit take the full row; the other lists pair up. */
const WIDE: ReadonlySet<PartKey> = new Set(['who', 'poorFit'])

function draftsOf(profile: BuyerProfile): Record<PartKey, string> {
  const out = {} as Record<PartKey, string>
  for (const part of PROFILE_PARTS) out[part] = draftOf(profile, part)
  return out
}

/**
 * "Edit buyer profile" (`?drawer=au-edit`): every part as text, saved in one
 * change. Unsaved text asks before the drawer closes.
 */
export function EditProfileDrawer({
  profile,
  onSave,
  onClose
}: {
  profile: BuyerProfile
  /** Writes the patch; resolves false when the save failed (the screen says why). */
  onSave: (patch: ProfilePatch) => Promise<boolean>
  onClose: () => void
}): JSX.Element {
  const [initial] = useState(() => draftsOf(profile))
  const [drafts, setDrafts] = useState<Record<PartKey, string>>(initial)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const changed = PROFILE_PARTS.filter((part) => drafts[part] !== initial[part])

  async function save(): Promise<void> {
    const patch: ProfilePatch = {}
    for (const part of changed) Object.assign(patch, patchOf(part, drafts[part]))
    setBusy(true)
    setFailed(false)
    const ok = await onSave(patch)
    setBusy(false)
    if (ok) onClose()
    else setFailed(true)
  }

  return (
    <Drawer
      id="au-edit"
      title="Edit buyer profile"
      subtitle="Every part as text · saved in one change"
      dirty={changed.length > 0}
      busy={busy}
      closeDisabled={busy}
      onClose={onClose}
      testId="profile-edit-drawer"
      footer={{
        summary: failed
          ? 'Could not save the buyer profile. Try again.'
          : changed.length === 0
            ? 'No changes yet · saved questions stay as they are until you rewrite them'
            : `${changed.length} ${changed.length === 1 ? 'part' : 'parts'} changed · saved questions stay as they are until you rewrite them`,
        primary: {
          label: 'Save changes',
          busy,
          disabled: changed.length === 0,
          onClick: () => void save()
        }
      }}
    >
      <DrawerGrid>
        <DrawerSection
          title="Buyer profile"
          description="Each line is one point. CiteFox AI reads the profile when it writes questions."
        >
          <DrawerFields columns={2}>
            {PROFILE_PARTS.map((part) => (
              <DrawerField
                key={part}
                label={PART_LABEL[part]}
                hint={HINTS[part]}
                wide={WIDE.has(part)}
              >
                {({ id, describedBy }) => (
                  <textarea
                    id={id}
                    aria-describedby={describedBy}
                    className="ui-input au-textarea"
                    rows={part === 'who' ? 2 : 6}
                    value={drafts[part]}
                    disabled={busy}
                    {...(part === 'who' ? { 'data-autofocus': true } : {})}
                    onChange={(event) => {
                      const value = event.currentTarget.value
                      setDrafts((current) => ({ ...current, [part]: value }))
                    }}
                  />
                )}
              </DrawerField>
            ))}
          </DrawerFields>
        </DrawerSection>
      </DrawerGrid>
    </Drawer>
  )
}

/**
 * "Profile settings" (`?drawer=au-settings`): Regenerate, and the template it
 * writes with under Expert options. Off the main surface.
 */
export function ProfileSettingsDrawer({
  profile,
  templatesClient,
  templateId,
  onTemplate,
  error,
  onRegenerate,
  onClose
}: {
  profile: BuyerProfile | null
  templatesClient: TemplatesClient
  templateId: string
  onTemplate: (id: string) => void
  /** Why the last Regenerate failed. */
  error: string | null
  onRegenerate: () => Promise<void>
  onClose: () => void
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  return (
    <Drawer
      id="au-settings"
      title="Profile settings"
      subtitle="Buyer profile · how CiteFox AI writes it again"
      busy={busy}
      closeDisabled={busy}
      onClose={onClose}
      testId="profile-settings-drawer"
      footer={{
        summary: 'About 20 s on your AI plan · no searches',
        primary: {
          label: profile ? 'Regenerate' : 'Write it now',
          icon: 'refresh',
          busy,
          onClick: () => {
            setBusy(true)
            void onRegenerate().finally(() => setBusy(false))
          }
        }
      }}
    >
      <DrawerGrid>
        <DrawerSection title="This profile" span={6}>
          <p className="au-note">
            {profile ? (
              <>
                Written with{' '}
                <TemplateProvenance
                  templateId={profile.templateId}
                  templateName={profile.templateName}
                  templateHash={profile.templateHash}
                  edited={profile.templateUpdatedAt !== null}
                />
              </>
            ) : (
              'Not written yet.'
            )}
          </p>
        </DrawerSection>
        <DrawerSection
          title={profile ? 'Regenerate' : 'Write it now'}
          span={6}
          description={
            profile
              ? 'Shows CiteFox AI’s new profile next to yours. Nothing changes until you apply.'
              : 'CiteFox writes the profile from the page.'
          }
        >
          {error ? (
            <p className="ps-error" role="alert">
              {error}
            </p>
          ) : null}
          <p className="au-note">Saved questions stay as they are until you rewrite them.</p>
        </DrawerSection>
        <ExpertOptions summary="Template: the page's default unless you pick one">
          <TemplatePickerField
            client={templatesClient}
            kind="buyer_profile"
            value={templateId}
            onChange={onTemplate}
          />
        </ExpertOptions>
      </DrawerGrid>
    </Drawer>
  )
}
