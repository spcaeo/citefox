import { useState, type JSX } from 'react'
import { UiIcon } from '../ui'

export interface ProductChip {
  id: string
  name: string
}

/**
 * "Your products" (batch 2 row 5): one chip per product found on the site. Click a name
 * to rename it (Enter or leaving the field keeps it, Escape cancels); × removes the
 * product and hides its competitors. Only the label changes: nothing is searched again.
 */
export function ProductChips({
  products,
  onRename,
  onRemove
}: {
  products: readonly ProductChip[]
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
}): JSX.Element {
  const [editing, setEditing] = useState<string | null>(null)
  const [value, setValue] = useState('')

  function commit(id: string): void {
    const name = value.trim()
    if (name.length > 0) onRename(id, name)
    setEditing(null)
  }

  return (
    <ul className="fill-products" aria-label="Your products">
      {products.map((product) => (
        <li className="fill-product-chip" key={product.id}>
          {editing === product.id ? (
            <input
              className="fill-product-input"
              type="text"
              aria-label={`Rename product ${product.name}`}
              value={value}
              autoFocus
              onChange={(event) => setValue(event.target.value)}
              onBlur={() => commit(product.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  // Inside the onboarding form: Enter must not submit it.
                  event.preventDefault()
                  commit(product.id)
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  setEditing(null)
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="fill-product-name"
              title="Rename"
              aria-label={`Rename product ${product.name}`}
              onClick={() => {
                setValue(product.name)
                setEditing(product.id)
              }}
            >
              {product.name}
            </button>
          )}
          <button
            type="button"
            className="fill-product-x"
            aria-label={`Remove product ${product.name}`}
            onClick={() => onRemove(product.id)}
          >
            <UiIcon name="x" size={12} />
          </button>
        </li>
      ))}
    </ul>
  )
}
