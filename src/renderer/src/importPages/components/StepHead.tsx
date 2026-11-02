import type { JSX, ReactNode } from 'react'
import { SectionHead } from '../../ui'

/**
 * A section heading inside a wizard step: the shared SectionHead. The stepper
 * under the title carries the step numbers; `number` stays for callers and is
 * not shown. `id` labels the step's section.
 */
export function StepHead({
  id,
  title,
  aside,
  children
}: {
  number?: number
  id: string
  title: string
  aside?: ReactNode
  children?: ReactNode
}): JSX.Element {
  return <SectionHead id={id} title={title} description={children} actions={aside} />
}
