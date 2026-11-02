import { fireEvent, screen, within } from '@testing-library/react'

/** The status line's link that opens a part, by the part's name. */
const STATUS_LINK: Readonly<Record<string, RegExp>> = {
  Sitemaps: /\d+ sitemaps?$/,
  'Last sync': /^(Last sync|Not synced yet)/,
  'CiteFox AI noticed': /^CiteFox AI noticed/
}

/**
 * Tests only. Opens a part of Site structure the way a person does: Folders,
 * Clusters and Groups from "Group ▾", the rest from the status line.
 */
export function openPart(label: string): void {
  const link = STATUS_LINK[label]
  if (link) {
    const line = screen.getByLabelText('Site structure status')
    fireEvent.click(within(line).getByRole('link', { name: link }))
    return
  }
  fireEvent.click(screen.getByRole('combobox', { name: 'Group' }))
  const list = screen.getByRole('listbox')
  fireEvent.click(within(list).getByRole('option', { name: new RegExp(`^${label}`) }))
}

const PART_ID: Readonly<Record<string, string>> = {
  Folders: 'folders',
  Clusters: 'clusters',
  Groups: 'groups',
  Sitemaps: 'sitemaps',
  'Last sync': 'sync',
  'CiteFox AI noticed': 'noticed'
}

/** Tests only. True once the part is the one shown. */
export function partShown(label: string): boolean {
  return document.querySelector(`.str-panel[data-part="${PART_ID[label] ?? label}"]`) !== null
}

/** Tests only. The toolbar is up (Site structure loaded). */
export async function findStructureToolbar(): Promise<HTMLElement> {
  return await screen.findByRole('combobox', { name: 'Group' })
}

/** Tests only. The status line's link of a part (Sitemaps, Last sync, CiteFox AI noticed). */
export function statusLink(label: string): HTMLElement {
  const line = screen.getByLabelText('Site structure status')
  return within(line).getByRole('link', { name: STATUS_LINK[label] ?? new RegExp(label) })
}
