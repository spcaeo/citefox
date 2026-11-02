import type { JSX } from 'react'
import type { VisibilityOverview } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { agreementLine, METHOD_COPY } from '@shared/report/method'
import { marketLabel } from '../../shell/model'
import { ScreenDrawerLevel } from '../../shell/DrawerLevel'
import { Drawer, DrawerFacts, DrawerGrid, DrawerMain, DrawerRail, DrawerSection } from '../../ui'
import { formatDay } from '../../utils/dates'
import { DrillNumber } from '../../drill'
import { compareLabel, trackedDrill } from '../compare'

/**
 * "How we measure" (`?panel=method`), a read-only drawer: what was searched and
 * when, cited vs named, why conclusions rest on totals, before and after, and,
 * when page and topic checks asked the same questions, how often they agree.
 * It is the Overview's own URL value, so Back closes it and a link reopens it.
 */
export function MethodDrawer({
  data,
  onClose
}: {
  data: VisibilityOverview
  onClose: () => void
}): JSX.Element {
  const { method } = data
  const compared = compareLabel(data)
  const markets = method.marketIds
    .map((id) => data.markets.find((market) => market.id === id))
    .filter((market) => market !== undefined)
    .map((market) => marketLabel(market))
  const sameDay =
    method.firstCheckAt !== null &&
    method.lastCheckAt !== null &&
    method.firstCheckAt.slice(0, 10) === method.lastCheckAt.slice(0, 10)
  const when =
    method.firstCheckAt === null || method.lastCheckAt === null
      ? 'No check has finished yet.'
      : sameDay
        ? `Checked on ${formatDay(method.lastCheckAt)}.`
        : `Checks from ${formatDay(method.firstCheckAt)} to ${formatDay(method.lastCheckAt)}.`
  const checks =
    method.firstCheckAt === null || method.lastCheckAt === null
      ? 'None yet'
      : sameDay
        ? formatDay(method.lastCheckAt)
        : `${formatDay(method.firstCheckAt)} to ${formatDay(method.lastCheckAt)}`
  return (
    <ScreenDrawerLevel onClose={onClose}>
      <Drawer
        id="method"
        title="How we measure"
        subtitle="How the Summary's numbers are worked out, in plain words."
        focusOnOpen="close"
        onClose={onClose}
        testId="method-drawer"
      >
        <DrawerGrid className="ov-method">
          <DrawerMain>
            <DrawerSection title="What was searched">
              <p>
                {pluralize(data.kpis.tracked.value, 'tracked question')} searched on Google
                {markets.length > 0 ? ` in ${markets.join(', ')}` : ''}. {when}
                {compared === null ? '' : ` Changes compare with ${compared}.`}
              </p>
            </DrawerSection>
            <DrawerSection title="Cited and named">
              <p>{METHOD_COPY.cited}</p>
            </DrawerSection>
            <DrawerSection title="Answers vary">
              <p>{METHOD_COPY.vary}</p>
              <p>{METHOD_COPY.partial}</p>
            </DrawerSection>
            <DrawerSection title="Before and after">
              <p>{METHOD_COPY.change}</p>
            </DrawerSection>
          </DrawerMain>
          <DrawerRail label="At a glance">
            <DrawerSection title="At a glance">
              <DrawerFacts
                label="What the numbers cover"
                items={[
                  {
                    label: 'Tracked questions',
                    value: (
                      <span className="num">
                        <DrillNumber
                          drill={trackedDrill(data)}
                          label={`${data.tracked.length} tracked: open them`}
                        />
                      </span>
                    )
                  },
                  { label: 'Markets', value: markets.length > 0 ? markets.join(', ') : 'None' },
                  { label: 'Checks', value: checks },
                  { label: 'Compared with', value: compared ?? 'Nothing yet' }
                ]}
              />
            </DrawerSection>
            {method.agreement !== null ? (
              <DrawerSection title="Page and topic checks">
                <p>{agreementLine(method.agreement)}</p>
              </DrawerSection>
            ) : null}
          </DrawerRail>
        </DrawerGrid>
      </Drawer>
    </ScreenDrawerLevel>
  )
}
