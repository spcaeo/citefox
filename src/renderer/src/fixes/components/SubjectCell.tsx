import type { JSX } from 'react'
import type { FixSubject } from '@shared/ipc'
import { Chip, UrlText } from '../../ui'
import { pathOf } from '../model'

/** The page (its path, with copy and open icons) or the topic a row is for. */
export function SubjectCell({ subject }: { subject: FixSubject | undefined }): JSX.Element {
  if (subject === undefined) return <span className="faint">Removed page</span>
  if (subject.kind === 'topic' || subject.url === null) {
    return (
      <span className="fxp-subject">
        <Chip size="sm">Topic</Chip>
        <span className="fxp-subject-name">{subject.label}</span>
      </span>
    )
  }
  return (
    <span className="fxp-subject" title={subject.label}>
      <UrlText className="fxp-subject-name" url={subject.url} label={pathOf(subject.url)} />
    </span>
  )
}
