import { useMemo, useState, type JSX } from 'react'
import { DrillNumber } from '../../drill/DrillNumber'
import { resultsDrill, resultsScope } from '../../drill/fromResults'
import { TEXTBOLT_MARKETS, TEXTBOLT_PAGE_ID, textboltResults } from '../../m3/fixtures'
import { Chip, GoalBar, KpiStrip, KpiTile, Stepper, TabPanel, Tabs } from '../../ui'
import { GallerySection, Specimen } from './GallerySection'

const STEPS = [
  { id: 'seed', label: 'Seed' },
  { id: 'profile', label: 'Buyer profile' },
  { id: 'questions', label: 'Questions' },
  { id: 'keywords', label: 'Keywords' },
  { id: 'pages', label: 'Pages' },
  { id: 'estimate', label: 'Estimate' }
]

type TabId = 'todo' | 'stage' | 'keywords' | 'progress'

/** KPI tiles (one with a live DrillNumber), goal bars, tabs and the wizard stepper. */
export function DataSection(): JSX.Element {
  const [tab, setTab] = useState<TabId>('todo')
  const [step, setStep] = useState('keywords')
  const drill = useMemo(() => {
    const results = textboltResults()
    const scope = resultsScope(results, {
      pageId: TEXTBOLT_PAGE_ID,
      market: TEXTBOLT_MARKETS[0],
      runId: 'run-9'
    })
    return resultsDrill(results, 'kpi:aio', scope)
  }, [])

  return (
    <GallerySection
      id="data"
      title="Data"
      intro="Every number opens the rows behind it. Dotted underline means drillable. Results: KPI row of equal tiles, then tabs."
    >
      <KpiStrip className="gl-span-12 gl-kpis">
        <KpiTile
          label="Buyer questions cited"
          value="42%"
          trend={{ direction: 'up', text: '+3 since Sep 28' }}
          goal={{ value: 42, band: { lo: 50, hi: 70 } }}
          sub="11 of 26 · goal 50–70%"
        />
        <KpiTile
          label="Keywords cited"
          value="25%"
          chip={<Chip tone="ok">In band</Chip>}
          goal={{ value: 25, band: { lo: 25, hi: 40 } }}
          sub="19 of 77 · goal 25–40% · named in 27"
        />
        <KpiTile
          label="AI Overview shown"
          value={drill ? <DrillNumber drill={drill} /> : '26'}
          suffix="/ 28"
          sub="2 show none, left out of the goal"
        />
        <KpiTile
          label="To reach the band"
          value="+2"
          suffix="cited questions"
          sub="11 now · 13 needed"
        />
      </KpiStrip>
      <Specimen span={6}>
        <GoalBar label="Goal bar · buyer questions" value={42} band={{ lo: 50, hi: 70 }} />
        <GoalBar label="Goal bar · keywords" value={25} band={{ lo: 25, hi: 40 }} />
      </Specimen>
      <Specimen title="Tabs with counts" span={6}>
        <Tabs<TabId>
          label="Topic results"
          panelId="gl-tabs"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'todo', label: 'To-do', count: 17 },
            { id: 'stage', label: 'By stage', count: 6 },
            { id: 'keywords', label: 'Keywords', count: 118 },
            { id: 'progress', label: 'Progress', count: '4 checks' }
          ]}
        />
        <TabPanel panelId="gl-tabs" id={tab}>
          <p className="gl-help gl-under">Showing the {tab} tab. Arrow keys move between tabs.</p>
        </TabPanel>
      </Specimen>
      <Specimen title="Wizard stepper" span={12}>
        <Stepper label="New topic steps" steps={STEPS} current={step} onStep={setStep} />
      </Specimen>
    </GallerySection>
  )
}
