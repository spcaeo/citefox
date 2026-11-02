import { useCallback, useEffect, useId, useMemo, useState, type JSX } from 'react'
import {
  customTypeChoice,
  MAX_SITE_TYPE_NAME,
  PICKABLE_SITE_TYPES,
  SITE_TYPE_TONE_LABELS,
  SITE_TYPE_TONES,
  type CustomSiteType,
  type SiteTypeSettings,
  type SiteTypeTone
} from '@shared/site-overrides'
import { SITE_TYPE_LABELS } from '@shared/site-type'
import { pluralize } from '@shared/pluralize'
import { errorText } from '../components/errorText'
import { notifyChanged, useChangeVersion } from '../shell/changes'
import {
  Button,
  Chip,
  Confirm,
  Drawer,
  DrawerField,
  DrawerFields,
  DrawerMain,
  DrawerSection
} from '../ui'
import { takeSiteTypesDomain } from './model'
import { createSiteTypesSource, type SiteTypesSource } from './source'
import './siteTypes.css'

export interface SiteTypesDrawerProps {
  projectId: string
  /** `st.new=1`: opened from a Type menu's "+ New type…". */
  create: boolean
  onClose: () => void
  /** A new type for a site: the drawer closes handing its id back. */
  onCreated: (typeId: string) => void
  source?: SiteTypesSource
}

/**
 * Types of site (`?drawer=site-types`). The project's own types join the built-in
 * ones in every sources list's Type menu. Add one with a name and a colour; rename,
 * recolour or delete it here. Deleting a type puts the sites that had it back to
 * their automatic type.
 */
export function SiteTypesDrawer({
  projectId,
  create,
  onClose,
  onCreated,
  source
}: SiteTypesDrawerProps): JSX.Element {
  const client = useMemo(() => source ?? createSiteTypesSource(), [source])
  const [domain] = useState(takeSiteTypesDomain)
  const [settings, setSettings] = useState<SiteTypeSettings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [name, setName] = useState('')
  const [tone, setTone] = useState<SiteTypeTone>('info')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<CustomSiteType | null>(null)
  const changed = useChangeVersion('siteTypes')

  useEffect(() => {
    let live = true
    client['competitors:siteTypes']({ projectId }).then(
      (next) => {
        if (live) setSettings(next)
      },
      (cause: unknown) => {
        if (live) setLoadError(errorText(cause, 'Could not load the types of site.'))
      }
    )
    return () => {
      live = false
    }
  }, [client, projectId, attempt, changed])

  /** Runs one save; null when it failed (the footer says why). */
  const run = useCallback(
    async <T,>(action: () => Promise<T>, fallback: string): Promise<T | null> => {
      setBusy(true)
      setError(null)
      try {
        const value = await action()
        notifyChanged('siteTypes')
        return value
      } catch (cause) {
        setError(errorText(cause, fallback))
        return null
      } finally {
        setBusy(false)
      }
    },
    []
  )

  const nameError = name.trim().length === 0 ? 'Give the type a name.' : null

  async function add(): Promise<void> {
    setTried(true)
    if (nameError !== null) return
    const created = await run(
      () => client['competitors:saveSiteTypeDef']({ projectId, id: null, name, tone }),
      'Could not add the type.'
    )
    if (created === null) return
    if (domain !== null) {
      onCreated(created.id)
      return
    }
    setName('')
    setTried(false)
  }

  const used = (type: CustomSiteType): number =>
    settings?.overrides.filter((item) => item.type === customTypeChoice(type.id)).length ?? 0

  return (
    <Drawer
      id="site-types"
      title="Types of site"
      subtitle={
        domain !== null
          ? `A new type for ${domain}. It joins the Type menu on every sources list.`
          : 'Your own types join the Type menu on every sources list in this project.'
      }
      testId="site-types-drawer"
      dirty={name.trim().length > 0 && !busy}
      busy={busy}
      closeDisabled={busy}
      loading={settings === null && loadError === null}
      {...(loadError
        ? {
            error: {
              message: loadError,
              onRetry: () => {
                setLoadError(null)
                setAttempt((count) => count + 1)
              }
            }
          }
        : {})}
      onClose={onClose}
      footer={{
        summary: error ? (
          <span className="ui-drawer-error" role="alert">
            {error}
          </span>
        ) : undefined,
        cancel: 'Close',
        primary: {
          label: domain !== null ? `Add and use for ${domain}` : 'Add type',
          busy,
          disabled: busy || settings === null,
          onClick: () => void add()
        }
      }}
    >
      <DrawerMain>
        <DrawerSection title="New type">
          <DrawerFields>
            <DrawerField
              label="Name"
              hint="Such as Partner, Reseller or Industry body."
              error={tried ? nameError : null}
            >
              {(ids) => (
                <input
                  id={ids.id}
                  aria-describedby={ids.describedBy}
                  className="ui-input"
                  maxLength={MAX_SITE_TYPE_NAME}
                  value={name}
                  {...(create ? { 'data-autofocus': true } : {})}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void add()
                    }
                  }}
                />
              )}
            </DrawerField>
            <ToneField value={tone} onChange={setTone} preview={name.trim() || 'New type'} />
          </DrawerFields>
        </DrawerSection>
        <DrawerSection
          title="Your types"
          count={settings?.customTypes.length ?? 0}
          description={`Built in: ${PICKABLE_SITE_TYPES.map((type) => SITE_TYPE_LABELS[type]).join(', ')}.`}
        >
          {settings && settings.customTypes.length > 0 ? (
            <ul className="sty-list" aria-label="Your types of site">
              {settings.customTypes.map((type) => (
                <TypeRow
                  key={`${type.id}:${type.name}:${type.tone}`}
                  type={type}
                  used={used(type)}
                  busy={busy}
                  onSave={(next) =>
                    void run(
                      () =>
                        client['competitors:saveSiteTypeDef']({
                          projectId,
                          id: type.id,
                          name: next.name,
                          tone: next.tone
                        }),
                      'Could not save the type.'
                    )
                  }
                  onRemove={() => setRemoving(type)}
                />
              ))}
            </ul>
          ) : (
            <p className="ui-drawer-hint">No types of your own yet.</p>
          )}
        </DrawerSection>
      </DrawerMain>
      {removing ? (
        <Confirm
          title={`Delete “${removing.name}”?`}
          body={
            used(removing) > 0
              ? `${pluralize(used(removing), 'site')} that have it go back to their automatic type.`
              : 'No site has it yet.'
          }
          confirmLabel="Delete type"
          busy={busy}
          onCancel={() => setRemoving(null)}
          onConfirm={() =>
            void run(
              () => client['competitors:removeSiteTypeDef']({ projectId, id: removing.id }),
              'Could not delete the type.'
            ).then((done) => {
              if (done !== null) setRemoving(null)
            })
          }
        />
      ) : null}
    </Drawer>
  )
}

/** The chip colours as radio buttons, each drawn as the chip it gives. */
function ToneField({
  value,
  onChange,
  preview
}: {
  value: SiteTypeTone
  onChange: (tone: SiteTypeTone) => void
  preview: string
}): JSX.Element {
  const name = useId()
  return (
    <fieldset className="sty-tones">
      <legend className="sty-tones-label">Colour</legend>
      <div className="sty-tones-row">
        {SITE_TYPE_TONES.map((tone) => (
          <label key={tone} className="sty-tone">
            <input
              type="radio"
              className="sr-only"
              name={name}
              value={tone}
              checked={value === tone}
              onChange={() => onChange(tone)}
            />
            <Chip tone={tone} size="sm" dot>
              {SITE_TYPE_TONE_LABELS[tone]}
            </Chip>
          </label>
        ))}
      </div>
      <p className="sty-preview">
        Shows as{' '}
        <Chip tone={value} size="sm">
          {preview}
        </Chip>
      </p>
    </fieldset>
  )
}

/** One custom type: rename (Enter or leaving the field saves), colour, delete. */
function TypeRow({
  type,
  used,
  busy,
  onSave,
  onRemove
}: {
  type: CustomSiteType
  used: number
  busy: boolean
  onSave: (next: Pick<CustomSiteType, 'name' | 'tone'>) => void
  onRemove: () => void
}): JSX.Element {
  const [name, setName] = useState(type.name)
  const toneId = useId()
  const commit = (): void => {
    const next = name.replace(/\s+/gu, ' ').trim()
    if (next.length === 0) setName(type.name)
    else if (next !== type.name) onSave({ name: next, tone: type.tone })
  }
  return (
    <li className="sty-row">
      <Chip tone={type.tone} size="sm">
        {type.name}
      </Chip>
      <input
        className="ui-input ui-input-sm sty-row-name"
        aria-label={`Name of ${type.name}`}
        maxLength={MAX_SITE_TYPE_NAME}
        value={name}
        disabled={busy}
        onChange={(event) => setName(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          }
        }}
      />
      <label className="sr-only" htmlFor={toneId}>
        Colour of {type.name}
      </label>
      <select
        id={toneId}
        className="select sty-row-tone"
        value={type.tone}
        disabled={busy}
        onChange={(event) => onSave({ name: type.name, tone: event.target.value as SiteTypeTone })}
      >
        {SITE_TYPE_TONES.map((tone) => (
          <option key={tone} value={tone}>
            {SITE_TYPE_TONE_LABELS[tone]}
          </option>
        ))}
      </select>
      <span className="sty-row-used">
        {used > 0 ? `On ${pluralize(used, 'site')}` : 'Not used yet'}
      </span>
      <Button
        variant="text"
        size="sm"
        disabled={busy}
        aria-label={`Delete ${type.name}`}
        onClick={onRemove}
      >
        Delete
      </Button>
    </li>
  )
}
