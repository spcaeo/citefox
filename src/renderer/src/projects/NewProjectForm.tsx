import { useId, useMemo, useRef, useState, type FormEvent, type JSX } from 'react'
import { DEFAULT_INCLUDE_SUBDOMAINS, DEFAULT_MARKET_DEVICE } from '@shared/domain'
import type { ApiKeyMetadata, ProjectUsageReport } from '@shared/domain'
import type { ProjectDetail, SuggestedMarket } from '@shared/ipc'
import { FillSuggestions } from '../fill/FillSuggestions'
import {
  createSetupHelpSource,
  keptQuestions,
  SetupHelp,
  topicsToCreate,
  useSetupUrl,
  type SetupHelpSource,
  type SetupPlan
} from '../fill/setupHelp'
import { cleanDomain as hostOf, useFillFromWebsite } from '../fill/useFillFromWebsite'
import { productsApi } from '../products/client'
import { navigateHash, sectionHash, startHash } from '../shell/routes'
import { noteProjectCreated } from '../start/createdNotice'
import { ScreenHeader } from '../components/Header'
import { addChips, Button, ChipInput, LinkButton, SectionHead } from '../ui'
import type { ShellClient } from './client'
import { createOptions, INITIAL_CHOICES, type NewProjectChoices } from './newProject/payload'
import { ProjectChoices } from './newProject/ProjectChoices'
import { errorText } from '../components/errorText'
import './newProject/newProject.css'

const NO_PROJECTS: readonly ProjectDetail[] = []
const NO_KEYS: readonly ApiKeyMetadata[] = []

const PRESETS = [
  { id: 'US-en', country: 'US', language: 'en', label: '🇺🇸 US · EN · United States, English' },
  { id: 'CA-en', country: 'CA', language: 'en', label: '🇨🇦 CA · EN · Canada, English' },
  { id: 'GB-en', country: 'GB', language: 'en', label: '🇬🇧 GB · EN · United Kingdom, English' },
  { id: 'AU-en', country: 'AU', language: 'en', label: '🇦🇺 AU · EN · Australia, English' },
  { id: 'IN-en', country: 'IN', language: 'en', label: '🇮🇳 IN · EN · India, English' },
  { id: 'MX-es', country: 'MX', language: 'es', label: '🇲🇽 MX · ES · Mexico, Spanish' }
] as const

export function NewProjectForm({
  client,
  heading,
  projects = NO_PROJECTS,
  keys = NO_KEYS,
  usage = null,
  setupSource,
  onCreated
}: {
  client: ShellClient
  heading: 'h1' | 'h2'
  /** Projects to copy settings from (FR-10.4). */
  projects?: readonly ProjectDetail[]
  /** SerpApi and Anthropic keys for the search source and Claude connection. */
  keys?: readonly ApiKeyMetadata[]
  /** Unassigned shared capacity and dedicated keys in use (FR-10.6). */
  usage?: ProjectUsageReport | null
  /** Tests only: the setup helper's channels. Production uses the preload bridge. */
  setupSource?: SetupHelpSource
  onCreated: () => Promise<void>
}): JSX.Element {
  const nameId = useId()
  const domainId = useId()
  const brandsId = useId()
  const compId = useId()
  const marketId = useId()
  const cityId = useId()
  const clientId = useId()
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [brands, setBrands] = useState<string[]>([])
  const [brandDraft, setBrandDraft] = useState('')
  const [competitors, setCompetitors] = useState<string[]>([])
  const [competitorDraft, setCompetitorDraft] = useState('')
  const [preset, setPreset] = useState<(typeof PRESETS)[number]['id']>('US-en')
  const [city, setCity] = useState('')
  const [clientName, setClientName] = useState('')
  const [choices, setChoices] = useState<NewProjectChoices>(INITIAL_CHOICES)
  const [capError, setCapError] = useState<string | null>(null)
  const fill = useFillFromWebsite(client, 'Enter a website domain first.')
  // "How should we set up …?" (HelpFill.dc.html panel 4): the way on the URL, the answer's questions.
  const source = useMemo(() => setupSource ?? createSetupHelpSource(), [setupSource])
  const setupUrl = useSetupUrl()
  const [plan, setPlan] = useState<SetupPlan | null>(null)
  // "Use in buyer questions" and "Note as integration" picks (Docs/FEEDBACK.md row 3).
  const [switchingFrom, setSwitchingFrom] = useState<readonly string[]>([])
  const [integrations, setIntegrations] = useState<readonly string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<ProjectDetail | null>(null)
  // Set before the first await: a second click or Enter while creating is ignored,
  // so one Create never makes two projects.
  const submitting = useRef(false)

  function cleanDomain(value: string): string {
    return value
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
  }

  async function fillFromWebsite(): Promise<void> {
    const result = await fill.run(domain)
    if (result && !name.trim() && result.brands[0]) setName(result.brands[0].name)
  }

  function applyMarket(market: SuggestedMarket): void {
    const match = PRESETS.find(
      (item) => item.country === market.country && item.language === market.language
    )
    if (match) setPreset(match.id)
    setCity(market.location ?? '')
  }

  /**
   * Prompt audit PC: the Fill read's products, and the competitors kept in the list by
   * the product they were found for. A failure leaves the plain list, which is saved.
   */
  async function saveFillProducts(projectId: string): Promise<void> {
    const result = fill.result
    const api = productsApi()
    if (api === null || result === null || (result.products ?? []).length === 0) return
    try {
      await api['products:saveFill']({
        projectId,
        fill: { products: result.products ?? [], competitors: result.competitors }
      })
    } catch {
      // The project and its competitor list are already saved.
    }
  }

  /** The ticked questions from a chatbot's answer, as topics. A failure leaves the project as created. */
  async function createPlanTopics(projectId: string): Promise<void> {
    const topics = topicsToCreate(plan)
    if (topics.length === 0) return
    try {
      await source['topics:createTopics']({ projectId, topics })
    } catch {
      // The project is saved; the questions can be added from Add questions.
    }
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (submitting.current || created !== null) return
    setError(null)
    const host = cleanDomain(domain)
    if (!name.trim() || !host) {
      setError('Enter a project name and a website domain.')
      return
    }
    const extra = createOptions(choices)
    if (!extra.ok) {
      if (choices.source === 'shared') setCapError(extra.error)
      setError(extra.error)
      return
    }
    setCapError(null)
    submitting.current = true
    setBusy(true)
    try {
      const detail = await client.createProject({
        name: name.trim(),
        domain: host,
        includeSubdomains: DEFAULT_INCLUDE_SUBDOMAINS,
        brandNames: addChips(brands, brandDraft),
        competitors: addChips(competitors, competitorDraft),
        clientName: clientName.trim() ? clientName.trim() : null,
        country: market.country,
        language: market.language,
        location: city.trim() ? city.trim() : null,
        device: DEFAULT_MARKET_DEVICE,
        ...(switchingFrom.length > 0 ? { switchingFrom } : {}),
        ...(integrations.length > 0 ? { integrations } : {}),
        ...extra.options
      })
      await saveFillProducts(detail.id)
      await createPlanTopics(detail.id)
      await onCreated()
      setCreated(detail)
      // The new project is the open one: go on to how it starts.
      noteProjectCreated(detail.name)
      navigateHash(startHash('choose'))
    } catch (cause) {
      submitting.current = false
      setError(errorText(cause, 'Could not create the project.'))
    } finally {
      setBusy(false)
    }
  }

  const market = PRESETS.find((item) => item.id === preset) ?? PRESETS[0]
  const toReview = (fill.result ? 1 : 0) + (keptQuestions(plan) > 0 ? 1 : 0)
  const intro =
    'One website per project, with its own database. Connections and default templates are shared.'
  return (
    <div className="page-stack np-page">
      {heading === 'h1' ? (
        <ScreenHeader
          nav={{ back: { href: sectionHash('projects'), label: 'Projects' } }}
          title="New project"
          subtitle={<p className="section-subtitle">{intro}</p>}
        />
      ) : (
        <SectionHead title="New project" description={intro} />
      )}
      <form
        className="card np-form"
        aria-label="New project"
        onSubmit={(event) => void onSubmit(event)}
      >
        <div className="grid2">
          <label className="field" htmlFor={nameId}>
            Project name
            <input
              id={nameId}
              className="ob-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="field" htmlFor={domainId}>
            Website domain
            <input
              id={domainId}
              className="ob-input mono"
              placeholder="example.com"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
            />
          </label>
        </div>
        <SetupHelp
          site={{
            domain: hostOf(domain),
            brandNames: addChips(brands, brandDraft),
            market: {
              country: market.country,
              language: market.language,
              location: city.trim() || null
            }
          }}
          source={source}
          url={setupUrl}
          fill={fill}
          onReadWebsite={() => void fillFromWebsite()}
          plan={plan}
          onPlan={setPlan}
          disabled={busy || created !== null}
          headingAs={heading === 'h1' ? 'h2' : 'h3'}
        />
        <FillSuggestions
          state={fill}
          onAddBrand={(brand) => setBrands((current) => addChips(current, brand))}
          onAddCompetitor={(item) => setCompetitors((current) => addChips(current, item))}
          onUseSwitchingFrom={(names) => setSwitchingFrom((current) => uniqueNames(current, names))}
          onNoteIntegrations={(names) => setIntegrations((current) => uniqueNames(current, names))}
          onUseMarket={applyMarket}
          onCheckDomain={(request) => client.checkCompanyDomain(request)}
        />
        <div className="grid2">
          <div className="field">
            <label htmlFor={brandsId}>Brand names</label>
            <ChipInput
              id={brandsId}
              items={brands}
              onItems={setBrands}
              draft={brandDraft}
              onDraft={setBrandDraft}
              placeholder="Type a name, then Enter"
              describedBy={`${brandsId}-hint`}
            />
            <span className="hint" id={`${brandsId}-hint`}>
              At least one. Used to spot brand mentions. Buyer questions never contain them.
            </span>
          </div>
          <div className="field">
            <label htmlFor={compId}>Competitors</label>
            <ChipInput
              id={compId}
              items={competitors}
              onItems={setCompetitors}
              draft={competitorDraft}
              onDraft={setCompetitorDraft}
              placeholder="Type a domain, then Enter"
              describedBy={`${compId}-hint`}
              mono
              domains
            />
            <span className="hint" id={`${compId}-hint`}>
              Domains you compete with for citations.
            </span>
          </div>
        </div>
        <div className="grid2">
          <label className="field" htmlFor={marketId}>
            Default market
            <select
              id={marketId}
              className="select"
              value={preset}
              onChange={(event) => setPreset(event.target.value as (typeof PRESETS)[number]['id'])}
            >
              {PRESETS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <span className="hint">Add cities and more markets after the project is created.</span>
          </label>
          <label className="field" htmlFor={cityId}>
            <span>
              City or region <span className="optional">(optional)</span>
            </span>
            <input
              id={cityId}
              className="ob-input"
              placeholder="e.g. Austin, Texas"
              value={city}
              onChange={(event) => setCity(event.target.value)}
            />
          </label>
        </div>
        <label className="field" htmlFor={clientId}>
          <span>
            Client name <span className="optional">(optional)</span>
          </span>
          <input
            id={clientId}
            className="ob-input"
            value={clientName}
            onChange={(event) => setClientName(event.target.value)}
          />
          <span className="hint">
            Leave blank for your own site. A client project shows the client&apos;s name in reports
            and the project switcher.
          </span>
        </label>
        <ProjectChoices
          choices={choices}
          onChange={setChoices}
          projects={projects}
          keys={keys}
          usage={usage}
          clientName={clientName}
          capError={capError}
        />
        <p className="hint">
          Subdomains are included. The database file is chosen when the project is created.
          {created ? (
            <>
              {' '}
              <span className="mono">{created.dbPath}</span>
            </>
          ) : null}
        </p>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="actions np-actions">
          {toReview > 0 ? (
            <span className="hint np-review">
              {keptQuestions(plan) > 0
                ? `Review the suggestions and ${keptQuestions(plan)} questions, then create.`
                : 'Review the suggestions, then create.'}
            </span>
          ) : null}
          <LinkButton href={sectionHash('projects')}>Cancel</LinkButton>
          <Button type="submit" variant="primary" busy={busy} disabled={created !== null}>
            Create project
          </Button>
        </div>
      </form>
    </div>
  )
}

function uniqueNames(current: readonly string[], names: readonly string[]): readonly string[] {
  const out = [...current]
  for (const name of names) {
    if (!out.some((item) => item.toLowerCase() === name.toLowerCase())) out.push(name)
  }
  return out.slice(0, 12)
}
