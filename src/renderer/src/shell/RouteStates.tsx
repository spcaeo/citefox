import { useEffect, type JSX } from 'react'
import { LinkButton } from '../ui'
import { landingHash, replaceHash, sectionHash } from './routes'
import { SectionFrame } from './SectionFrame'

/** A page route opened with no project to look it up in. */
export function NoProject({
  message = 'There is no project yet.'
}: {
  message?: string
}): JSX.Element {
  return (
    <div className="card empty" role="status">
      <p>{message} Create a project to start tracking its pages.</p>
      <p>
        <LinkButton size="sm" variant="primary" href={sectionHash('new-project')}>
          New project
        </LinkButton>{' '}
        <LinkButton size="sm" href={sectionHash('projects')}>
          Projects
        </LinkButton>
      </p>
    </div>
  )
}

/** The page id in the address is not one of this project's pages. */
export function PageMissing(): JSX.Element {
  return (
    <div className="card empty" role="status">
      <p>That page is not in this project.</p>
      <p>
        <LinkButton size="sm" href={sectionHash('pages')}>
          Go to All pages
        </LinkButton>
      </p>
    </div>
  )
}

/**
 * A link that cannot open (`#/unavailable`): a path CiteFox does not have, or
 * (`#/unavailable/project`) a project this copy cannot open, such as a
 * deleted one or a link copied from another computer.
 */
export function Unavailable({ reason }: { reason: string | undefined }): JSX.Element {
  const project = reason === 'project'
  return (
    <SectionFrame
      title={project ? 'Not available to you' : 'This page isn’t available'}
      subtitle={
        project
          ? 'That project is not on this computer.'
          : 'No screen at this address. The link may be old.'
      }
    >
      <p>
        {project ? (
          <LinkButton size="sm" href={sectionHash('projects')}>
            Go to Projects
          </LinkButton>
        ) : (
          <LinkButton size="sm" href={landingHash()}>
            Go to Summary
          </LinkButton>
        )}
      </p>
    </SectionFrame>
  )
}

/**
 * An old address of a setting that moved to its one home (`movedSettingsHash`):
 * it opens the new home in place, so Back skips the old address.
 */
export function MovedRedirect({ hash }: { hash: string }): JSX.Element {
  useEffect(() => {
    replaceHash(hash)
  }, [hash])
  return <p role="status">Opening…</p>
}
