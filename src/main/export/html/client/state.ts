/**
 * The report's view state as plain ES2019 (no TypeScript syntax inside): the part of
 * the browser script that turns a view into `location.hash` and back, and keeps the
 * drawer's drill stack. It has no DOM access, so tests run it on its own with
 * `new Function(STATE_JS + 'return CFState;')`.
 *
 * A view is `{ s, d, f, g }`:
 * - `s`: the section in view (its anchor without `sec-`), or '' for the top;
 * - `d`: the drawer's drill stack, outermost first. Each entry is `kind:value`:
 *   `l:<drill token>` a counted list, `q:<row id>` one question's answer,
 *   `p:<page url>` a page's questions, `dom:<domain>` a site's questions,
 *   `find:<words>` a search;
 * - `f`: table filters, `{ tableId: words }`;
 * - `g`: segment chips, `{ tableId: value }`.
 *
 * The hash reads `#s=competition&d=dom%3Areddit.com&d=q%3Ar12&f=prompts%3Atwilio`.
 */
export const STATE_JS = String.raw`var CFState = (function () {
  var KINDS = ['l', 'q', 'p', 'dom', 'find'];
  var MAX_DEPTH = 12;

  function empty() { return { s: '', d: [], f: {}, g: {} }; }

  function kindOf(entry) {
    var text = String(entry || '');
    var at = text.indexOf(':');
    return at > 0 ? text.slice(0, at) : '';
  }
  function valueOf(entry) {
    var text = String(entry || '');
    var at = text.indexOf(':');
    return at > 0 ? text.slice(at + 1) : '';
  }
  function validEntry(entry) {
    return typeof entry === 'string' && KINDS.indexOf(kindOf(entry)) !== -1 && valueOf(entry) !== '';
  }

  function decodePart(text) {
    try { return decodeURIComponent(String(text).replace(/\+/g, ' ')); } catch (error) { return null; }
  }
  function encodePart(text) {
    return encodeURIComponent(String(text)).replace(/%3A/gi, ':').replace(/%2F/gi, '/');
  }

  function encode(view) {
    var parts = [];
    var v = view || empty();
    if (v.s) parts.push('s=' + encodePart(v.s));
    (v.d || []).forEach(function (entry) { if (validEntry(entry)) parts.push('d=' + encodePart(entry)); });
    Object.keys(v.f || {}).sort().forEach(function (id) {
      if (v.f[id]) parts.push('f=' + encodePart(id + ':' + v.f[id]));
    });
    Object.keys(v.g || {}).sort().forEach(function (id) {
      if (v.g[id]) parts.push('g=' + encodePart(id + ':' + v.g[id]));
    });
    return parts.length ? '#' + parts.join('&') : '';
  }

  /** A hash with no '=' is a plain anchor: '#sec-pages' reads as the pages section. */
  function decode(hash) {
    var view = empty();
    var text = String(hash || '').replace(/^#/, '');
    if (!text) return view;
    if (text.indexOf('=') === -1) {
      var anchor = decodePart(text) || '';
      if (/^sec-/.test(anchor)) view.s = anchor.slice(4);
      return view;
    }
    text.split('&').forEach(function (pair) {
      var at = pair.indexOf('=');
      if (at <= 0) return;
      var key = pair.slice(0, at);
      var value = decodePart(pair.slice(at + 1));
      if (value === null || value === '') return;
      if (key === 's') view.s = value.slice(0, 80);
      else if (key === 'd') { if (validEntry(value) && view.d.length < MAX_DEPTH) view.d.push(value); }
      else if (key === 'f' || key === 'g') {
        var split = value.indexOf(':');
        if (split <= 0 || split === value.length - 1) return;
        view[key][value.slice(0, split)] = value.slice(split + 1);
      }
    });
    return view;
  }

  /**
   * Opens an entry. From the page (inDrawer false) it starts a new stack. From the drawer
   * it goes one level deeper; an entry already on the stack jumps back to it instead, so
   * a loop (question -> site -> the same question) never grows the trail.
   */
  function push(stack, entry, inDrawer) {
    if (!validEntry(entry)) return stack.slice();
    if (!inDrawer) return [entry];
    var at = stack.indexOf(entry);
    if (at !== -1) return stack.slice(0, at + 1);
    var next = stack.concat([entry]);
    return next.length > MAX_DEPTH ? next.slice(next.length - MAX_DEPTH) : next;
  }
  function pop(stack) { return stack.slice(0, Math.max(0, stack.length - 1)); }
  /** Keeps the first n levels: a click on the trail. */
  function truncate(stack, n) { return stack.slice(0, Math.max(0, n)); }
  function same(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
    return true;
  }
  function withStack(view, stack) {
    return { s: view.s, d: stack.slice(), f: view.f, g: view.g };
  }

  return {
    empty: empty, encode: encode, decode: decode, push: push, pop: pop, truncate: truncate,
    same: same, withStack: withStack, kindOf: kindOf, valueOf: valueOf, validEntry: validEntry,
    MAX_DEPTH: MAX_DEPTH
  };
})();
`
