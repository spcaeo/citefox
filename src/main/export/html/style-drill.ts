/**
 * Styles for the drill-down drawer's steps (Back, the trail, Copy link, answer details,
 * cited sites), the open buttons inside tables, Copy all URLs, the "copied" toast and
 * the copy box. Same tokens as {@link reportCss}; appended after it.
 */
export function drillCss(): string {
  return `/* Drawer steps */
.drawer-head { align-items: center; }
.drawer-head [hidden], .trail[hidden] { display: none; }
.drawer-titles { min-width: 0; flex: 1 1 auto; }
.drawer-tools { flex-wrap: wrap; justify-content: flex-end; }
#drawer-title:focus, #drawer-title:focus-visible { outline: none; }
.back-btn { flex: none; padding: 0 12px 0 8px; }
.trail ol { list-style: none; margin: 0 0 4px; padding: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 2px 0; font-size: 12px; line-height: 18px; color: var(--faint); }
.trail li { display: inline-flex; align-items: center; min-width: 0; }
.trail li + li::before { content: "\\203A"; padding: 0 6px; color: var(--decor); }
.trail-btn { border: 0; background: none; padding: 0; font: inherit; color: var(--ink-2); cursor: pointer; text-decoration: underline; text-decoration-color: var(--line-strong); text-underline-offset: 3px; }
.trail-btn:hover { color: var(--accent-ink); text-decoration-color: currentColor; }
.trail [aria-current] { color: var(--ink); font-weight: 500; }
.drawer-body .dsub { font-size: 13px; line-height: 18px; font-weight: 600; margin: 20px 0 8px; color: var(--ink); }
.drawer-body .dsub:first-child { margin-top: 0; }
.q-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: var(--faint); font-size: 12px; margin: 0 0 12px; }
.q-facts .dstat-v { font-size: 16px; line-height: 24px; }
.answer { margin: 0; padding: 12px 16px; border-left: 3px solid var(--line-strong); background: var(--surface-2); border-radius: 0 var(--radius-s) var(--radius-s) 0; color: var(--ink-2); font-size: 13px; line-height: 20px; white-space: pre-line; }
.drill-links { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin: 0 0 12px; font-size: 13px; }
.drill-links .path { color: var(--faint); overflow-wrap: anywhere; }
.ext-link { font-weight: 500; color: var(--ink-2); }
.ref-title { display: block; color: var(--ink); }
.drawer-body .url, .drawer-body .url a { display: block; font-size: 12px; color: var(--faint); overflow-wrap: anywhere; }
.kind { display: inline-block; padding: 0 8px; border-radius: 999px; font-size: 12px; line-height: 20px; background: var(--track); color: var(--ink-2); white-space: nowrap; }
.kind-target, .kind-own { background: var(--accent-soft); color: var(--accent-ink); }
.kind-competitor { background: var(--warn-soft); color: var(--warn); }
.drawer-body tr[data-open] { cursor: pointer; }
.drawer-body tr[data-open]:hover td { background: var(--hover); }

/* Open buttons: text that opens the next step */
.open-btn { border: 0; background: none; padding: 0; margin: 0; font: inherit; color: inherit; text-align: left; cursor: pointer; text-decoration: underline; text-decoration-color: var(--line-strong); text-decoration-style: dotted; text-underline-offset: 3px; overflow-wrap: anywhere; }
.open-btn:hover { color: var(--accent-ink); text-decoration-color: currentColor; }
.open-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 3px; }
.drawer-table .open-btn.prompt-text { display: block; margin-bottom: 4px; font-weight: 500; }
.site-chip { display: inline-block; padding: 0 8px; margin: 2px 2px 0 0; border: 1px solid var(--line); border-radius: 999px; text-decoration: none; font-size: 12px; line-height: 20px; color: var(--ink-2); background: var(--surface); }
.site-chip:hover { border-color: var(--line-strong); }
html:not(.js) .open-btn { cursor: text; text-decoration: none; }

/* Copy all URLs above a table */
.urls-btn { height: 32px; padding: 0 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-s); background: var(--surface); font-size: 12px; font-weight: 500; cursor: pointer; color: var(--ink); }
.urls-btn:hover, .csv-btn:hover { background: var(--surface-2); }
html:not(.js) .urls-btn { display: none; }

/* Toast and copy box */
.toast { position: fixed; left: 50%; bottom: 24px; z-index: 60; transform: translate(-50%, 12px); opacity: 0; pointer-events: none; background: var(--spruce); color: #fff; padding: 8px 16px; border-radius: var(--radius-s); font-size: 13px; transition: opacity 160ms, transform 160ms; }
.toast.show { opacity: 1; transform: translate(-50%, 0); }
.toast:empty { display: none; }
.copy-box { position: fixed; left: 50%; bottom: 24px; z-index: 61; transform: translateX(-50%); width: min(560px, calc(100% - 32px)); background: var(--surface); border: 1px solid var(--line-strong); border-radius: var(--radius); box-shadow: var(--shadow-drawer); padding: 16px; display: grid; gap: 8px; }
.copy-box[hidden] { display: none; }
.copy-box-title { font-size: 13px; color: var(--ink-2); }
.copy-box textarea { width: 100%; font: 12px ui-monospace, Menlo, monospace; color: var(--ink); background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--radius-s); padding: 8px; resize: vertical; }
.copy-box .btn { justify-self: end; }
.copy-scratch { position: fixed; top: 0; left: 0; width: 1px; height: 1px; opacity: 0; }

@media (max-width: 640px) {
  .drawer-head { flex-wrap: wrap; }
  .drawer-tools { flex: 1 1 100%; justify-content: flex-start; }
}
@media print {
  body.drawer-open { overflow: visible !important; }
  .toast, .copy-box, .urls-btn, #copy-view { display: none !important; }
  .open-btn { text-decoration: none; color: inherit; }
}
`
}
