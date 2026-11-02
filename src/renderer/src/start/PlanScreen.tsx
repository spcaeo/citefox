import { useEffect, useMemo, useState, type JSX } from 'react'
import { DEFAULT_INTERVAL_DAYS, intervalLabel } from '@shared/domain'
import type { SiteStartPage, SiteStartPlan } from '@shared/ipc'
import { defaultTargetUrls, estimateFirstCheck, searchRangeText } from '@shared/site-start'
import { errorText } from '../components/errorText'
import { HeaderActions } from '../components/HeaderActions'
import { navigateHash, replaceHash, sectionHash, startHash } from '../shell/routes'
import {
  Button,
  Chip,
  ListGrid,
  Panel,
  SectionHead,
  UrlText,
  type ListColumn,
  type MenuItem
} from '../ui'
import { UiIcon } from '../ui/UiIcon'
import type { StartClient } from './client'
import { EditableRows } from './edit/EditableRows'
import { PageAdder } from './edit/PageAdder'
import { useStartEdits } from './edit/useStartEdits'
import { targetsFromHash, targetsHash } from './model'
import { ShareBar, StartFooter, StartFrame } from './StartFrame'
import type { StartProject } from './types'
import './found.css'

const STAGE_LABEL: Readonly<Record<string, string>> = {
  problem: 'Problem',
  options: 'Options',
  doubts: 'Doubts',
  fit: 'Fit',
  compare: 'Compare',
  decide: 'Decide'
}

interface PageRow {
  page: SiteStartPage
  index: number
}

/**
 * "Your starting plan" (Mockups/v2/journey-a A4): the drafted topic and the
 * pages its questions should point at (a list grid, the recommended ones
 * ticked), what the first check costs against the searches left, one question
 * CiteFox will ask, and the one primary: Start first check, the only step that
 * searches. The ticked pages live in the URL (`#/start/plan?t=0.1.2`).
 */
export function PlanScreen({
  client,
  project
}: {
  client: StartClient
  project: StartProject
}): JSX.Element {
  const [plan, setPlan] = useState<SiteStartPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [allQuestions, setAllQuestions] = useState(false)
  const [hash, setHash] = useState(() => window.location.hash)
  const [addingPage, setAddingPage] = useState(false)
  const edits = useStartEdits({ client, projectId: project.id, onPlan: setPlan })

  useEffect(() => {
    const onHash = (): void => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    let cancelled = false
    client.get({ projectId: project.id }).then(
      (loaded) => {
        if (cancelled) return
        if (loaded === null) navigateHash(startHash('setup'))
        else if (loaded.topicId !== null) navigateHash(startHash('check'))
        else setPlan(loaded)
      },
      (cause: unknown) => {
        if (!cancelled) setError(errorText(cause, 'Could not load the plan.'))
      }
    )
    return () => {
      cancelled = true
    }
  }, [client, project.id])

  const picked = useMemo(() => {
    if (plan === null) return new Set<number>()
    const fromUrl = targetsFromHash(hash, plan.pages.length)
    if (fromUrl !== null) return new Set(fromUrl)
    const defaults = new Set(defaultTargetUrls(plan))
    return new Set(plan.pages.flatMap((page, index) => (defaults.has(page.url) ? [index] : [])))
  }, [plan, hash])

  function setPicked(next: Set<number>): void {
    replaceHash(targetsHash([...next]))
  }

  function toggle(index: number): void {
    const next = new Set(picked)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    setPicked(next)
  }

  /** Keeps the ticks on the same pages after the list changes. */
  function repick(next: SiteStartPlan, urls: ReadonlySet<string>): void {
    setPicked(new Set(next.pages.flatMap((page, index) => (urls.has(page.url) ? [index] : []))))
  }

  function pickedUrls(): Set<string> {
    return new Set(plan?.pages.filter((_, index) => picked.has(index)).map((page) => page.url))
  }

  async function addPage(url: string): Promise<void> {
    const urls = pickedUrls()
    const result = await edits.send({ kind: 'page', op: 'add', url })
    if (result?.plan) {
      const added = result.plan.pages.find((page) => page.url === url) ?? result.plan.pages.at(-1)
      if (added) urls.add(added.url)
      repick(result.plan, urls)
    }
  }

  async function removePage(url: string): Promise<void> {
    const urls = pickedUrls()
    urls.delete(url)
    const result = await edits.send({ kind: 'page', op: 'remove', url })
    if (result?.plan) repick(result.plan, urls)
  }

  const questions = plan?.questions.length ?? 0
  const estimate = plan ? estimateFirstCheck(plan.budget, questions) : null
  const canStart = plan !== null && plan.topic !== null && questions > 0 && estimate?.fits !== false

  async function start(): Promise<void> {
    if (plan === null) return
    setBusy(true)
    setError(null)
    try {
      await client.begin({
        projectId: project.id,
        targetUrls: plan.pages.filter((_, index) => picked.has(index)).map((page) => page.url)
      })
      navigateHash(startHash('check'))
    } catch (cause) {
      setError(errorText(cause, 'Could not start the first check.'))
      setBusy(false)
    }
  }

  const footer = (
    <StartFooter
      onBack={() => navigateHash(startHash())}
      note={estimate ? `${searchRangeText(estimate)} · about 2 min · results open here` : null}
    >
      <Button
        variant="primary"
        icon="arrow-right"
        busy={busy}
        disabled={!canStart || busy}
        onClick={() => void start()}
      >
        Start first check
      </Button>
    </StartFooter>
  )

  if (plan === null) {
    return (
      <StartFrame
        step="plan"
        projectName={project.name}
        domain={project.domain}
        searchesLeft={null}
        title="Your starting plan"
        footer={footer}
      >
        {error ? (
          <p className="sf-error" role="alert">
            {error}
          </p>
        ) : (
          <p role="status">Loading the plan…</p>
        )}
      </StartFrame>
    )
  }

  const first = plan.questions[0]
  const left = plan.budget.searchesLeft
  const share =
    estimate && left !== null && left > 0
      ? Math.min(100, Math.round((estimate.maxSearches / left) * 100))
      : 0
  const rows: PageRow[] = plan.pages.map((page, index) => ({ page, index }))
  const site = `https://${plan.domain}`

  const columns: ListColumn<PageRow>[] = [
    {
      id: 'target',
      label: 'Target',
      hideLabel: true,
      width: 44,
      render: (row) => (
        <input
          type="checkbox"
          className="pl-check"
          checked={picked.has(row.index)}
          aria-label={`Target ${row.page.path}`}
          onChange={() => toggle(row.index)}
        />
      )
    },
    {
      id: 'page',
      label: 'Target page',
      width: 'fill',
      minWidth: 200,
      render: (row) => <UrlText url={row.page.url} label={row.page.path} site={site} />
    },
    {
      id: 'section',
      label: 'Section',
      width: 120,
      render: (row) => <span className="sf-faint">{row.page.section}</span>
    },
    {
      id: 'why',
      label: 'Why it’s picked',
      width: 240,
      render: (row) => (
        <span className="pl-why" title={row.page.reason}>
          {row.page.reason}
          {row.page.questionCount > 0 ? (
            <span className="sf-faint num">
              {' '}
              · answers {row.page.questionCount}{' '}
              {row.page.questionCount === 1 ? 'question' : 'questions'}
            </span>
          ) : null}
        </span>
      )
    }
  ]

  function menuFor(row: PageRow): MenuItem[] {
    const on = picked.has(row.index)
    return [
      {
        id: 'toggle',
        label: on ? 'Untick as a target' : 'Tick as a target',
        icon: on ? 'x' : 'check',
        onSelect: () => toggle(row.index)
      },
      {
        id: 'remove',
        label: 'Remove from the plan',
        icon: 'trash',
        tone: 'danger',
        onSelect: () => void removePage(row.page.url)
      },
      {
        id: 'evidence',
        label: row.page.evidence,
        icon: 'bulb',
        disabled: true,
        onSelect: () => undefined
      }
    ]
  }

  return (
    <StartFrame
      step="plan"
      projectName={project.name}
      domain={project.domain}
      searchesLeft={left}
      title="Your starting plan"
      subtitle={
        plan.topic
          ? `One topic, ${picked.size} ${picked.size === 1 ? 'page' : 'pages'}. Change anything, then start the first check.`
          : 'Pick a topic first: CiteFox could not draft one.'
      }
      footer={footer}
    >
      {error ? (
        <p className="sf-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="ui-layout-main-rail">
        <section className="sf-section" aria-labelledby="pl-what">
          <SectionHead
            id="pl-what"
            title="What to track"
            description={`${picked.size} of ${plan.pages.length} pages selected`}
            actions={
              <>
                <Button size="sm" variant="text" icon="plus" onClick={() => setAddingPage(true)}>
                  Add a page
                </Button>
                <HeaderActions
                  moreLabel="What to track actions"
                  more={[
                    {
                      id: 'pl-recommended',
                      label: 'Use recommended',
                      icon: 'check',
                      onSelect: () => {
                        const defaults = new Set(defaultTargetUrls(plan))
                        setPicked(
                          new Set(
                            plan.pages.flatMap((page, index) =>
                              defaults.has(page.url) ? [index] : []
                            )
                          )
                        )
                      }
                    }
                  ]}
                />
              </>
            }
          />
          <Panel padding={16} label="Topic" tone="inset">
            {plan.topic ? (
              <div className="pl-topic">
                <span className="pl-topic-icon" aria-hidden="true">
                  <UiIcon name="target" />
                </span>
                <div className="pl-topic-text">
                  <p className="pl-topic-name">{plan.topic.name}</p>
                  <p className="pl-topic-meta">
                    Topic · {plan.topic.questionCount} buyer questions · {plan.topic.stageCount}{' '}
                    journey stages
                  </p>
                </div>
                <Chip size="sm" tone="ok">
                  Recommended
                </Chip>
              </div>
            ) : (
              <p className="pl-topic-meta">
                {plan.message ?? 'No topic yet.'}{' '}
                <a className="sf-link" href={sectionHash('add')}>
                  Start a topic yourself
                </a>
              </p>
            )}
          </Panel>
          {addingPage ? (
            <Panel padding={16} label="Add a page to the plan">
              <PageAdder
                client={client}
                projectId={project.id}
                domain={project.domain}
                onAdd={(url) => {
                  setAddingPage(false)
                  void addPage(url)
                }}
                onCancel={() => setAddingPage(false)}
              />
            </Panel>
          ) : null}
          <ListGrid
            label="Target pages"
            noun={['page', 'pages']}
            rows={rows}
            rowKey={(row) => row.page.url}
            rowLabel={(row) => row.page.path}
            columns={columns}
            rowMenu={menuFor}
            pageSize="all"
            summary={() => `${picked.size} ticked · target pages don’t add searches`}
            empty={<p className="pl-empty sf-faint">No pages picked yet. Add one above.</p>}
          />
        </section>
        <div className="sf-col">
          <Panel
            title="This check"
            padding={20}
            actions={
              estimate?.fits === false ? (
                <Chip size="sm" tone="warn">
                  Over what’s left
                </Chip>
              ) : estimate?.fits === true ? (
                <Chip size="sm" tone="ok">
                  Within what’s left
                </Chip>
              ) : null
            }
          >
            <p className="pl-big">
              <span>
                <strong className="num">
                  {estimate?.minSearches.toLocaleString('en-US') ?? 0}
                </strong>{' '}
                {estimate && estimate.maxSearches !== estimate.minSearches
                  ? `to ${estimate.maxSearches} searches`
                  : 'searches'}
              </span>
              <span className="sf-faint num">
                {left === null ? 'allowance unknown' : `of ${left.toLocaleString('en-US')} left`}
              </span>
            </p>
            <ShareBar percent={share} />
            <dl className="sf-rows">
              <div>
                <dt>Questions</dt>
                <dd className="num">{questions}</dd>
              </div>
              <div>
                <dt>Takes</dt>
                <dd>about 2 min</dd>
              </div>
              <div>
                <dt>Repeats</dt>
                <dd>{intervalLabel(DEFAULT_INTERVAL_DAYS).toLowerCase()}</dd>
              </div>
              {estimate?.leftAfter != null ? (
                <div>
                  <dt>After this check</dt>
                  <dd className="num">about {estimate.leftAfter.toLocaleString('en-US')} left</dd>
                </div>
              ) : null}
            </dl>
            {estimate?.fits === false ? (
              <p className="pl-warn" role="alert">
                <UiIcon name="warning" size={16} />
                This check needs up to {estimate.maxSearches} searches and{' '}
                {left?.toLocaleString('en-US')} are left this month. Add searches in Connections or
                wait for the allowance to renew.
              </p>
            ) : null}
          </Panel>
          {first ? (
            <Panel
              title="A question we’ll ask Google"
              padding={0}
              className="sf-flush"
              actions={
                first.stage ? (
                  <Chip size="sm">{STAGE_LABEL[first.stage] ?? first.stage}</Chip>
                ) : null
              }
            >
              <p className="pl-quote">“{first.text}”</p>
              <EditableRows
                label="Questions we’ll ask"
                noun="question"
                rows={plan.questions
                  .map((question, index) => ({
                    id: question.id,
                    text: question.text,
                    lead: `Q${index + 1}`
                  }))
                  .slice(allQuestions ? 0 : 1, allQuestions ? undefined : 3)}
                onEdit={(id, text) => void edits.send({ kind: 'question', op: 'edit', id, text })}
                onRemove={(id) => void edits.send({ kind: 'question', op: 'remove', id })}
                onAdd={(text) => void edits.send({ kind: 'question', op: 'add', text })}
              />
              <div className="sf-panel-foot sf-flush-foot">
                <span>Q1 of {questions} · written from your buyer profile</span>
                {questions > 3 ? (
                  <Button
                    size="sm"
                    variant="text"
                    aria-expanded={allQuestions}
                    onClick={() => setAllQuestions((current) => !current)}
                  >
                    {allQuestions ? 'Show fewer' : `See all ${questions}`}
                  </Button>
                ) : null}
              </div>
            </Panel>
          ) : null}
        </div>
      </div>
      {edits.error ? (
        <p className="sf-error" role="alert">
          {edits.error}
        </p>
      ) : null}
      {edits.toast}
    </StartFrame>
  )
}
