declare module 'svg-to-pdfkit' {
  function SVGtoPDF(
    doc: import('pdfkit'),
    svg: string,
    x?: number,
    y?: number,
    options?: {
      width?: number
      height?: number
      preserveAspectRatio?: string
      assumePt?: boolean
      warningCallback?: (message: string) => void
      imageCallback?: (link: string) => string
      fontCallback?: (family: string, bold: boolean, italic: boolean) => string
    }
  ): void

  export default SVGtoPDF
}
