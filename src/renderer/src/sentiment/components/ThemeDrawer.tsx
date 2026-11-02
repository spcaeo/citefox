import type { JSX } from 'react'
import type { ClaimTone, SentimentClaim } from '@shared/domain'
import { formatNet, type ThemeRow } from '@shared/sentiment-metrics'
import { DrillLink } from '../../drill'
import { Drawer, DrawerFacts, DrawerGrid, DrawerMain, DrawerRail, DrawerSection } from '../../ui'
import { TONE_LABEL } from '../constants'
import type { SentimentDrills } from '../drills'
import { countNoun } from '../utils/model'
import { ClaimSource } from './ClaimSource'

const TONES: readonly ClaimTone[] = ['positive', 'neutral', 'negative']

/**
 * One theme's exact sentences about the brand in the shared Drawer
 * (`drawer=st-theme&sth.id=<key>`), opened from the Themes table: each
 * sentence with its tone, attribute, nearest source and the prompt it came
 * from; the tone split and attributes on the right.
 */
export function ThemeDrawer({
  brand,
  row,
  claims,
  drills,
  onClose
}: {
  brand: string
  /** Null: the theme on the URL is not in this check or filter (a stale link). */
  row: ThemeRow | null
  /** The theme's own-brand claims. */
  claims: readonly SentimentClaim[]
  drills: SentimentDrills
  onClose: () => void
}): JSX.Element {
  const themes = { label: 'Themes', onSelect: onClose }
  if (row === null) {
    return (
      <Drawer
        id="st-theme"
        title="Theme"
        trail={[themes]}
        testId="st-theme-drawer"
        error={{ message: 'This theme is not in this check or filter.' }}
        onClose={onClose}
      />
    )
  }
  return (
    <Drawer
      id="st-theme"
      title={row.theme}
      trail={[themes]}
      subtitle={`Sentences about ${brand} on ${row.theme}, word for word from the overviews.`}
      testId="st-theme-drawer"
      focusOnOpen="close"
      onClose={onClose}
      footer={{
        summary: (
          <>
            <strong className="num">{claims.length}</strong>{' '}
            {claims.length === 1 ? 'sentence' : 'sentences'}
            {row.net === null ? '' : ` · net ${formatNet(row.net)}`}
          </>
        )
      }}
    >
      <DrawerGrid>
        <DrawerMain>
          <DrawerSection
            title={`${row.theme} · ${countNoun(claims.length, 'sentence', 'sentences')}`}
            description="Each sentence with its tone, its nearest source and the question it answers."
          >
            <ul className="st-sentences" aria-label={`Sentences about ${row.theme}`}>
              {claims.map((claim) => {
                const overview = drills.overviewOf(claim)
                const target = overview ? drills.promptTarget(overview) : null
                return (
                  <li key={claim.id}>
                    <p className="st-meta">
                      <span className={`st-tone st-tone-${claim.tone}`}>
                        {TONE_LABEL[claim.tone]}
                      </span>
                      <span>{claim.attribute}</span>
                    </p>
                    <p className="st-quote">&ldquo;{claim.sentence}&rdquo;</p>
                    <p className="st-note">
                      <ClaimSource claim={claim} />
                    </p>
                    {overview ? (
                      <p className="st-note">
                        {claim.source === 'brand' ? 'Brand question' : 'Buyer question'}:{' '}
                        {target ? (
                          <DrillLink target={target}>{overview.promptText}</DrillLink>
                        ) : (
                          overview.promptText
                        )}
                      </p>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </DrawerSection>
        </DrawerMain>
        <DrawerRail label="About this theme">
          <DrawerSection title="Tone">
            <DrawerFacts
              label="Tone of the sentences"
              items={[
                ...TONES.map((tone) => ({
                  label: TONE_LABEL[tone],
                  value: <span className="num">{row.counts[tone]}</span>
                })),
                {
                  label: 'Net',
                  value: (
                    <span className="num">
                      {row.net === null ? 'Too few claims' : formatNet(row.net)}
                    </span>
                  )
                }
              ]}
            />
          </DrawerSection>
          <DrawerSection title="Attributes" count={row.attributes.length}>
            <p className="st-small">{row.attributes.join(', ') || '—'}</p>
          </DrawerSection>
        </DrawerRail>
      </DrawerGrid>
    </Drawer>
  )
}
