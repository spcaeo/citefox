import type { JSX, ReactNode } from 'react'
import { Icon } from '../components/Icon'

export function AiTag({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span className="ps-ai-tag">
      <Icon name="spark" />
      {children}
    </span>
  )
}
