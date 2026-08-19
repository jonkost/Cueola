/* Cueola Script Operator preferences: section arranging + favorites.
 *
 * One engine shared by BOTH Script Operator surfaces — the built-in Live
 * sidebar (index.html, #lsOperatorDrawer) and the pop-out window
 * (script-operator.html, section.inspector) — so an order or a starred
 * control set once applies everywhere (localStorage is per-origin, and a
 * `storage` listener live-syncs open windows).
 *
 * Sections are discovered at runtime from the markup both surfaces already
 * share (.flow-control-section with a .flow-control-title, or
 * section.control-section with an <h2>): the slugged title is the stable id,
 * so the section builders need no authored ids and the two surfaces cannot
 * drift apart. Favorites key on the control's canonical action (the
 * sendPrompterControl action string on the built-in, data-action on the
 * pop-out), so starring Reset in one window stars it in the other.
 *
 * Arrange mode: the ⇅ button turns it on; sections grow move arrows, and
 * clicking any starrable control toggles its star instead of firing it (a
 * capture-phase listener stops the event before the control's own handler).
 * Favorites render as a quick-access chip row above the tabs; a chip fires
 * its source control's click, so dynamic bindings (Cue Now's re-baked row
 * number, Play/Pause) always run the current handler.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CueolaScriptOpPrefs = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ORDER_KEY = 'cueola_scriptop_section_order';   // { paneKey: [sectionId, ...] }
  var FAVS_KEY = 'cueola_scriptop_favs';             // [favKey, ...]

  var rootEl = null, quickRow = null, arranging = false, wired = false;

  function readJSON(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function writeJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} }
  function order() { var o = readJSON(ORDER_KEY, {}); return (o && typeof o === 'object') ? o : {}; }
  function favs() { var f = readJSON(FAVS_KEY, []); return Array.isArray(f) ? f : []; }

  function slug(text) { return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }

  // ── Discovery ──────────────────────────────────────────────────────────────
  function sections() {
    if (!rootEl) return [];
    return Array.prototype.slice.call(rootEl.querySelectorAll('.flow-control-section, section.control-section'));
  }
  function sectionId(sec) {
    if (sec.dataset.sopSec) return sec.dataset.sopSec;
    var title = sec.querySelector('.flow-control-title, h2');
    var id = slug(title && title.textContent);
    if (id) sec.dataset.sopSec = id;
    return id;
  }
  function paneKeyFor(sec) {
    var pane = sec.closest('[data-insp-pane],[data-pane]');
    var key = pane ? (pane.getAttribute('data-insp-pane') || pane.getAttribute('data-pane') || '') : '';
    if (key === 'clocks') key = 'clock';   // pop-out naming vs built-in naming
    return key;
  }

  // Toggle controls patch their action per state (slate_tech_on <-> _off);
  // a favorite must key on ONE stable form or the chip vanishes exactly when
  // the operator needs the reverse action.
  function canonicalAction(a) {
    return String(a).replace(/^(slate_tech|slate_bars|question)_(?:on|off)$/, '$1_on');
  }
  // Canonical favorite key for a control button, or null when un-starrable.
  // Built-in buttons carry inline onclick strings; pop-out buttons carry
  // data-* attributes — matching keys mean shared favorites across surfaces.
  function favKeyFor(btn) {
    if (!btn || btn.tagName !== 'BUTTON') return null;
    if (btn.closest('.sop-quick-row, .sop-sec-tools')) return null;
    if (btn.hasAttribute('data-hold-start') || btn.hasAttribute('onpointerdown')) return null;   // momentary holds
    if (btn.hasAttribute('data-prompter-play') || btn.id === 'playButton') return 'pc:playpause';
    if (btn.dataset.scriptOpCue) return 'cue:' + btn.dataset.scriptOpCue;
    if (btn.dataset.dynamicAction) return 'cue:' + String(btn.dataset.dynamicAction).replace(/^cue-/, '');
    if (btn.dataset.commandKind === 'control' && btn.dataset.action) return 'pc:' + canonicalAction(btn.dataset.action);
    if (btn.dataset.wrapMinutes) return 'pc:wrapup_' + (Number(btn.dataset.wrapMinutes) * 60 || 0);
    if (btn.hasAttribute('data-wrap-before')) return 'fmt:' + (btn.getAttribute('data-wrap-before') || '');
    if (btn.hasAttribute('data-insert')) return 'ins:' + (btn.getAttribute('data-insert') || '').trim();
    var oc = btn.getAttribute('onclick') || '';
    var m = oc.match(/^sendPrompterControl\('([^']+)'\)$/);
    if (m) return /^seek_row/.test(m[1]) ? null : (/^(pause|resume)$/.test(m[1]) ? 'pc:playpause' : 'pc:' + canonicalAction(m[1]));
    // Built-in toggles route through app functions; map them to the pop-out's
    // canonical keys so these favorites cross surfaces too.
    if (/^toggleTechDifficulty\(\)$/.test(oc)) return 'pc:slate_tech_on';
    if (/^toggleColorBars\(\)$/.test(oc)) return 'pc:slate_bars_on';
    if (/^toggleQuestionIndicator\('[^']*'\)$/.test(oc)) return 'pc:question_on';
    m = oc.match(/^sendWrapUp\('[^']*',\s*(\d+)\)$/);
    if (m) return 'pc:wrapup_' + (Number(m[1]) * 60);
    m = oc.match(/^wrapLivePanelSelection\('([^']*)'/);
    if (m) return 'fmt:' + m[1];
    m = oc.match(/^insertLivePanelMarker\('([^']*)'\)$/);
    if (m) return 'ins:' + m[1].replace(/\\n/g, '\n').trim();
    return null;
  }
  function findFavSource(key) {
    var all = rootEl ? rootEl.querySelectorAll('button') : [];
    for (var i = 0; i < all.length; i++) { if (favKeyFor(all[i]) === key) return all[i]; }
    return null;
  }
  function favLabel(btn) {
    var label = btn.getAttribute('aria-label') || btn.textContent || '';
    return label.replace(/\s+/g, ' ').trim().slice(0, 28);
  }

  // ── Section order ──────────────────────────────────────────────────────────
  function applyOrder() {
    if (!rootEl) return;
    var stored = order();
    var byParent = new Map();
    sections().forEach(function (sec) {
      var id = sectionId(sec); if (!id) return;
      var list = byParent.get(sec.parentElement);
      if (!list) { list = []; byParent.set(sec.parentElement, list); }
      list.push(sec);
    });
    byParent.forEach(function (list, parent) {
      if (list.length < 2) return;
      if (parent.contains(document.activeElement)) return;   // never yank focus
      var paneKey = paneKeyFor(list[0]);
      var want = stored[paneKey];
      if (!Array.isArray(want) || !want.length) return;
      var sorted = list.slice().sort(function (a, b) {
        var ia = want.indexOf(sectionId(a)), ib = want.indexOf(sectionId(b));
        if (ia < 0 && ib < 0) return 0;
        if (ia < 0) return 1;
        if (ib < 0) return -1;
        return ia - ib;
      });
      var changed = sorted.some(function (sec, i) { return sec !== list[i]; });
      if (!changed) return;
      sorted.forEach(function (sec) { parent.appendChild(sec); });
    });
  }
  function moveSection(sec, delta) {
    var parent = sec.parentElement;
    var siblings = Array.prototype.filter.call(parent.children, function (el) { return el.matches('.flow-control-section, section.control-section'); });
    var i = siblings.indexOf(sec), j = i + delta;
    if (i < 0 || j < 0 || j >= siblings.length) return;
    var other = siblings[j];
    parent.insertBefore(sec, delta < 0 ? other : other.nextSibling);
    var stored = order();
    var paneKey = paneKeyFor(sec);
    stored[paneKey] = Array.prototype.filter.call(parent.children, function (el) { return el.matches('.flow-control-section, section.control-section'); }).map(sectionId).filter(Boolean);
    writeJSON(ORDER_KEY, stored);
    decorateArrange();
  }

  // ── Favorites quick row ────────────────────────────────────────────────────
  function toggleFav(key) {
    var list = favs();
    var at = list.indexOf(key);
    if (at >= 0) list.splice(at, 1); else list.push(key);
    writeJSON(FAVS_KEY, list);
    sync();
  }
  function buildQuickRow() {
    if (!quickRow) return;
    // Rebuilds are triggered by clicks INSIDE the row (Arrange, chips), and a
    // clicked button holds focus — so instead of skipping the rebuild (which
    // left the row stale), remember the logical element and re-focus its
    // replacement.
    var focused = document.activeElement;
    var refocus = null;
    if (focused && quickRow.contains(focused)) {
      refocus = focused.dataset && focused.dataset.sopArrangeToggle ? '__arrange' : ((focused.dataset && focused.dataset.sopFav) || null);
    }
    var list = favs();
    var frag = document.createDocumentFragment();
    var star = document.createElement('span');
    star.className = 'sop-quick-star';
    star.textContent = '★';
    star.setAttribute('aria-hidden', 'true');
    frag.appendChild(star);
    var shown = 0;
    list.forEach(function (key) {
      var src = findFavSource(key);
      if (!src) return;   // this surface has no control for the key
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'sop-quick-chip';
      chip.dataset.sopFav = key;
      chip.disabled = src.disabled;
      chip.textContent = favLabel(src) || key;
      chip.setAttribute('aria-label', 'Favorite: ' + (favLabel(src) || key));
      frag.appendChild(chip);
      shown++;
    });
    if (!shown && !arranging) {
      var hint = document.createElement('span');
      hint.className = 'sop-quick-hint';
      hint.textContent = 'No favorites yet';
      frag.appendChild(hint);
    }
    var spacer = document.createElement('span');
    spacer.className = 'sop-quick-spacer';
    frag.appendChild(spacer);
    var arrange = document.createElement('button');
    arrange.type = 'button';
    arrange.className = 'sop-arrange-btn' + (arranging ? ' on' : '');
    arrange.dataset.sopArrangeToggle = '1';
    arrange.textContent = arranging ? 'Done' : 'Arrange';
    arrange.setAttribute('data-tip', arranging ? 'Finish arranging' : 'Reorder sections and star favorites');
    frag.appendChild(arrange);
    quickRow.replaceChildren(frag);
    quickRow.classList.toggle('sop-arranging', arranging);
    if (refocus) {
      var target = refocus === '__arrange'
        ? quickRow.querySelector('.sop-arrange-btn')
        : quickRow.querySelector('.sop-quick-chip[data-sop-fav="' + (window.CSS && CSS.escape ? CSS.escape(refocus) : refocus) + '"]');
      if (target) { try { target.focus(); } catch (e) {} }
    }
  }

  // ── Arrange mode ───────────────────────────────────────────────────────────
  function decorateArrange() {
    if (!rootEl) return;
    rootEl.classList.toggle('sop-arrange', arranging);
    // Star affordances live on data attributes; CSS shows them only while
    // arranging, so the passive surfaces stay untouched.
    var favSet = {};
    favs().forEach(function (k) { favSet[k] = true; });
    Array.prototype.forEach.call(rootEl.querySelectorAll('button'), function (btn) {
      var key = favKeyFor(btn);
      if (key) { btn.dataset.sopCanStar = '1'; btn.dataset.sopStarred = favSet[key] ? '1' : '0'; }
      else if (btn.dataset.sopCanStar) { delete btn.dataset.sopCanStar; delete btn.dataset.sopStarred; }
      // Disabled controls swallow clicks entirely, which would make them
      // un-starrable (a disconnected pop-out disables everything). Arrange
      // mode enables them — the capture listener already suppresses their
      // real actions — and hands truth back to the surface's patch cycle on
      // exit.
      if (arranging && key && btn.disabled) { btn.dataset.sopWasDisabled = '1'; btn.disabled = false; }
      else if (!arranging && btn.dataset.sopWasDisabled) { delete btn.dataset.sopWasDisabled; btn.disabled = true; }
    });
    // Per-section move arrows exist only during arrange mode.
    Array.prototype.forEach.call(rootEl.querySelectorAll('.sop-sec-tools'), function (el) { el.remove(); });
    if (!arranging) return;
    sections().forEach(function (sec) {
      if (!sectionId(sec)) return;
      var tools = document.createElement('div');
      tools.className = 'sop-sec-tools';
      tools.innerHTML = '<button type="button" data-sop-move="-1" aria-label="Move section up">↑</button>'
        + '<button type="button" data-sop-move="1" aria-label="Move section down">↓</button>';
      sec.insertBefore(tools, sec.firstChild);
    });
  }

  function onCaptureClick(event) {
    var t = event.target;
    var arrangeBtn = t.closest ? t.closest('[data-sop-arrange-toggle]') : null;
    if (arrangeBtn) {
      event.preventDefault(); event.stopPropagation();
      arranging = !arranging;
      decorateArrange(); buildQuickRow();
      return;
    }
    var chip = t.closest ? t.closest('.sop-quick-chip') : null;
    if (chip) {
      event.preventDefault(); event.stopPropagation();
      if (arranging) { toggleFav(chip.dataset.sopFav); return; }
      var src = findFavSource(chip.dataset.sopFav);
      if (src && !src.disabled) src.click();
      return;
    }
    if (!arranging) return;
    var mover = t.closest ? t.closest('[data-sop-move]') : null;
    if (mover) {
      event.preventDefault(); event.stopPropagation();
      var sec = mover.closest('.flow-control-section, section.control-section');
      if (sec) moveSection(sec, Number(mover.dataset.sopMove) || 0);
      return;
    }
    var btn = t.closest ? t.closest('button') : null;
    // Only controls INSIDE sections are intercepted while arranging — tabs,
    // editor actions, and window chrome keep working so the user can move
    // between panes mid-arrange.
    if (btn && rootEl.contains(btn) && btn.closest('.flow-control-section, section.control-section')) {
      var key = favKeyFor(btn);
      event.preventDefault(); event.stopPropagation();   // arranging: never fire controls
      if (key) { toggleFav(key); decorateArrange(); }
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  // init({ root, quickRowHost, before }): root holds the panes; the quick row
  // is inserted into quickRowHost (before `before` when given, else prepended).
  function init(opts) {
    rootEl = opts && opts.root || null;
    if (!rootEl) return;
    var host = (opts && opts.quickRowHost) || rootEl;
    quickRow = rootEl.querySelector('.sop-quick-row');
    if (!quickRow) {
      quickRow = document.createElement('div');
      quickRow.className = 'sop-quick-row';
      quickRow.setAttribute('aria-label', 'Favorite controls');
      var before = opts && opts.before || null;
      // Anchor on the reference node's own parent: the tabs strip need not be
      // a direct child of the root (the pop-out nests it).
      if (before && before.parentElement) before.parentElement.insertBefore(quickRow, before);
      else host.insertBefore(quickRow, host.firstChild || null);
    }
    if (!wired) {
      wired = true;
      document.addEventListener('click', onCaptureClick, true);
      window.addEventListener('storage', function (e) {
        if (e && (e.key === ORDER_KEY || e.key === FAVS_KEY)) sync();
      });
    }
    sync();
  }
  // sync(): idempotent; call after every render or snapshot patch. Applies the
  // stored section order and rebuilds the quick row from live source buttons.
  function sync() {
    if (!rootEl) return;
    applyOrder();
    decorateArrange();
    buildQuickRow();
  }
  function isArranging() { return arranging; }

  return { init: init, sync: sync, isArranging: isArranging, _favKeyFor: favKeyFor, _slug: slug };
});
