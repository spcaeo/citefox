/** Styles for the downloaded Impact review's extra parts and the little-data notes. */
export function impactCss(): string {
  return `/* Impact review extras */
.rv-meta { margin-top: 0; font-weight: 600; color: var(--ink-2); }
.rv-needs { border-color: var(--line-strong); }
.rv-needs-list { margin: 0 0 8px; padding-left: 20px; display: grid; gap: 6px; font-size: 14px; line-height: 22px; }
.rv-empty { color: var(--muted); }
.rv-glance { display: grid; gap: 6px; margin: 12px 0 0; padding: 12px 16px; border-radius: var(--radius); background: var(--surface-2); font-size: 13px; }
.rv-glance div { display: flex; justify-content: space-between; gap: 12px; }
.rv-glance dt { color: var(--muted); }
.rv-glance dd { margin: 0; font-weight: 600; text-align: right; }
.rv-story summary { cursor: pointer; font-size: 14px; line-height: 22px; }
.rv-story[open] summary { margin-bottom: 8px; }
.rv-outline-pair { margin: 12px 0 4px; }
.rv-outline { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; font-size: 13px; line-height: 19px; }
.rv-outline li { padding: 2px 8px; border-radius: 6px; }
.rv-outline-h3 { margin-left: 16px; color: var(--ink-2); }
.rv-outline-dropped { color: var(--r-not-cited); text-decoration: line-through; background: var(--surface-2); }
.rv-outline-added { color: var(--good); background: var(--surface-2); }
.rv-clean-ok { padding-left: 12px; border-left: 3px solid var(--good); }
.rv-clean-warn { padding-left: 12px; border-left: 3px solid var(--r-not-cited); }
.rv-hero .vd-badge { margin-left: 8px; vertical-align: middle; }
@media print { .rv-story { break-inside: avoid; } }
`
}
