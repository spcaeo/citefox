import { useCallback, type JSX } from 'react'
import { buildLine, TestingPanel, useBuildActions } from '../../buildMenu'
import type { OnboardingClient } from '../../onboarding/client'
import { sectionHash } from '../../shell/routes'
import { SponsorList } from '../../sponsors'
import { Panel } from '../../ui'

/**
 * Settings › Data & about: what CiteFox is, its version, build and licence,
 * who sponsors it (SPONSORS.md, the shared sponsor config), and the Testing
 * tools (the build menu's actions) folded under More.
 */
export function AboutCard({ client }: { client: Pick<OnboardingClient, 'getInfo'> }): JSX.Element {
  const fetchInfo = useCallback(() => client.getInfo(), [client])
  const actions = useBuildActions(fetchInfo)
  const { info } = actions
  const build = info ? buildLine(info) : null

  return (
    <div className="stg-grid">
      <Panel title="About CiteFox" className="stg-span-6">
        <dl className="stg-facts">
          <div>
            <dt>Version</dt>
            <dd className="num">{info?.version ?? '—'}</dd>
          </div>
          <div>
            <dt>Build</dt>
            <dd className="num">{build ? build.replace(/^Built? /, '') : '—'}</dd>
          </div>
          <div>
            <dt>Licence</dt>
            <dd>Source-available · © Space-O Technologies</dd>
          </div>
          <div>
            <dt>Your data</dt>
            <dd>
              Your SEO data stays on this computer. <a href={sectionHash('status')}>Status</a>
            </dd>
          </div>
          <div>
            <dt>Affiliate links</dt>
            <dd>
              Some partner links in CiteFox are affiliate links. If you sign up through them we may
              earn a commission, at no extra cost to you. It helps keep CiteFox free.
            </dd>
          </div>
        </dl>
      </Panel>
      <Panel title="Sponsors" className="stg-span-6">
        <SponsorList />
      </Panel>
      <details className="stg-span-12 stg-more">
        <summary>More</summary>
        <TestingPanel actions={actions} />
      </details>
    </div>
  )
}
