import { LOGO_MAX, LOGO_PATTERN, PREPARED_FOR_MAX, type ReportBranding } from './extras'

/**
 * Who the reports are from (Settings › Reports, app-wide, set once):
 * - `agency`: an agency sends reports to clients ("Prepared by <agency> for <client>");
 * - `company`: an in-house team reports on its own company (no "client" anywhere);
 * - `none`: just me, no branding: today's look exactly. The default until someone picks.
 */
export type BrandingMode = 'agency' | 'company' | 'none'
export const BRANDING_MODES: readonly BrandingMode[] = ['agency', 'company', 'none']

export interface ReportSender {
  mode: BrandingMode
  /** The agency's or the company's name. Company: empty reads as the project's brand. */
  name: string
  /** A small image as a data URL (the same limits as the "Prepared for" logo). */
  logo: string | null
  /** Agency only: shown on the download cover. */
  website: string
  /** Agency only: shown on the download cover. */
  email: string
  /** Company only: "Prepared by <your name or team>" (each project may override it). */
  preparedBy: string
}

export const NO_SENDER: ReportSender = {
  mode: 'none',
  name: '',
  logo: null,
  website: '',
  email: '',
  preparedBy: ''
}

export const SENDER_NAME_MAX = PREPARED_FOR_MAX
export const SENDER_LINK_MAX = 120
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const WEBSITE = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i

function line(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

/** A sender as saved: known mode, trimmed names, a website and email only when they look right. */
export function cleanSender(value: unknown): ReportSender {
  if (typeof value !== 'object' || value === null) return NO_SENDER
  const record = value as Record<string, unknown>
  const mode = BRANDING_MODES.find((item) => item === record.mode) ?? 'none'
  const logo =
    typeof record.logo === 'string' &&
    record.logo.length <= LOGO_MAX &&
    LOGO_PATTERN.test(record.logo)
      ? record.logo
      : null
  const website = line(record.website, SENDER_LINK_MAX)
  const email = line(record.email, SENDER_LINK_MAX)
  return {
    mode,
    name: line(record.name, SENDER_NAME_MAX),
    logo,
    website: WEBSITE.test(website) ? website : '',
    email: EMAIL.test(email) ? email : '',
    preparedBy: line(record.preparedBy, SENDER_NAME_MAX)
  }
}

/** Why a website or email typed in Settings cannot be saved; null when it is fine or empty. */
export function senderFieldProblem(field: 'website' | 'email', value: string): string | null {
  const text = value.trim()
  if (text === '') return null
  if (field === 'email') return EMAIL.test(text) ? null : 'Type an email such as hello@example.com.'
  return WEBSITE.test(text) ? null : 'Type a website such as example.com.'
}

/**
 * The mode other screens adapt their words to. An agency with no name yet reads as
 * `none`, so no screen says "Prepared by" with nothing after it.
 */
export function brandingMode(sender: ReportSender | null | undefined): BrandingMode {
  if (sender === null || sender === undefined) return 'none'
  if (sender.mode === 'agency' && sender.name === '') return 'none'
  return sender.mode
}

/** What a report shows about who made it and who it is for. Null: today's look. */
export interface ReportByline {
  mode: 'agency' | 'company'
  /** Left of the cover: the agency or the company. */
  fromName: string
  fromLogo: string | null
  fromWebsite: string
  fromEmail: string
  /** Right of the cover: the client (agency) or the team (company). Empty: no line. */
  forName: string
  forLogo: string | null
  /** The footer's "Prepared by <…>". Empty: no line. */
  preparedBy: string
}

/**
 * The byline for one project's reports. `brand` is the project's brand: an agency's
 * client name and a company's own name default to it. `brandIcon` is the project
 * site's stored icon, a company's logo when it has none of its own.
 */
export function reportByline(
  sender: ReportSender | null | undefined,
  branding: ReportBranding,
  brand: string,
  brandIcon: string | null = null
): ReportByline | null {
  const mode = brandingMode(sender)
  if (mode === 'none' || sender === null || sender === undefined) return null
  if (mode === 'agency') {
    return {
      mode,
      fromName: sender.name,
      fromLogo: sender.logo,
      fromWebsite: sender.website,
      fromEmail: sender.email,
      forName: branding.preparedFor || brand,
      forLogo: branding.logo,
      preparedBy: sender.name
    }
  }
  return {
    mode,
    fromName: sender.name || brand,
    fromLogo: sender.logo ?? brandIcon,
    fromWebsite: '',
    fromEmail: '',
    forName: branding.preparedFor,
    forLogo: null,
    preparedBy: branding.preparedBy || sender.preparedBy
  }
}

/** The one small line on the Reports home and a report's header. */
export function bylineText(byline: ReportByline): string {
  if (byline.mode === 'agency') return `Prepared by ${byline.fromName} for ${byline.forName}`
  return byline.forName ? `${byline.fromName} · reports for ${byline.forName}` : byline.fromName
}

/** The scheduled email's "Prepared by" name (no project needed); empty: no line. */
export function senderEmailName(sender: ReportSender | null | undefined): string {
  const mode = brandingMode(sender)
  if (mode === 'agency') return sender?.name ?? ''
  if (mode === 'company') return sender?.preparedBy ?? ''
  return ''
}
