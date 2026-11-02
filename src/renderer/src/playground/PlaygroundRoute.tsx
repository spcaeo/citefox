import { lazy, Suspense, type ComponentProps, type JSX } from 'react'
import { PlaygroundScreen } from './PlaygroundScreen'

/** The gallery ships only in dev and e2e builds; a release build drops the chunk. */
const GALLERY_ENABLED = import.meta.env.DEV || import.meta.env.VITE_CITEFOX_E2E_MOCKS === '1'

const GalleryScreen = GALLERY_ENABLED ? lazy(() => import('./gallery')) : null

/**
 * The Playground route. `#/playground/gallery` opens the v2 design system
 * gallery where it is enabled; every other focus id is the Playground.
 */
export function PlaygroundRoute(props: ComponentProps<typeof PlaygroundScreen>): JSX.Element {
  if (GalleryScreen && props.focusId === 'gallery') {
    return (
      <Suspense fallback={<p role="status">Loading the gallery…</p>}>
        <GalleryScreen projectId={props.projectId || null} />
      </Suspense>
    )
  }
  return <PlaygroundScreen {...props} />
}
