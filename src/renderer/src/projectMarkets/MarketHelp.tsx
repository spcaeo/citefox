import { useId, useMemo, useState, type JSX } from 'react'
import {
  Button,
  createHelpFillSource,
  HelpFill,
  type HelpFillBot,
  type HelpFillSource,
  type HelpFillWay
} from '../ui'
import { marketPicks, type MarketPick } from './marketPicks'
import './MarketHelp.css'

/** `markets.suggest` writes at most 5 in one call. */
const COUNTS = [3, 5] as const

/**
 * ✦ Help me fill this in both Add market drawers (the page's Markets tab and the
 * project's drawer), HelpFill.dc.html panel 7: "Where do you sell?". Describe
 * runs the `markets.suggest` assist; Use your own ChatGPT copies a prompt that
 * lists the markets already tracked and reads the pasted `country,language,city`
 * answer. The first pick fills the drawer's form at once; "Use" fills it with
 * another. Nothing is added until the drawer's own button.
 */
export function MarketHelp({
  projectId,
  pageId,
  way,
  onWay,
  bot,
  onBot,
  picked,
  onUse,
  fallbackLanguage,
  disabled = false,
  source: sourceProp,
  openLink
}: {
  projectId: string
  /** The page the market is for; null for the whole project. */
  pageId: string | null
  way: HelpFillWay | null
  onWay: (way: HelpFillWay) => void
  bot: HelpFillBot | null
  onBot: (bot: HelpFillBot) => void
  /** The pick now in the form, marked "In the form". */
  picked: string | null
  onUse: (pick: MarketPick) => void
  /** The form's language, for a row that names none and a country with no usual one. */
  fallbackLanguage: string
  disabled?: boolean
  /** Tests only. Production uses the preload bridge. */
  source?: HelpFillSource
  openLink?: (url: string) => void
}): JSX.Element {
  const listId = useId()
  const source = useMemo(() => sourceProp ?? createHelpFillSource(), [sourceProp])
  const [picks, setPicks] = useState<readonly MarketPick[]>([])
  return (
    <div className="mh" data-testid="mh">
      <HelpFill
        kind="markets"
        projectId={projectId}
        scope={{ pageId }}
        source={source}
        way={way}
        onWay={onWay}
        bot={bot}
        onBot={onBot}
        describe={{
          label: 'Where do you sell?',
          placeholder: 'e.g. Offices across Canada and the UK, plus a few big US cities.',
          counts: COUNTS,
          defaultCount: 3,
          buttonLabel: (count) => `Suggest ${count} ${count === 1 ? 'market' : 'markets'}`
        }}
        chatbot={{ pastePlaceholder: (name) => `Paste the CSV or list ${name} gave you…` }}
        onRows={(result) => {
          const next = marketPicks(result.rows, fallbackLanguage)
          setPicks(next)
          const first = next[0]
          if (first) onUse(first)
        }}
        disabled={disabled}
        testId="mh-hf"
        {...(openLink ? { openLink } : {})}
      />
      {picks.length > 0 ? (
        <div className="mh-picks">
          <p className="hf-label" id={listId}>
            Suggested · use one to fill the form
          </p>
          <ul className="mh-list" aria-labelledby={listId} data-testid="mh-picks">
            {picks.map((pick) => (
              <li className="mh-pick" key={pick.id}>
                <span className="mh-name">{pick.label}</span>
                {pick.id === picked ? (
                  <span className="mh-on" data-testid="mh-in-form">
                    In the form
                  </span>
                ) : (
                  <Button
                    size="sm"
                    disabled={disabled}
                    aria-label={`Use ${pick.label}`}
                    onClick={() => onUse(pick)}
                  >
                    Use
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
