/* Cueola shared keycommand engine (v2.1 Phase 13 · D11.1).
 *
 * One engine, every surface. Each surface (Cueola live/build, the Script
 * Operator window, Outrangutan, dashboard) registers its own action table and
 * keeps its own dispatch policy; this module owns the mechanics that must
 * never drift between surfaces:
 *
 *   - binding grammar + event matching ("Shift+S", "Alt+ArrowUp", "Space", "?")
 *   - per-action overrides from localStorage (cueola_keymap)
 *   - hold-key tracking with blur safety (a held Brake/Boost key must release
 *     its stop control when focus leaves — losing the window mid-hold must
 *     never leave the prompter braking)
 *   - the "?" reference overlay HTML, generated from the registered table so
 *     documentation cannot drift from behavior
 *
 * Dependency-free; DOM only inside referenceHTML consumers.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CueolaKeymap = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var STORAGE_KEY = 'cueola_keymap';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Effective bindings = the action's defaults overridden per action id.
  function effectiveBindings(action, storage) {
    try {
      var raw = (storage || (typeof localStorage !== 'undefined' ? localStorage : null))?.getItem(STORAGE_KEY);
      var overrides = JSON.parse(raw || '{}');
      if (Array.isArray(overrides[action.id]) && overrides[action.id].length) return overrides[action.id];
    } catch (e) { /* malformed overrides fall back to defaults */ }
    return action.keys;
  }

  // "Shift+S" / "Alt+ArrowUp" / "Space" / "?" → match against a keyboard event.
  // Letters compare case-insensitively with an exact shift requirement;
  // punctuation (?, =, [ …) matches e.key directly, so layouts that need
  // Shift still work.
  function matches(e, binding) {
    var parts = String(binding).split('+');
    var base = parts.pop();
    var mods = parts.map(function (p) { return p.toLowerCase(); });
    if (Boolean(e.altKey) !== mods.includes('alt')) return false;
    if (e.ctrlKey || e.metaKey) return false;
    var key = e.key === ' ' ? 'Space' : e.key;
    if (/^[a-z]$/i.test(base)) {
      if (key.toLowerCase() !== base.toLowerCase()) return false;
      return Boolean(e.shiftKey) === mods.includes('shift');
    }
    if (mods.includes('shift') && !e.shiftKey) return false;
    return key === base;
  }

  function actionMatches(action, e, storage) {
    return effectiveBindings(action, storage).some(function (b) { return matches(e, b); });
  }

  // Hold-key tracking (Brake/Boost). `send` delivers the start/stop control on
  // the owning surface's channel. releaseAll() is the blur-safety hook — wire
  // it to window blur AND any dispatch-blocked path.
  function createHoldTracker(send) {
    if (typeof send !== 'function') throw new Error('Hold tracker needs a send function');
    var holds = new Map();   // action.id → stop control
    return {
      size: function () { return holds.size; },
      has: function (id) { return holds.has(id); },
      down: function (action, e) {
        if (!action.hold) return false;
        if (e && e.repeat) return true;
        if (!holds.has(action.id)) {
          holds.set(action.id, action.hold[1]);
          send(action.hold[0]);
        }
        return true;
      },
      up: function (action) {
        if (!holds.has(action.id)) return false;
        send(holds.get(action.id));
        holds.delete(action.id);
        return true;
      },
      // Release stops for every held action whose binding matches this keyup —
      // needed when focus moved into a text field mid-hold.
      upByEvent: function (actions, e, storage) {
        var released = false;
        actions.forEach(function (action) {
          if (!action.hold || !holds.has(action.id)) return;
          if (!actionMatches(action, e, storage)) return;
          send(holds.get(action.id));
          holds.delete(action.id);
          released = true;
        });
        return released;
      },
      releaseAll: function () {
        holds.forEach(function (stop) { send(stop); });
        holds.clear();
      }
    };
  }

  // The "?" reference — one generator for every surface so the overlay reads
  // the same everywhere. `sections` = [{title, rows:[{label, keys:[..]}], note?}].
  function referenceHTML(options) {
    options = options || {};
    var chip = function (b) { return '<span class="km-key">' + escapeHtml(b) + '</span>'; };
    var html = '<div class="km-card"><div class="km-head"><h3>' + escapeHtml(options.title || 'Keyboard shortcuts')
      + '</h3><button type="button" class="btn-secondary km-x">Done</button></div><div class="km-cols">';
    (options.sections || []).forEach(function (section) {
      html += '<div class="km-group"><div class="km-group-t">' + escapeHtml(section.title) + '</div>'
        + (section.rows || []).map(function (row) {
          return '<div class="km-row"><span class="km-lbl">' + escapeHtml(row.label)
            + '</span><span class="km-keys">' + (row.keys || []).map(chip).join('') + '</span></div>';
        }).join('')
        + (section.note ? '<div class="km-note">' + escapeHtml(section.note) + '</div>' : '')
        + '</div>';
    });
    html += '</div><div class="km-foot">' + (options.foot || 'Typing in any field suppresses shortcuts.') + '</div></div>';
    return html;
  }

  // Group a registered action table into reference sections for one scope.
  function sectionsForScope(actions, scope, storage) {
    var groups = {};
    actions.filter(function (a) { return a.scope === scope; }).forEach(function (a) {
      (groups[a.group] = groups[a.group] || []).push(a);
    });
    return Object.keys(groups).map(function (title) {
      return {
        title: title,
        rows: groups[title].map(function (a) { return { label: a.label, keys: effectiveBindings(a, storage) }; })
      };
    });
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    matches: matches,
    effectiveBindings: effectiveBindings,
    actionMatches: actionMatches,
    createHoldTracker: createHoldTracker,
    referenceHTML: referenceHTML,
    sectionsForScope: sectionsForScope
  };
});
