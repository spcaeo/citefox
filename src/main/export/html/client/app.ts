import { createHash } from 'node:crypto'
import { CSV_JS } from './csv'
import { PANEL_JS } from './panel'
import { STATE_JS } from './state'

/**
 * The page glue of the report's browser script: drawer, drill stack, links, search,
 * focus mode, per-table CSV, Copy all URLs, table expansion, sorting and filters.
 * Plain ES2019 with no TypeScript syntax inside.
 *
 * Every view has an address: the section in view, the table filters and the drawer's
 * drill stack live in `location.hash` (see ./state). Each drawer step is a history
 * entry, so the browser's Back and Forward walk through the steps, and opening the file
 * with a copied address shows the same view. Everything it inserts passes `esc()`,
 * links are built only for http(s), and it makes no network request.
 */
const APP_JS = String.raw`
  var doc = document;
  doc.documentElement.classList.add('js');
  var DATA = {};
  try {
    var dataEl = doc.getElementById('report-data');
    DATA = JSON.parse(dataEl ? dataEl.textContent || '{}' : '{}');
  } catch (error) {
    DATA = {};
  }
  var tables = DATA.tables || {};
  var labels = {};
  Array.prototype.forEach.call(doc.querySelectorAll('button.drill'), function (b) {
    var token = b.getAttribute('data-drill') || '';
    if (token && !labels[token]) labels[token] = b.getAttribute('data-label') || '';
  });
  /** The engine view on screen in a ready report (its engine switch), else null. */
  function viewNow() {
    var on = doc.querySelector('[data-switch="engine"][aria-pressed="true"]');
    return on ? on.getAttribute('data-value') : null;
  }
  var panel = CFPanel(DATA, function (token) { return labels[token] || ''; }, viewNow);
  var esc = panel.esc;
  function plural(n, word) { return n + ' ' + (n === 1 ? word : word + 's'); }
  function each(selector, fn) { Array.prototype.forEach.call(doc.querySelectorAll(selector), fn); }

  /* Elements */
  var app = doc.getElementById('app');
  var main = doc.getElementById('main');
  var drawer = doc.getElementById('drawer');
  var scrim = doc.getElementById('scrim');
  var drawerTitle = doc.getElementById('drawer-title');
  var drawerSub = doc.getElementById('drawer-sub');
  var drawerBody = doc.getElementById('drawer-body');
  var drawerClose = doc.getElementById('drawer-close');
  var drawerBack = doc.getElementById('drawer-back');
  var drawerTrail = doc.getElementById('drawer-trail');
  var drawerUrls = doc.getElementById('drawer-urls');
  var toastEl = doc.getElementById('toast');
  var copyBox = doc.getElementById('copy-box');
  var copyText = doc.getElementById('copy-text');

  /* View state: what is on screen. view.d is the drill stack. */
  var view = CFState.empty();
  var cache = {};
  var opener = null;
  var current = null;

  function resolve(entry) {
    if (!Object.prototype.hasOwnProperty.call(cache, entry)) cache[entry] = panel.resolve(entry);
    return cache[entry];
  }

  /* Address */
  function baseUrl() { return String(location.href).split('#')[0]; }
  function addressNow() { return baseUrl() + CFState.encode(view); }
  function writeUrl(mode) {
    var hash = CFState.encode(view);
    if (hash === (location.hash || '')) return;
    var url = baseUrl() + hash;
    try {
      if (mode === 'push') history.pushState({ cf: 1 }, '', url);
      else history.replaceState({ cf: 1 }, '', url);
    } catch (error) {
      try {
        if (mode === 'push') location.hash = hash || '#';
        else location.replace(url);
      } catch (ignored) { /* the view still works without its address */ }
    }
  }

  /* Drawer */
  function focusTarget(entry) {
    if (entry) {
      var buttons = drawerBody.querySelectorAll('button[data-open]');
      for (var i = 0; i < buttons.length; i += 1) {
        if (buttons[i].getAttribute('data-open') === entry) return buttons[i];
      }
    }
    return drawerTitle;
  }

  function renderTrail(levels) {
    if (!drawerTrail) return;
    if (levels.length < 2) { drawerTrail.hidden = true; drawerTrail.innerHTML = ''; return; }
    drawerTrail.hidden = false;
    drawerTrail.innerHTML = '<ol>' + levels.map(function (level, index) {
      var text = esc(panel.shortTitle(level.title));
      if (index === levels.length - 1) return '<li><span aria-current="page">' + text + '</span></li>';
      return '<li><button type="button" class="trail-btn" data-trail="' + (index + 1) + '">' + text + '</button></li>';
    }).join('') + '</ol>';
  }

  /** Shows the stack (outermost first). Entries that no longer match anything are dropped. */
  function showStack(stack, focusEntry) {
    var levels = [];
    var kept = [];
    stack.forEach(function (entry) {
      var level = resolve(entry);
      if (level) { levels.push(level); kept.push(entry); }
    });
    view.d = kept;
    if (!drawer) return;
    if (!kept.length) { hideDrawer(); return; }
    var wasHidden = drawer.hidden;
    if (wasHidden) {
      var active = doc.activeElement;
      if (!opener || !doc.contains(opener)) opener = active && active !== doc.body ? active : null;
    }
    current = levels[levels.length - 1];
    drawerTitle.textContent = current.title;
    drawerSub.textContent = current.sub;
    drawerBody.innerHTML = current.html;
    drawerBody.scrollTop = 0;
    if (drawerBack) drawerBack.hidden = kept.length < 2;
    if (drawerUrls) drawerUrls.hidden = CFCsv.urls(current.urls).length === 0;
    renderTrail(levels);
    scrim.hidden = false;
    drawer.hidden = false;
    doc.body.classList.add('drawer-open');
    if (app) app.setAttribute('inert', '');
    var target = focusTarget(focusEntry);
    if (target && typeof target.focus === 'function') target.focus();
  }

  function hideDrawer() {
    current = null;
    if (!drawer || drawer.hidden) return;
    drawer.hidden = true;
    scrim.hidden = true;
    doc.body.classList.remove('drawer-open');
    if (app) app.removeAttribute('inert');
    var target = opener && doc.contains(opener) ? opener : main;
    opener = null;
    if (target && typeof target.focus === 'function') target.focus();
  }

  /** Every drawer step is a history entry: Back and Forward walk through them. */
  function go(entry, inDrawer, from) {
    if (!inDrawer && from) opener = from;
    var next = CFState.push(view.d, entry, inDrawer);
    if (CFState.same(next, view.d)) return;
    showStack(next, null);
    writeUrl('push');
  }
  function popLevel() {
    if (!view.d.length) return;
    var popped = view.d[view.d.length - 1];
    showStack(CFState.pop(view.d), popped);
    writeUrl('push');
  }
  function closeAll() {
    if (!view.d.length) return;
    showStack([], null);
    writeUrl('push');
  }
  function toTrail(n) {
    var next = CFState.truncate(view.d, n);
    if (CFState.same(next, view.d)) return;
    var popped = view.d[n];
    showStack(next, popped);
    writeUrl('push');
  }

  function focusables() {
    return Array.prototype.slice.call(drawer.querySelectorAll(
      'button, [href], input, summary, [tabindex]:not([tabindex="-1"])'
    )).filter(function (el) { return el === drawerClose || (!el.disabled && !el.hidden && el.offsetParent !== null); });
  }
  if (drawer) {
    drawer.addEventListener('keydown', function (event) {
      if (event.key !== 'Tab') return;
      var items = focusables();
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      var active = doc.activeElement;
      if (event.shiftKey && (active === first || active === drawerTitle)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    });
  }

  /* Copy: the clipboard when allowed, else a box with the text selected */
  var toastTimer = null;
  function toast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2400);
  }
  var copyReturn = null;
  function showCopyBox(text) {
    if (!copyBox || !copyText) return;
    copyReturn = doc.activeElement;
    copyText.value = text;
    copyBox.hidden = false;
    copyText.focus();
    copyText.select();
  }
  function hideCopyBox() {
    if (!copyBox || copyBox.hidden) return false;
    copyBox.hidden = true;
    if (copyReturn && typeof copyReturn.focus === 'function') copyReturn.focus();
    copyReturn = null;
    return true;
  }
  function copy(text, message, done) {
    function fallback() {
      var back = doc.activeElement;
      var ok = false;
      try {
        var area = doc.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.className = 'copy-scratch';
        (drawer && !drawer.hidden ? drawer : doc.body).appendChild(area);
        area.select();
        ok = typeof doc.execCommand === 'function' && doc.execCommand('copy');
        area.remove();
      } catch (error) {
        ok = false;
      }
      if (back && typeof back.focus === 'function') back.focus();
      if (ok) { toast(message); if (done) done(); } else showCopyBox(text);
    }
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(function () { toast(message); if (done) done(); }, fallback);
        return;
      }
    } catch (error) { /* fall through */ }
    fallback();
  }
  /* Copy and Open on a value (html/copy.ts): a green tick for 1.5 s, then the icons hide
     until the pointer or focus leaves the value */
  function settleCopy(wrap) {
    wrap.classList.add('cp-hide');
    function back() {
      wrap.classList.remove('cp-hide');
      wrap.removeEventListener('mouseleave', back);
      wrap.removeEventListener('focusout', back);
    }
    wrap.addEventListener('mouseleave', back);
    wrap.addEventListener('focusout', back);
  }
  function copyValue(button) {
    var wrap = button.closest('.cp');
    copy(button.getAttribute('data-copy') || '', 'Copied', function () {
      if (!wrap) return;
      wrap.classList.add('cp-done');
      setTimeout(function () { wrap.classList.remove('cp-done'); settleCopy(wrap); }, 1500);
    });
  }

  /* CSV */
  function downloadCsv(name, columns, values) {
    var blob = new Blob(['\ufeff' + CFCsv.text(columns, values)], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.hidden = true;
    doc.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /* Tables */
  function setExpanded(wrap, expanded) {
    wrap.classList.toggle('collapsed', !expanded);
    var button = wrap.querySelector('.show-all');
    var text = wrap.querySelector('.showing-text');
    var total = wrap.querySelectorAll('tbody tr').length;
    var limit = Number(wrap.getAttribute('data-limit')) || total;
    if (button) {
      button.textContent = expanded ? 'Show fewer' : 'Show all';
      button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }
    if (text) text.textContent = 'Showing ' + (expanded ? total : Math.min(limit, total)) + ' of ' + total;
  }

  function sortBy(button) {
    var th = button.closest('th');
    var table = button.closest('table');
    var wrap = button.closest('[data-table-wrap]');
    if (!th || !table) return;
    var column = Number(button.getAttribute('data-col'));
    var direction = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
    Array.prototype.forEach.call(table.querySelectorAll('th'), function (cell) { cell.removeAttribute('aria-sort'); });
    th.setAttribute('aria-sort', direction);
    var body = table.querySelector('tbody');
    if (!body) return;
    var list = Array.prototype.slice.call(body.children);
    function key(row) {
      var cell = row.children[column];
      return cell ? cell.getAttribute('data-sort') || '' : '';
    }
    list.sort(function (a, b) {
      var x = key(a), y = key(b);
      if (x === '' && y !== '') return 1;
      if (y === '' && x !== '') return -1;
      var nx = Number(x), ny = Number(y);
      var result = !isNaN(nx) && !isNaN(ny) && x !== '' && y !== '' ? nx - ny : x.localeCompare(y);
      return direction === 'ascending' ? result : -result;
    });
    var limit = wrap ? Number(wrap.getAttribute('data-limit')) || list.length : list.length;
    list.forEach(function (row, index) {
      row.classList.toggle('extra', index >= limit);
      body.appendChild(row);
    });
  }

  function wrapFor(id) {
    var found = null;
    each('[data-table-wrap]', function (wrap) { if (!found && wrap.getAttribute('data-table-wrap') === id) found = wrap; });
    return found;
  }

  function filterTable(input) {
    var id = input.getAttribute('data-filter') || '';
    var wrap = wrapFor(id);
    if (!wrap) return;
    var query = input.value.trim().toLowerCase();
    var list = wrap.querySelectorAll('tbody tr');
    var shown = 0;
    Array.prototype.forEach.call(list, function (row) {
      var match = query === '' || row.textContent.toLowerCase().indexOf(query) !== -1;
      row.hidden = !match;
      if (match) shown += 1;
    });
    wrap.classList.toggle('filtering', query !== '');
    var text = wrap.querySelector('.showing-text');
    if (query !== '' && text) text.textContent = shown + ' of ' + list.length + ' match';
    else setExpanded(wrap, !wrap.classList.contains('collapsed'));
    if (query) view.f[id] = input.value.trim(); else delete view.f[id];
  }

  /* Segment chips: show only the rows whose data-seg matches; an empty value shows all */
  function segment(button) {
    var id = button.getAttribute('data-seg-table') || '';
    var value = button.getAttribute('data-seg-value') || '';
    each('[data-seg-table]', function (chip) {
      if (chip.getAttribute('data-seg-table') === id) chip.setAttribute('aria-pressed', chip === button ? 'true' : 'false');
    });
    if (value) view.g[id] = value; else delete view.g[id];
    var wrap = wrapFor(id);
    if (!wrap) return;
    var list = wrap.querySelectorAll('tbody tr');
    var shown = 0;
    Array.prototype.forEach.call(list, function (row) {
      var match = value === '' || row.getAttribute('data-seg') === value;
      row.hidden = !match;
      if (match) shown += 1;
    });
    wrap.classList.toggle('filtering', value !== '');
    var text = wrap.querySelector('.showing-text');
    if (value !== '' && text) text.textContent = shown + ' of ' + list.length + ' match';
    else setExpanded(wrap, !wrap.classList.contains('collapsed'));
  }

  /** Puts filters and segment chips back the way an address describes them. */
  function applyFilters(next) {
    each('[data-filter]', function (input) {
      var id = input.getAttribute('data-filter') || '';
      var want = next.f[id] || '';
      if (input.value !== want) { input.value = want; filterTable(input); }
    });
    var groups = {};
    each('[data-seg-table]', function (chip) {
      var id = chip.getAttribute('data-seg-table') || '';
      var value = chip.getAttribute('data-seg-value') || '';
      if (!groups[id]) groups[id] = { all: null, pick: null };
      if (value === '') groups[id].all = chip;
      if (next.g[id] === value) groups[id].pick = chip;
    });
    Object.keys(groups).forEach(function (id) {
      var chip = groups[id].pick || groups[id].all;
      var pressed = chip && chip.getAttribute('aria-pressed') === 'true';
      if (chip && !pressed) segment(chip);
    });
  }

  /* Search */
  var search = doc.getElementById('search');
  var searchStatus = doc.getElementById('search-status');
  if (search) {
    search.addEventListener('input', function () {
      var query = search.value.trim();
      if (!searchStatus) return;
      if (!query) { searchStatus.textContent = ''; return; }
      var count = panel.search(query).length;
      searchStatus.textContent = count ? plural(count, 'question') + ' match. Press Enter to see them.' : 'No questions match.';
    });
    search.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        var query = search.value.trim();
        if (query) go('find:' + query, false, search);
      } else if (event.key === 'Escape' && search.value) {
        event.stopPropagation();
        search.value = '';
        if (searchStatus) searchStatus.textContent = '';
      }
    });
  }

  /* Switches: buttons with data-switch show the panels of their group with the same value */
  /** A table's topic picker: rows of other topics step aside (class tp-off), other filters still apply. */
  function topicFilter(select) {
    var wrap = wrapFor(select.getAttribute('data-topic-table') || '');
    if (!wrap) return;
    var value = select.value;
    Array.prototype.forEach.call(wrap.querySelectorAll('tbody tr'), function (row) {
      row.classList.toggle('tp-off', value !== '' && row.getAttribute('data-topic') !== value);
    });
    wrap.classList.toggle('filtering', value !== '' || wrap.classList.contains('filtering'));
  }

  /** A change tab inside a drawer list (All, Gained, Kept, Lost, Not cited) shows only its rows. */
  function drawerTab(button) {
    var tab = button.getAttribute('data-dtab') || 'all';
    var box = button.closest('.drawer-body') || drawerBody;
    if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll('[data-dtab]'), function (item) {
      item.setAttribute('aria-pressed', item === button ? 'true' : 'false');
    });
    Array.prototype.forEach.call(box.querySelectorAll('tr[data-row-id]'), function (row) {
      row.hidden = tab !== 'all' && row.getAttribute('data-chg') !== tab;
    });
  }

  function switchTo(button) {
    var group = button.getAttribute('data-switch') || '';
    var value = button.getAttribute('data-value') || '';
    Array.prototype.forEach.call(doc.querySelectorAll('[data-switch="' + group + '"]'), function (item) {
      item.setAttribute('aria-pressed', item.getAttribute('data-value') === value ? 'true' : 'false');
    });
    Array.prototype.forEach.call(doc.querySelectorAll('[data-switch-panel="' + group + '"]'), function (panel) {
      panel.hidden = panel.getAttribute('data-value') !== value;
    });
    // A search list belongs to the view it was made in.
    if (group === 'engine') cache = {};
  }
  /* Chart marks (shared SVG builders) open the rows behind them */
  function openMark(mark, inDrawer) {
    var token = mark.getAttribute('data-drill') || '';
    var label = mark.getAttribute('aria-label') || '';
    if (label && labels[token] !== label) { labels[token] = label; delete cache['l:' + token]; }
    go('l:' + token, !!inDrawer, mark);
  }
  doc.addEventListener('keydown', function (event) {
    var target = event.target;
    if ((event.key === 'Enter' || event.key === ' ') && target instanceof Element && target.matches('g[data-drill]')) {
      event.preventDefault();
      openMark(target, !!(drawer && drawer.contains(target)));
    }
  });

  /* Clicks */
  doc.addEventListener('click', function (event) {
    var target = event.target;
    if (!(target instanceof Element)) return;
    var inDrawer = !!(drawer && drawer.contains(target));
    var mark = target.closest('g[data-drill]');
    if (mark) { openMark(mark, inDrawer); return; }
    var button = target.closest('button');
    if (button) {
      if (button.classList.contains('cp-copy')) { copyValue(button); return; }
      if (button.classList.contains('drill')) {
        var token = button.getAttribute('data-drill') || '';
        var label = button.getAttribute('data-label') || '';
        // The same list can sit behind numbers with different wording: use the clicked one.
        if (label && labels[token] !== label) { labels[token] = label; delete cache['l:' + token]; }
        go('l:' + token, inDrawer, button);
        return;
      }
      if (button.hasAttribute('data-open')) { go(button.getAttribute('data-open') || '', inDrawer, button); return; }
      if (button.hasAttribute('data-row')) { go('q:' + (button.getAttribute('data-row') || ''), inDrawer, button); return; }
      if (button.hasAttribute('data-trail')) { toTrail(Number(button.getAttribute('data-trail'))); return; }
      if (button.classList.contains('show-all')) {
        var wrap = button.closest('[data-table-wrap]');
        if (wrap) setExpanded(wrap, wrap.classList.contains('collapsed'));
        return;
      }
      if (button.classList.contains('csv-btn')) {
        var id = button.getAttribute('data-table') || '';
        var data = tables[id];
        if (data) downloadCsv(CFCsv.fileName(DATA.file, id), data.columns, data.rows);
        return;
      }
      if (button.classList.contains('urls-btn')) {
        var listed = CFCsv.urls((tables[button.getAttribute('data-table') || ''] || {}).urls);
        if (listed.length) copy(listed.join('\n'), plural(listed.length, 'URL') + ' copied');
        return;
      }
      if (button.classList.contains('sort')) { sortBy(button); return; }
      if (button.hasAttribute('data-dtab')) { drawerTab(button); return; }
      if (button.hasAttribute('data-seg-table')) { segment(button); writeUrl('replace'); return; }
      if (button.hasAttribute('data-switch')) { switchTo(button); return; }
      if (button.id === 'drawer-close') { closeAll(); return; }
      if (button.id === 'drawer-back') { popLevel(); return; }
      if (button.id === 'drawer-csv') {
        if (current) downloadCsv(CFCsv.fileName(DATA.file, current.title), current.csv.columns, current.csv.rows);
        return;
      }
      if (button.id === 'drawer-urls') {
        var urls = current ? CFCsv.urls(current.urls) : [];
        if (urls.length) copy(urls.join('\n'), plural(urls.length, 'URL') + ' copied');
        return;
      }
      if (button.id === 'drawer-link' || button.id === 'copy-view') { copy(addressNow(), 'Link copied'); return; }
      if (button.id === 'copy-done') { hideCopyBox(); return; }
      if (button.id === 'focus-toggle') {
        var on = !doc.body.classList.contains('focus-mode');
        doc.body.classList.toggle('focus-mode', on);
        button.setAttribute('aria-pressed', on ? 'true' : 'false');
        return;
      }
      if (button.id === 'theme-toggle') {
        var dark = doc.documentElement.getAttribute('data-theme') !== 'dark';
        if (dark) doc.documentElement.setAttribute('data-theme', 'dark');
        else doc.documentElement.removeAttribute('data-theme');
        button.setAttribute('aria-pressed', dark ? 'true' : 'false');
        return;
      }
      if (button.id === 'print-btn') { window.print(); return; }
      return;
    }
    if (target === scrim) { closeAll(); return; }
    var openIcon = target.closest('a.cp-open');
    if (openIcon) {
      var openWrap = openIcon.closest('.cp');
      if (openWrap) settleCopy(openWrap);
      return;
    }
    if (target.closest('a, summary, details, input, textarea')) {
      var navLink = target.closest('a[data-target]');
      if (navLink) jumpTo(navLink.getAttribute('data-target') || '', event);
      return;
    }
    var openRow = inDrawer ? target.closest('tr[data-open]') : null;
    if (openRow) { go(openRow.getAttribute('data-open') || '', true, null); return; }
    var barRow = target.closest('.bar-row, .opp-row');
    if (barRow) {
      var first = barRow.querySelector('button.drill');
      if (first) first.click();
    }
  });

  doc.addEventListener('input', function (event) {
    var target = event.target;
    if (target instanceof Element && target.hasAttribute('data-filter')) { filterTable(target); writeUrl('replace'); }
    if (target instanceof Element && target.hasAttribute('data-topic-table')) topicFilter(target);
  });

  doc.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      if (hideCopyBox()) return;
      popLevel();
      return;
    }
    if (event.key === '/' && search && (!drawer || drawer.hidden)) {
      var active = doc.activeElement;
      var typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
      if (!typing) { event.preventDefault(); search.focus(); }
    }
  });

  /* Sections: the nav jumps without leaving the address format; scroll-spy keeps s current */
  function sectionKey(anchor) { return /^sec-/.test(anchor) ? anchor.slice(4) : ''; }
  function scrollToId(id) {
    var el = id ? doc.getElementById(id) : null;
    if (!el) return false;
    try { el.scrollIntoView({ block: 'start', behavior: 'instant' }); } catch (error) { el.scrollIntoView(); }
    return true;
  }
  function jumpTo(id, event) {
    if (!doc.getElementById(id)) return;
    if (event) event.preventDefault();
    scrollToId(id);
  }

  var links = Array.prototype.slice.call(doc.querySelectorAll('.nav a[data-target]'));
  var targets = links.map(function (anchor) {
    return { link: anchor, el: doc.getElementById(anchor.getAttribute('data-target') || ''), level: anchor.getAttribute('data-level') };
  }).filter(function (item) { return item.el; });
  var ticking = false;
  var spyReady = false;
  function spy() {
    ticking = false;
    var offset = 110;
    var section = null, sub = null;
    targets.forEach(function (item) {
      if (item.el.getBoundingClientRect().top - offset <= 0) {
        if (item.level === '1') { section = item; sub = null; } else sub = item;
      }
    });
    if (!section && targets.length) section = targets[0];
    targets.forEach(function (item) {
      var active = item === section || item === sub;
      item.link.classList.toggle('active', active);
      if (active) item.link.setAttribute('aria-current', 'true'); else item.link.removeAttribute('aria-current');
    });
    if (!spyReady || view.d.length) return;
    var first = targets.length ? targets[0] : null;
    var key = section && section !== first ? sectionKey(section.el.id) : '';
    if (key !== view.s) { view.s = key; writeUrl('replace'); }
  }
  window.addEventListener('scroll', function () {
    if (!ticking) { ticking = true; window.requestAnimationFrame(spy); }
  }, { passive: true });

  /** The address changed under us (browser Back/Forward, an edited address, a plain anchor). */
  function applyLocation() {
    var hash = location.hash || '';
    var plain = hash.length > 1 && hash.indexOf('=') === -1;
    var next = CFState.decode(hash);
    if (plain) {
      if (next.s) view.s = next.s;
      return;
    }
    view.s = next.s;
    applyFilters(next);
    if (!CFState.same(next.d, view.d)) {
      var popped = next.d.length < view.d.length ? view.d[next.d.length] : null;
      showStack(next.d, popped);
    }
  }
  window.addEventListener('popstate', applyLocation);
  window.addEventListener('hashchange', applyLocation);

  /* Opening the file with an address restores that view */
  (function restore() {
    var start = CFState.decode(location.hash || '');
    applyFilters(start);
    view.s = start.s;
    if (start.s) scrollToId('sec-' + start.s);
    if (start.d.length) {
      var head = CFState.kindOf(start.d[0]) === 'l' ? CFState.valueOf(start.d[0]) : '';
      each('button.drill', function (b) { if (!opener && head && b.getAttribute('data-drill') === head) opener = b; });
      showStack(start.d, null);
    }
    spy();
    spyReady = true;
    if (location.hash && location.hash.indexOf('=') !== -1) writeUrl('replace');
  })();

  /* Print: every row shows; the drawer and buttons are hidden by the print styles */
  var printExpanded = [];
  window.addEventListener('beforeprint', function () {
    each('[data-table-wrap].collapsed', function (wrap) {
      printExpanded.push(wrap);
      setExpanded(wrap, true);
    });
  });
  window.addEventListener('afterprint', function () {
    printExpanded.forEach(function (wrap) { setExpanded(wrap, false); });
    printExpanded = [];
  });
`

/**
 * The HTML report's browser script, as one string: the view state, CSV, drawer views
 * and page glue, wrapped in one function. The page's CSP allows only this exact text,
 * by its SHA-256 ({@link CLIENT_SCRIPT_HASH}).
 */
export const CLIENT_SCRIPT = `(function () {\n  'use strict';\n${STATE_JS}${CSV_JS}${PANEL_JS}${APP_JS}})();\n`

/** `sha256-…` source for the CSP `script-src`, over {@link CLIENT_SCRIPT} exactly. */
export const CLIENT_SCRIPT_HASH = createHash('sha256')
  .update(CLIENT_SCRIPT, 'utf8')
  .digest('base64')
