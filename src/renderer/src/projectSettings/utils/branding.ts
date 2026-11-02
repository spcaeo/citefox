import type { ReportBrandingRequest } from '@shared/ipc'
import type { ReportBranding } from '@shared/report/review/extras'

/** Where Project settings › Reports reads and saves the "Prepared for" line. */
export interface BrandingClient {
  get(projectId: string): Promise<ReportBranding>
  set(request: ReportBrandingRequest): Promise<ReportBranding>
}

export function createLiveBrandingClient(): BrandingClient {
  return {
    async get(projectId) {
      const api = window.citefox
      if (!api) throw new Error('The preload bridge is missing.')
      return api['reports:getBranding']({ projectId })
    },
    async set(request) {
      const api = window.citefox
      if (!api) throw new Error('The preload bridge is missing.')
      return api['reports:setBranding'](request)
    }
  }
}

const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])

/** Reads a picked logo as a data URL, or says why it cannot be used. */
export async function readLogo(
  file: Pick<File, 'type' | 'size'> & Blob,
  max: number
): Promise<{ ok: true; dataUrl: string } | { ok: false; reason: string }> {
  if (!TYPES.has(file.type)) return { ok: false, reason: 'Pick a PNG, JPG, WebP or SVG image.' }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('Could not read the image.'))
    reader.readAsDataURL(file)
  })
  if (dataUrl.length > max)
    return { ok: false, reason: 'That image is too big. Use one under 150 KB.' }
  return { ok: true, dataUrl }
}
