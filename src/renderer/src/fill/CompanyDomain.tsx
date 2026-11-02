import { useState, type JSX } from 'react'
import type { CompanySuggestion } from '@shared/ipc'
import { Button, Chip, UrlText } from '../ui'
import { typedHostname, type CheckCompanyDomain } from './domain'

const LOOKUP_TIP =
  'Not on your site: looked up and checked. The domain resolves and names the brand.'
const TYPED_TIP = 'Typed by you and checked: the domain resolves.'
/** A web-search domain needs no chip (the sources say where it came from), only a tooltip. */
const SEARCH_TIP = 'Found by web search and checked: it resolves and names the brand.'

/**
 * The domain part of a company row (batch 2 row 3): the domain with copy/open tools and,
 * when it was not seen on the site, a subtle "found by lookup" or "added by you" tag.
 * An unknown domain says so; with `onCheck`, the user can type it (validated as a
 * hostname, then DNS-checked) and `onSaved` fills it in.
 */
export function CompanyDomain({
  item,
  showUnknown,
  onCheck,
  onSaved,
  icon = true
}: {
  item: CompanySuggestion
  showUnknown: boolean
  /** The site's icon before the domain; off where the row already shows it by the name. */
  icon?: boolean
  onCheck?: CheckCompanyDomain
  onSaved: (domain: string) => void
}): JSX.Element | null {
  if (item.domain !== null) {
    const tag =
      item.domainSource === 'lookup'
        ? { text: 'found by lookup', tip: LOOKUP_TIP }
        : item.domainSource === 'typed'
          ? { text: 'added by you', tip: TYPED_TIP }
          : null
    return (
      <>
        <span
          className="fill-domain"
          title={
            item.domainSource === 'site'
              ? 'Seen on your site'
              : item.domainSource === 'search'
                ? SEARCH_TIP
                : undefined
          }
        >
          <UrlText domain={item.domain} icon={icon} />
        </span>
        {tag ? (
          <span className="fill-domain-tag" title={tag.tip}>
            <Chip size="sm" tone="info" label="Domain">
              {tag.text}
            </Chip>
          </span>
        ) : null}
      </>
    )
  }
  if (!showUnknown && !item.checkDomain) return null
  return (
    <>
      <span className="fill-unknown">
        {item.checkDomain ? 'Domain unknown · check it' : 'Domain unknown'}
      </span>
      {onCheck ? <DomainForm name={item.name} onCheck={onCheck} onSaved={onSaved} /> : null}
    </>
  )
}

function DomainForm({
  name,
  onCheck,
  onSaved
}: {
  name: string
  onCheck: CheckCompanyDomain
  onSaved: (domain: string) => void
}): JSX.Element {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(): Promise<void> {
    const host = typedHostname(value)
    if (host === null) {
      setError('Enter a domain such as example.com.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await onCheck({ domain: host })
      if (result.ok && result.domain !== null) onSaved(result.domain)
      else setError(result.message)
    } catch {
      setError('Could not check that domain. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    // Not a <form>: it sits inside the onboarding form, whose submit would continue.
    <span className="fill-domain-form" role="group" aria-label={`Type the domain for ${name}`}>
      <input
        className="ui-input ui-input-sm mono"
        type="text"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        placeholder="example.com"
        aria-label={`Domain for ${name}`}
        aria-invalid={error !== null}
        value={value}
        onChange={(event) => {
          setValue(event.target.value)
          setError(null)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          event.stopPropagation()
          void save()
        }}
      />
      <Button size="sm" busy={busy} disabled={!value.trim()} onClick={() => void save()}>
        Save
      </Button>
      {error ? (
        <span className="fill-domain-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  )
}
