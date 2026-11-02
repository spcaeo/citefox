import type { JSX } from 'react'
import type { EligibilityIssue, EligibilityWhere, PageEligibility } from '@shared/domain'
import { Compare, ReadFlag } from './readDrills'

const WHERE: Readonly<Record<EligibilityWhere, string>> = {
  meta: 'Robots meta tag',
  header: 'X-Robots-Tag header',
  html: 'Page HTML'
}

/** Where to make the change, in the words of the fix line. */
const FIX_PLACE: Readonly<Record<EligibilityWhere, string>> = {
  meta: 'the robots meta tag',
  header: 'the X-Robots-Tag header your server sends',
  html: 'the page HTML'
}

function snippetChars(detail: string): string {
  return detail.slice(detail.indexOf(':') + 1)
}

function issueCopy(issue: EligibilityIssue): { label: string; why: string; fix: string } {
  const place = FIX_PLACE[issue.where]
  switch (issue.code) {
    case 'noindex':
      return {
        label: `Hidden from Google (${issue.detail})`,
        why: 'The page asks Google not to index it, so it cannot appear in AI Overviews or in search results.',
        fix: `Remove ${issue.detail} from ${place}.`
      }
    case 'nosnippet':
      return {
        label: 'Google may not quote it (nosnippet)',
        why: 'nosnippet stops Google showing any text from the page, so an AI Overview cannot quote it.',
        fix: `Remove nosnippet from ${place}.`
      }
    case 'max_snippet': {
      const chars = snippetChars(issue.detail)
      return {
        label: `Snippets limited to ${chars} characters`,
        why: `${issue.detail} lets Google show at most ${chars} characters of the page, too few for an AI Overview to quote.`,
        fix: `Remove ${issue.detail} from ${place}, or set max-snippet:-1 (no limit).`
      }
    }
    case 'data_nosnippet':
      return {
        label: 'Most of the text is marked data-nosnippet',
        why: 'Google does not quote text inside elements marked data-nosnippet, and here that covers most of the page.',
        fix: 'Keep data-nosnippet on small parts only, such as legal notes, and take it off the main content.'
      }
  }
}

/**
 * "Shown in AI Overviews": whether Google may show and quote the page, from the
 * robots meta tag, the X-Robots-Tag header and data-nosnippet. Each problem is a
 * flag that opens what it means and the fix.
 */
export function ReadEligibility({
  eligibility
}: {
  eligibility: PageEligibility | null
}): JSX.Element {
  if (eligibility === null) {
    return (
      <p className="rd-faint" data-testid="read-eligibility">
        Checked when CiteFox reads the page&apos;s HTML itself, not through the backup reader.
      </p>
    )
  }
  if (eligibility.issues.length === 0) {
    return (
      <p className="rd-line" data-testid="read-eligibility">
        <ReadFlag ok label="Google may show and quote this page">
          No noindex, nosnippet or small max-snippet in the robots meta tag or the X-Robots-Tag
          header, and data-nosnippet does not hide the main text. Google-Extended in robots.txt does
          not control AI Overviews, so it is not part of this check.
        </ReadFlag>
      </p>
    )
  }
  return (
    <div data-testid="read-eligibility">
      {eligibility.issues.map((issue) => {
        const copy = issueCopy(issue)
        return (
          <p key={issue.code} className="rd-line">
            <ReadFlag ok={false} label={copy.label}>
              {copy.why} <strong>Fix:</strong> {copy.fix}
              <Compare
                rows={[
                  { label: 'Found in', value: WHERE[issue.where] },
                  { label: 'The page says', value: issue.detail, mono: true }
                ]}
              />
            </ReadFlag>
          </p>
        )
      })}
    </div>
  )
}
