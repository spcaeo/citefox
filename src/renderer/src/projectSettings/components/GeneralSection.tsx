import { useId, useRef, useState, type JSX } from 'react'
import { Button } from '../../ui'
import type { CompetitorFindings } from '@shared/domain'
import { Switch } from '../../alerts/bits'
import { useDrill } from '../../drill'
import { ProductsPanel } from '../../products/ProductsPanel'
import { useProductCatalog } from '../../products/useProductCatalog'
import { useSave } from '../hooks/useSave'
import type { SectionProps } from '../types'
import { competitorDrill } from '../utils/competitorDrill'
import { addUnique, cleanDomain, errorText } from '../utils/model'
import { ChipList, SaveStatus, Section } from './bits'
import { CompetitorFinder } from './CompetitorFinder'

/** Name, domain, subdomains, brands, competitors, and the client name (FR-10.3, FR-10.7). */
export function GeneralSection({ view, admin, client, refresh }: SectionProps): JSX.Element {
  const project = view.project
  const base = useId()
  const [name, setName] = useState(project.name)
  const [domain, setDomain] = useState(project.domain)
  const [subdomains, setSubdomains] = useState(project.includeSubdomains)
  const [brands, setBrands] = useState<string[]>([...project.brandNames])
  const [alias, setAlias] = useState('')
  const [competitors, setCompetitors] = useState<string[]>([...project.competitors])
  const [competitor, setCompetitor] = useState('')
  const [isClient, setIsClient] = useState(project.clientName !== null)
  const [clientName, setClientName] = useState(project.clientName ?? '')
  const save = useSave()
  const drill = useDrill()
  const findings = useRef<Promise<CompetitorFindings> | null>(null)
  const [chipError, setChipError] = useState<string | null>(null)
  // Products and competitors by product (prompt audit PC). Empty value: whole business.
  const productState = useProductCatalog(project.id)
  const products = productState.catalog?.products ?? []
  const [addFor, setAddFor] = useState('')

  /** A saved competitor opens the overviews that cite it (stored checks, read once). */
  async function openCompetitor(item: string): Promise<void> {
    setChipError(null)
    findings.current ??= admin.findCompetitors({ projectId: project.id })
    try {
      const found = await findings.current
      drill.open(
        competitorDrill(found, item, {
          markets: view.markets,
          brand: project.brandNames[0] ?? project.name
        })
      )
    } catch (cause) {
      findings.current = null
      setChipError(errorText(cause, 'Could not read the stored checks.'))
    }
  }

  async function onSave(): Promise<void> {
    const host = cleanDomain(domain)
    if (name.trim().length === 0 || host.length === 0) {
      save.fail('Enter a project name and a website domain.')
      return
    }
    if (brands.length === 0) {
      save.fail('Add at least one brand name.')
      return
    }
    if (isClient && clientName.trim().length === 0) {
      save.fail('Enter the client name, or turn off "This is a client project".')
      return
    }
    await save.run(async () => {
      await client.updateProject({
        projectId: project.id,
        name: name.trim(),
        domain: host,
        includeSubdomains: subdomains,
        brandNames: brands,
        competitors,
        clientName: isClient ? clientName.trim() : null
      })
      await refresh()
      await productState.reload()
    }, 'General settings saved.')
  }

  async function addCompetitor(found: string): Promise<void> {
    const next = addUnique(project.competitors, found)
    await client.updateProject({ projectId: project.id, competitors: next })
    setCompetitors((current) => addUnique(current, found))
    await refresh()
    await productState.reload()
  }

  /**
   * Add: for the whole business it joins the chips and saves with the section; for a
   * product it is saved at once with that product, as a direct competitor.
   */
  async function addTyped(): Promise<void> {
    const host = cleanDomain(competitor)
    const catalog = productState.catalog
    setCompetitor('')
    if (host.length === 0) return
    if (addFor === '' || catalog === null) {
      setCompetitors((current) => addUnique(current, host))
      return
    }
    const saved = await productState.save({
      products: catalog.products,
      competitors: [
        ...catalog.competitors,
        {
          name: host,
          domain: host,
          productId: addFor,
          tier: 'direct',
          startingPrice: null,
          sources: []
        }
      ]
    })
    if (saved === null) return
    setCompetitors((current) => addUnique(current, host))
    await refresh()
  }

  return (
    <Section id={'ps-general'} title="General">
      <div className="grid2">
        <label className="field" htmlFor={`${base}-name`}>
          <span className="field-label">Project name</span>
          <input
            id={`${base}-name`}
            className="ob-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field" htmlFor={`${base}-domain`}>
          <span className="field-label">Website domain</span>
          <input
            id={`${base}-domain`}
            className="ob-input mono"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
          />
        </label>
      </div>
      <div className="switch-row">
        <span className="stack-tight">
          <span className="field-label" id={`${base}-sub-l`}>
            Include subdomains
          </span>
          <span className="hint" id={`${base}-sub-d`}>
            Counts links to help.{cleanDomain(domain) || project.domain} or app.
            {cleanDomain(domain) || project.domain} as your own pages.
          </span>
        </span>
        <Switch
          on={subdomains}
          labelledBy={`${base}-sub-l`}
          describedBy={`${base}-sub-d`}
          onToggle={() => setSubdomains((current) => !current)}
        />
      </div>
      <div className="field">
        <span className="field-label" id={`${base}-brands-l`}>
          Brand names and aliases
        </span>
        <ChipList
          labelledBy={`${base}-brands-l`}
          items={brands}
          emptyText="No brand names yet."
          onRemove={(item) => setBrands((current) => current.filter((value) => value !== item))}
        />
        <div className="inline ps-add">
          <label className="sr-only" htmlFor={`${base}-alias`}>
            Add a brand alias
          </label>
          <input
            id={`${base}-alias`}
            className="ob-input"
            placeholder={`Add alias, e.g. ${project.name}.com`}
            value={alias}
            onChange={(event) => setAlias(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              setBrands((current) => addUnique(current, alias))
              setAlias('')
            }}
          />
          <Button
            onClick={() => {
              setBrands((current) => addUnique(current, alias))
              setAlias('')
            }}
          >
            Add
          </Button>
        </div>
        <span className="hint">
          Used to spot brand mentions without a link. Buyer questions never contain these names.
        </span>
      </div>
      <div className="field">
        <span className="field-label" id={`${base}-comp-l`}>
          Competitors
        </span>
        <ChipList
          labelledBy={`${base}-comp-l`}
          items={competitors}
          emptyText="No competitors yet."
          onRemove={(item) =>
            setCompetitors((current) => current.filter((value) => value !== item))
          }
          onOpen={(item) => void openCompetitor(item)}
          openLabel={(item) => `${item}: show the AI Overviews that cite it`}
          domains
        />
        {chipError ? (
          <p className="field-error" role="alert">
            {chipError}
          </p>
        ) : null}
        <div className="inline ps-add">
          <label className="sr-only" htmlFor={`${base}-comp`}>
            Add a competitor domain
          </label>
          <input
            id={`${base}-comp`}
            className="ob-input mono"
            placeholder="Add a domain, e.g. example.com"
            value={competitor}
            onChange={(event) => setCompetitor(event.target.value)}
          />
          {products.length > 0 ? (
            <select
              className="select"
              aria-label="Competitor for"
              value={addFor}
              onChange={(event) => setAddFor(event.target.value)}
            >
              <option value="">Whole business</option>
              {products.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          ) : null}
          <Button onClick={() => void addTyped()}>Add</Button>
        </div>
        <CompetitorFinder
          admin={admin}
          projectId={project.id}
          competitors={competitors}
          markets={view.markets}
          brand={project.brandNames[0] ?? project.name}
          onAdd={addCompetitor}
        />
      </div>
      <ProductsPanel state={productState} onChanged={() => void refresh()} />

      <div className="sub">
        <div className="switch-row">
          <span className="stack-tight">
            <span className="field-label" id={`${base}-client-l`}>
              This is a client project
            </span>
            <span className="hint" id={`${base}-client-d`}>
              Adds the client&apos;s name to reports and the project switcher.
            </span>
          </span>
          <Switch
            on={isClient}
            labelledBy={`${base}-client-l`}
            describedBy={`${base}-client-d`}
            onToggle={() => setIsClient((current) => !current)}
          />
        </div>
        {isClient ? (
          <label className="field" htmlFor={`${base}-client`}>
            <span className="field-label">Client name</span>
            <input
              id={`${base}-client`}
              className="ob-input"
              placeholder="e.g. Example Co"
              value={clientName}
              onChange={(event) => setClientName(event.target.value)}
            />
          </label>
        ) : null}
      </div>
      <div className="actions">
        <Button
          variant="primary"
          disabled={save.state.kind === 'saving'}
          onClick={() => void onSave()}
        >
          Save general settings
        </Button>
      </div>
      <SaveStatus state={save.state} />
    </Section>
  )
}
