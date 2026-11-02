import { redactString } from '../../logging'
import { pdfFontCoverage, shapePdfText } from '../fonts'

/** Types and text helpers shared by every PDF renderer: logo, errors, and redacted text. */

export const LOGO_UNREADABLE = {
  reason: 'That logo could not be read.',
  nextStep: 'Choose a PNG, JPG, or SVG image and try again.'
}

export type PdfLogo = { kind: 'png' | 'jpeg'; bytes: Buffer } | { kind: 'svg'; text: string }

export class PdfReportError extends Error {
  readonly nextStep: string

  constructor(reason: string, nextStep: string) {
    super(reason)
    this.name = 'PdfReportError'
    this.nextStep = nextStep
  }
}

export interface Speech {
  secrets: readonly string[]
  replaced: number
  /**
   * Fits text to the output. The PDF replaces characters its fonts lack.
   * HTML passes text through unchanged. Defaults to the PDF fonts.
   */
  shape?: (text: string) => { text: string; replaced: number }
}

/** Redacts secrets, then fits the text to the fonts. Replaced characters are counted. */
export function speak(value: string, speech: Speech): string {
  const redacted = redactString(value, { secrets: speech.secrets, hexKeys: false })
  const safe =
    speech.shape === undefined ? shapePdfText(redacted, pdfFontCoverage()) : speech.shape(redacted)
  speech.replaced += safe.replaced
  return safe.text
}

export function metadataText(value: string): string {
  return value.replace(/[&<>]/g, ' ').slice(0, 240)
}
