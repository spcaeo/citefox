import { describe, expect, test } from 'vitest'
import { textboltTopicResults } from '@shared/fixtures/textbolt-topic'
import { targetHref } from '../../../drill/targets'
import { askHash, locationHash, parseHash, topicHash } from '../../../shell/routes'
import { drillInsight, drillTiles, topicDrills } from './drills'
import { formatPct } from './format'
import { hasAio, isCited, promptLabel, topDomains, urlPath } from './scoring'
import { summaryText } from './summary'

const results = textboltTopicResults()
const drills = topicDrills(results, 'proj-1')

describe('topic drills', () => {
  test('each KPI drill lists exactly the rows its number counts', () => {
    const { questions, keywords } = results.goals
    expect(drills.cited('question').rows).toHaveLength(questions.cited)
    expect(drills.aio('question').rows).toHaveLength(questions.withAio)
    expect(drills.noAio('question').rows).toHaveLength(questions.noAio)
    expect(drills.failed('question').rows).toHaveLength(questions.failed)
    expect(drills.named('keyword').rows).toHaveLength(keywords.named)
    expect(drills.all('question').rows).toHaveLength(questions.prompts)
  })

  test('match-state drills match the to-do groups, one kind at a time', () => {
    const kindOf = new Map(results.rows.map((row) => [row.promptId, row.kind]))
    for (const group of results.todo) {
      const drill = drills.state(group.state)
      expect(drill.id).toBe(`state:${group.state}`)
      const questions = group.promptIds.filter((id) => kindOf.get(id) === 'question')
      expect(drill.rows.map((row) => row.promptId).sort()).toEqual([...questions].sort())
    }
  })

  test('stage drills follow the stage ids', () => {
    for (const stage of results.byStage) {
      const drill = drills.ids(`stage:${stage.stage}:cited`, 'x', 'y', stage.citedIds)
      expect(drill.rows).toHaveLength(stage.cited)
    }
  })

  test('a cited drill uses the cited view with position tiles', () => {
    const cited = drills.cited('question')
    expect(cited.view).toBe('cited')
    expect(cited.projectId).toBe('proj-1')
    expect(cited.tiles.map((tile) => tile.label)).toEqual([
      'Right page',
      'Other own page',
      'Avg position',
      'Stages'
    ])
    const right = Number(cited.tiles[0]?.value)
    const other = Number(cited.tiles[1]?.value)
    expect(right + other).toBe(results.goals.questions.cited)
  })

  test('a to-do drill adds up cited, not cited and no overview', () => {
    const rows = results.rows.filter((row) => row.kind === 'question')
    const tiles = drillTiles(rows, 'todo')
    const sum = tiles.slice(0, 3).reduce((total, tile) => total + Number(tile.value), 0)
    expect(sum).toBe(rows.length)
  })

  test('drill rows carry the page cited, or the target when not cited', () => {
    for (const row of drills.all('question').rows) {
      const source = results.rows.find((item) => item.promptId === row.promptId)
      if (!source) throw new Error('missing row')
      const url = isCited(source) ? source.citedOwnUrl : source.targetUrl
      expect(row.page).toBe(urlPath(url))
      expect(row.label).toBe(promptLabel(source))
      expect(row.aio).toBe(hasAio(source))
    }
  })

  test('the insight names the most frequent domain only when it repeats', () => {
    const rows = results.rows.filter(
      (row) => row.kind === 'question' && hasAio(row) && !isCited(row)
    )
    const top = topDomains(rows, 1)[0]
    const line = drillInsight(rows) ?? ''
    if (top && top.count >= 2)
      expect(line).toContain(`${top.domain} is cited instead in ${top.count}`)
    expect(drillInsight([])).toBeNull()
  })
})

describe('topic summary line', () => {
  test('splits the saved line at its lead', () => {
    const line = summaryText(results)
    expect(line?.lead).toBe('Since Oct 5:')
    expect(line?.text.startsWith('4 more cited')).toBe(true)
  })

  test('builds a line from the summary inputs without a saved one', () => {
    const line = summaryText({ ...results, savedSummary: null })
    expect(line?.lead.startsWith('Since ')).toBe(true)
    expect(line?.text.length).toBeGreaterThan(0)
  })
})

describe('labels', () => {
  test('question labels, paths and percents', () => {
    expect(promptLabel({ kind: 'question', number: 6 })).toBe('Q6')
    expect(promptLabel({ kind: 'keyword', number: 12 })).toBe('K12')
    expect(urlPath('https://textbolt.com/use-cases/it-alerts/')).toBe('/use-cases/it-alerts/')
    expect(urlPath(null)).toBeNull()
    expect(formatPct(null)).toBe('—')
    expect(formatPct(42)).toBe('42%')
  })
})

describe('topic routes', () => {
  test('topicHash and parseHash round-trip', () => {
    const hash = topicHash('topic-1', {
      tab: 'grid',
      marketId: 'mkt-ca',
      runId: 'run-2',
      filter: 'target:p-1'
    })
    expect(hash).toBe('#/topics/topic-1?view=grid&market=mkt-ca&run=run-2&filter=target%3Ap-1')
    const location = parseHash(hash)
    expect(location).toEqual({
      kind: 'topic',
      pageId: 'topic-1',
      tab: 'grid',
      marketId: 'mkt-ca',
      runId: 'run-2',
      filter: 'target:p-1'
    })
    expect(locationHash(location)).toBe(hash)
  })

  test('Tree is the default view and stays off the hash; old tab links map to a view', () => {
    expect(topicHash('t')).toBe('#/topics/t')
    expect(parseHash('#/topics/t?view=nope')).toEqual({ kind: 'topic', pageId: 't' })
    expect(parseHash('#/topics/t?tab=stage')).toEqual({ kind: 'topic', pageId: 't', tab: 'grid' })
    expect(parseHash('#/topics/t?tab=todo')).toEqual({ kind: 'topic', pageId: 't', tab: 'tree' })
    expect(parseHash('#/topics/t?view=pages')).toEqual({ kind: 'topic', pageId: 't', tab: 'pages' })
  })

  test('askHash keeps its scope on the ask route', () => {
    const hash = askHash({ pageId: 't', marketId: 'm', question: 'Who wins Compare?' })
    expect(parseHash(hash)).toEqual({
      kind: 'section',
      section: 'ask',
      params: { page: 't', market: 'm', q: 'Who wins Compare?' }
    })
    expect(askHash()).toBe('#/ask')
    expect(parseHash('#/ask')).toEqual({ kind: 'section', section: 'ask' })
  })

  test('a topic drill target opens the topic, in its project when named', () => {
    expect(targetHref({ kind: 'topic', topicId: 't', filter: 'state:no_page' })).toBe(
      '#/topics/t?filter=state%3Ano_page'
    )
    expect(targetHref({ kind: 'topic', topicId: 't', runId: 'r', projectId: 'p2' })).toBe(
      '#/p/p2/topics/t?run=r'
    )
  })
})
