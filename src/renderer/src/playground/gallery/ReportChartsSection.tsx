import { useState, type JSX, type ReactNode } from 'react'
import { historyLegendWords } from '@shared/charts'
import { SegmentedControl } from '../../ui'
import {
  BucketColumnsChart,
  FunnelChart,
  GainersLosersChart,
  HistoryStripChart,
  PairedBarsChart,
  PositionChart,
  RankedBarsChart,
  SplitBarChart
} from '../../ui/chart'
import { GallerySection } from './GallerySection'
import {
  BEFORE,
  BUCKETS,
  FUNNEL,
  HISTORY,
  MOVERS,
  NOT_CITED,
  NOW,
  PAIRED,
  POSITIONS,
  RANKED,
  SPLIT
} from './reportChartsData'

type BoardTheme = 'light' | 'dark' | 'sepia'

const THEMES = [
  { value: 'sepia', label: 'Sepia' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
] as const

function Card({
  title,
  sub,
  wide = false,
  children
}: {
  title: string
  sub: string
  wide?: boolean
  children: ReactNode
}): JSX.Element {
  return (
    <div className={`gl-card gl-rc-card${wide ? ' gl-rc-wide' : ''}`}>
      <div>
        <h3>{title}</h3>
        <p className="gl-help">{sub}</p>
      </div>
      {children}
    </div>
  )
}

/**
 * The report charts (src/shared/charts) with sample data, on a board that can
 * switch between the three themes. The downloaded report draws the same SVG.
 * Clicking a mark shows its drill id here (screens open a drawer).
 */
export function ReportChartsSection(): JSX.Element {
  const [theme, setTheme] = useState<BoardTheme>('sepia')
  const [opened, setOpened] = useState<string | null>(null)
  const drill = (id: string): void => setOpened(id)

  return (
    <GallerySection
      id="report-charts"
      title="Report charts"
      intro="The charts shared by the app and the downloaded report: the same SVG in both. Hover or focus a mark for its numbers; click or press Enter to open what is behind it. Arrow keys move between marks."
    >
      <div className="gl-span-12 gl-rc-tools">
        <SegmentedControl<BoardTheme>
          label="Chart board theme"
          options={THEMES}
          value={theme}
          onChange={setTheme}
          size="sm"
        />
        <p className="gl-help" role="status">
          {opened ? `Would open: ${opened}` : 'Click a bar, column, row or square.'}
        </p>
      </div>
      <div className="gl-span-12 gl-rc-board" data-theme={theme} data-testid="report-charts-board">
        <Card
          wide
          title="Where the change came from"
          sub={`Questions citing you rose by 14 between ${BEFORE} and ${NOW}. The two parts add up to it.`}
        >
          <SplitBarChart
            label="Change split into market and your work"
            parts={SPLIT}
            signedValues
            onDrill={drill}
          />
        </Card>
        <Card
          title="Where citations come from"
          sub={`Questions citing each group of pages, ${BEFORE} (faint) and ${NOW}.`}
        >
          <PairedBarsChart
            label="Where citations come from"
            items={PAIRED}
            beforeLabel={BEFORE}
            nowLabel={NOW}
            onDrill={drill}
          />
        </Card>
        <Card
          title="How fast new pages get cited"
          sub="Questions citing pages, by how many days they have been live."
        >
          <BucketColumnsChart
            label="How fast new pages get cited"
            items={BUCKETS}
            valueWords="questions citing"
            onDrill={drill}
          />
        </Card>
        <Card
          wide
          title="Who moved"
          sub={`Sites cited on more or fewer questions than on ${BEFORE}.`}
        >
          <GainersLosersChart
            label="Sites that gained and lost ground"
            items={MOVERS}
            limit={4}
            onDrill={drill}
          />
        </Card>
        <Card title={`Most cited sites, ${NOW}`} sub={`The faint bar is ${BEFORE}.`}>
          <RankedBarsChart
            label={`Most cited sites, ${NOW}`}
            items={RANKED}
            previousLabel={BEFORE}
            nowLabel={NOW}
            onDrill={drill}
          />
        </Card>
        <Card
          title="Where visibility falls away"
          sub="From every question tracked to your brand named in the answer."
        >
          <FunnelChart label="Where visibility falls away" steps={FUNNEL} onDrill={drill} />
        </Card>
        <Card
          title="Your position among the sources"
          sub="How often your page is the first, second or third source."
        >
          <PositionChart
            label="Your position among the sources"
            positions={POSITIONS}
            notCited={NOT_CITED}
            idPrefix="pos"
            onDrill={drill}
          />
        </Card>
        <Card title="History per question" sub="One square per check, oldest first.">
          <table className="gl-rc-table">
            <thead>
              <tr>
                <th scope="col">Question</th>
                <th scope="col">History</th>
              </tr>
            </thead>
            <tbody>
              {HISTORY.map((row) => (
                <tr key={row.id}>
                  <td>{row.question}</td>
                  <td>
                    <HistoryStripChart
                      label={`History for ${row.question}`}
                      cells={row.cells}
                      onDrill={drill}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="gl-rc-legend" aria-label="History colours">
            {historyLegendWords().map((item) => (
              <li key={item.state}>
                <span className={`gl-rc-sq gl-rc-sq-${item.state}`} aria-hidden="true" />
                {item.words}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </GallerySection>
  )
}
