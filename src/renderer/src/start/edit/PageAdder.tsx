import { useCallback, useId, useState, type JSX } from 'react'
import { addressOf } from '../../projects/addPageModel'
import { UrlCombobox } from '../../projects/UrlCombobox'
import '../../projects/AddPageScreen.css'
import { Button } from '../../ui'
import type { StartClient } from '../client'
import './edit.css'

/**
 * Add a page by path or own-domain URL, with the sitemap as suggestions.
 * Sends the full address; the caller turns it into a page add edit.
 */
export function PageAdder({
  client,
  projectId,
  domain,
  onAdd,
  onCancel
}: {
  client: StartClient
  projectId: string
  domain: string
  onAdd: (url: string) => void
  onCancel: () => void
}): JSX.Element {
  const id = useId()
  const [value, setValue] = useState('')
  const suggest = useCallback(
    (query: string) => client.suggestUrls({ projectId, query, limit: 8 }),
    [client, projectId]
  )
  const address = addressOf(value, domain)
  const valid = /^https?:\/\//iu.test(address)
  const submit = (): void => {
    if (valid) onAdd(address)
  }
  return (
    <form
      className="ed-page-add"
      aria-label="Add a page"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onCancel()
        }
      }}
    >
      <label className="sr-only" htmlFor={id}>
        Page to add
      </label>
      <UrlCombobox
        id={id}
        value={value}
        onChange={setValue}
        placeholder={`/pricing or a ${domain} address`}
        suggest={suggest}
      />
      <Button size="sm" disabled={!valid} onClick={submit}>
        Add
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  )
}
