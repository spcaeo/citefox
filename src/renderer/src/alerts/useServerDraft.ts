import { useState } from 'react'

/** Keep a text draft aligned with the last saved value without an effect. */
export function useServerDraft(source: string): [string, (value: string) => void] {
  const [value, setValue] = useState(source)
  const [seen, setSeen] = useState(source)
  if (source !== seen) {
    setSeen(source)
    setValue(source)
  }
  return [value, setValue]
}
