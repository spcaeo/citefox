import type { JSX } from 'react'
import { DrillButton, DrillPopover } from '../drill'
import { SiteIcon } from '../siteIcon/SiteIcon'
import { UrlText } from '../ui'
import { citedInstancePreview } from './model'
import type { ResultsDrills } from './results/drills'

/**
 * "Cited instead, by position". Each domain opens the overviews that cite it;
 * "+N more" lists every cited domain in a popover.
 */
export function CitedInstances({
  names,
  drills,
  promptLabel
}: {
  names: readonly string[]
  drills: ResultsDrills | null
  promptLabel: string
}): JSX.Element {
  const preview = citedInstancePreview(names)
  const shown = names.slice(0, names.length - preview.more)
  if (names.length === 0) return <span className="m3-instances mono">—</span>
  if (!drills) {
    return (
      <span className="m3-instances mono" title={preview.full}>
        {shown.map((name, index) => (
          <CitedDomain key={`${name}-${index}`} name={name} comma={index < shown.length - 1} />
        ))}
        {preview.more > 0 ? <span className="m3-instances-more">+{preview.more} more</span> : null}
      </span>
    )
  }
  const unique = [...new Set(names)]
  return (
    <span className="m3-instances mono" title={preview.full}>
      {shown.map((name, index) => (
        <CitedDomain
          key={`${name}-${index}`}
          name={name}
          comma={index < shown.length - 1}
          drills={drills}
        />
      ))}
      {preview.more > 0 ? (
        <DrillPopover
          label={`${preview.more} more cited in ${promptLabel}: ${preview.full}`}
          title={`Cited instead in ${promptLabel}, by position`}
          className="m3-instances-more m3-cell-btn"
          content={() => (
            <ol className="drill-pop-list">
              {unique.map((name) => {
                const drill = drills.get(`domain:${name}`)
                return (
                  <li key={name}>
                    {drill ? (
                      <DrillButton
                        drill={drill}
                        untracked
                        label={`${name}: show the questions that cite it`}
                      >
                        <SiteIcon domain={name} spaced />
                        <span className="mono">{name}</span>
                      </DrillButton>
                    ) : (
                      <UrlText domain={name} variant="url" />
                    )}
                  </li>
                )
              })}
            </ol>
          )}
        >
          +{preview.more} more
        </DrillPopover>
      ) : null}
    </span>
  )
}

function CitedDomain({
  name,
  comma,
  drills = null
}: {
  name: string
  comma: boolean
  drills?: ResultsDrills | null
}): JSX.Element {
  const drill = drills?.get(`domain:${name}`) ?? null
  return (
    <span className="m3-instance-line" title={name}>
      {/* The site's icon stays whole when a narrow column cuts the name. */}
      <SiteIcon domain={name} spaced />
      <UrlText domain={name} variant="domain" icon={false} className="m3-instance">
        {drill ? (
          <DrillButton
            drill={drill}
            className="m3-cell-btn"
            untracked
            label={`${name}: show the questions that cite it`}
          >
            {name}
          </DrillButton>
        ) : (
          name
        )}
      </UrlText>
      {comma ? <span className="m3-instance-sep">,</span> : null}
    </span>
  )
}
