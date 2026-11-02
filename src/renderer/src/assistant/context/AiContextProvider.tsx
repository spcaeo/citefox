import { useLayoutEffect, type JSX, type ReactNode } from 'react'
import { useDrawerStack } from '../../shell/drawers'
import type { ShellLocation } from '../../shell/routes'
import { aiBaseFor } from './base'
import { setAiBase } from './store'

/**
 * Puts the route part of the AI context in the registry: the screen, its
 * crumbs, the ids on the route and the visible filters. The shell renders it
 * once, around everything that can call `useAiContext`.
 */
export function AiContextProvider({
  location,
  projectId,
  projectName,
  crumbs,
  pageName = null,
  children
}: {
  location: ShellLocation
  projectId: string | null
  projectName: string | null
  crumbs: readonly { label: string }[]
  /** The breadcrumb's page or topic title (the chip uses the same words). */
  pageName?: string | null
  children: ReactNode
}): JSX.Element {
  const { hash } = useDrawerStack()
  const base = aiBaseFor({ location, hash, projectId, projectName, crumbs, pageName })
  const key = JSON.stringify(base)

  useLayoutEffect(() => {
    setAiBase(JSON.parse(key) as typeof base)
  }, [key])

  useLayoutEffect(() => () => setAiBase(null), [])

  return <>{children}</>
}
