import { Fragment, type JSX } from 'react'
import type { ClaimTone, SentimentClaim } from '@shared/domain'
import { formatNet, ownClaims, themeRows, type ThemeRow } from '@shared/sentiment-metrics'
import { DrillButton, DrillNumber, type ItemDrill } from '../../drill'
import { DrawerLevel } from '../../shell/DrawerLevel'
import { openDrawer, useDrawerEntry } from '../../shell/drawers'
import { EmptyState, ListGrid, type ListColumn } from '../../ui'
import { TONE_LABEL } from '../constants'
import type { SentimentDrills } from '../drills'
import { netBand, themeKey } from '../utils/model'
import { ThemeDrawer } from './ThemeDrawer'

const TONE_MARK: Readonly<Record<ClaimTone, string>> = {
  positive: '+',
  neutral: '',
  negative: '−'
}

const TONES = ['positive', 'neutral', 'negative'] as const

/**
 * FR-16.7: themes of the claims about the brand as a list grid. Every count,
 * tone part, net value and attribute opens its claims; the theme name (or the
 * row) opens its exact sentences and sources in a drawer on the URL
 * (`drawer=st-theme&sth.id=<key>`).
 */
export function ThemesTable({
  brand,
  claims,
  drills
}: {
  brand: string
  claims: readonly SentimentClaim[]
  drills: SentimentDrills
}): JSX.Element {
  const own = ownClaims(claims)
  const rows = themeRows(own)
  const drawer = useDrawerEntry('st-theme')
  const openKey = drawer?.entry.params['sth.id'] ?? null
  const openRow = rows.find((row) => themeKey(row.theme) === openKey) ?? null
  const open = openRow?.theme ?? null
  const setOpen = (theme: string): void => {
    openDrawer('st-theme', { 'sth.id': themeKey(theme) })
  }
  const themeDrill = (row: ThemeRow): ItemDrill =>
    drills.claims(
      { id: `theme:${row.theme}`, title: `${row.theme}: claims about ${brand}` },
      row.claimIds
    )
  const subsetDrill = (
    row: ThemeRow,
    id: string,
    title: string,
    test: (c: SentimentClaim) => boolean
  ): ItemDrill =>
    drills.claims(
      { id: `theme:${row.theme}:${id}`, title },
      own.filter((claim) => row.claimIds.includes(claim.id) && test(claim)).map((claim) => claim.id)
    )

  const columns: ListColumn<ThemeRow>[] = [
    {
      id: 'theme',
      label: 'Theme',
      width: 200,
      sort: (row) => row.theme.toLowerCase(),
      render: (row) => (
        <button
          type="button"
          className="st-drill st-strong"
          aria-haspopup="dialog"
          onClick={() => setOpen(row.theme)}
        >
          {row.theme}
        </button>
      )
    },
    {
      id: 'claims',
      label: 'Claims',
      width: 80,
      numeric: true,
      sort: (row) => row.counts.total,
      render: (row) => (
        <DrillNumber
          drill={themeDrill(row)}
          label={`${row.counts.total} claims about ${row.theme}, show them`}
        />
      )
    },
    {
      id: 'tone',
      label: 'Tone + · = · −',
      width: 140,
      render: (row) => (
        <span className="st-tone-parts num">
          {TONES.map((tone, index) => (
            <Fragment key={tone}>
              {index > 0 ? ' · ' : null}
              {row.counts[tone] > 0 ? (
                <DrillNumber
                  drill={subsetDrill(
                    row,
                    tone,
                    `${row.theme}: ${TONE_LABEL[tone].toLowerCase()} claims about ${brand}`,
                    (claim) => claim.tone === tone
                  )}
                  label={`${row.counts[tone]} ${tone} claims about ${row.theme}, show them`}
                />
              ) : (
                '0'
              )}
              {TONE_MARK[tone] ? ` ${TONE_MARK[tone]}` : null}
            </Fragment>
          ))}
        </span>
      )
    },
    {
      id: 'net',
      label: 'Net',
      width: 88,
      sort: (row) => row.net,
      render: (row) =>
        row.net === null ? (
          <>
            <span className={`st-net st-n-${netBand(row.net)}`} />
            <span className="sr-only">Too few claims</span>
          </>
        ) : (
          <DrillButton
            drill={themeDrill(row)}
            untracked
            label={`${row.theme}: net ${formatNet(row.net)}, show the claims`}
            className={`st-drill st-net st-n-${netBand(row.net)}`}
          >
            {formatNet(row.net)}
          </DrillButton>
        )
    },
    {
      id: 'attributes',
      label: 'Attributes',
      width: 'fill',
      minWidth: 220,
      render: (row) => (
        <span className="st-attrs">
          {row.attributes.map((attribute, index) => (
            <Fragment key={attribute}>
              {index > 0 ? ', ' : null}
              <DrillButton
                drill={subsetDrill(
                  row,
                  `attr:${attribute}`,
                  `${row.theme} · ${attribute}`,
                  (claim) => claim.attribute === attribute
                )}
                untracked
                label={`Show the claims about ${row.theme}: ${attribute}`}
                className="st-drill"
              >
                {attribute}
              </DrillButton>
            </Fragment>
          ))}
        </span>
      )
    }
  ]

  const items = openRow ? own.filter((claim) => openRow.claimIds.includes(claim.id)) : []

  return (
    <>
      <ListGrid
        label="Themes table"
        noun={['theme', 'themes']}
        rows={rows}
        rowKey={(row) => row.theme}
        rowLabel={(row) => row.theme}
        columns={columns}
        search={{
          text: (row) => [row.theme, ...row.attributes].join(' '),
          placeholder: 'Search themes and attributes'
        }}
        rowMenu={(row) => [
          {
            id: 'sentences',
            label: 'Read the sentences',
            icon: 'eye',
            onSelect: () => setOpen(row.theme)
          }
        ]}
        onActivate={(row) => setOpen(row.theme)}
        isRowCurrent={(row) => row.theme === open}
        empty={<EmptyState compact title={`No claims about ${brand} in this check`} />}
      />
      {drawer ? (
        <DrawerLevel depth={drawer.depth}>
          <ThemeDrawer
            brand={brand}
            row={openRow}
            claims={items}
            drills={drills}
            onClose={() => drawer.close()}
          />
        </DrawerLevel>
      ) : null}
    </>
  )
}
