import { lazy, Suspense, type JSX } from 'react'
import { CompetitorsScreen } from '../competitors'
import { FixesScreen } from '../fixes'
import { ProjectHistoryScreen } from '../history/project'
import { OverviewScreen } from '../overview'
import { QuestionsScreen } from '../questions'
import { SectionFrame } from './SectionFrame'

/*
 * The AI visibility screens the shell mounts, one function per section. The
 * key restarts each screen per project. Overview and Questions draw their own
 * header; Competitors and Fixes draw the standard one themselves (their green
 * button needs the screen), and they and Check history open with a lead line
 * under it.
 */

export function OverviewSection({ projectId }: { projectId: string }): JSX.Element {
  return <OverviewScreen key={projectId} projectId={projectId} />
}

export function QuestionsSection({ projectId }: { projectId: string }): JSX.Element {
  return <QuestionsScreen key={projectId} projectId={projectId} />
}

/** Topics (`#/topics`): every topic with its goal, and the topic suggestions. */
export function TopicsSection({ projectId }: { projectId: string }): JSX.Element {
  return (
    <Suspense fallback={<p role="status">Loading topics…</p>}>
      <TopicsScreen key={projectId} projectId={projectId} />
    </Suspense>
  )
}

/** Competitors draws its standard header itself: Add competitor and its ⋯ need the screen. */
export function CompetitorsSection({ projectId }: { projectId: string }): JSX.Element {
  return <CompetitorsScreen key={projectId} projectId={projectId} />
}

/** Fixes draws its standard header itself: Log a fix needs the screen's page filter. */
export function FixesSection({ projectId }: { projectId: string }): JSX.Element {
  return <FixesScreen key={projectId} projectId={projectId} />
}

/**
 * Check history across the project: one row per check of every page and topic.
 * Each page's History tab keeps that page's full story (notes, fixes, page reads).
 */
export function HistorySection({ projectId }: { projectId: string }): JSX.Element {
  return (
    <SectionFrame title="Check history">
      <ProjectHistoryScreen key={projectId} projectId={projectId} />
    </SectionFrame>
  )
}

const TopicsScreen = lazy(() =>
  import('../topics/list').then((module) => ({ default: module.TopicsScreen }))
)
