/** The page asks for a notice with this event; `detail.reports` adds the samples link. */
export const DEMO_NOTICE_EVENT = 'citefox-demo-notice'

export function showDemoNotice(options: { reports?: boolean } = {}): void {
  window.dispatchEvent(new CustomEvent(DEMO_NOTICE_EVENT, { detail: options }))
}
