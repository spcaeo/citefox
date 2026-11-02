import type { JSX } from 'react'
import { sourceLetter, sourceTint } from './model'

/**
 * A lettered circle where Google shows the site's favicon. The favicons are
 * remote gstatic images, which the renderer's CSP (`img-src 'self' data:`) blocks.
 */
export function SourceMark({ name }: { name: string }): JSX.Element {
  return (
    <span className={`aio-mark aio-mark-${sourceTint(name)}`} aria-hidden="true">
      {sourceLetter(name)}
    </span>
  )
}
