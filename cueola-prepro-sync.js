/* Cueola Planda Bear leaf-granular sync engine.
 *
 * Pure, dependency-free helpers shared by the classic browser app and Node
 * contract tests (same pattern as cueola-export-model.js). Owns the
 * "Google-Docs-grade" merge model for the prePro package: rows as ordered
 * maps, per-leaf diffs → masked Firestore field-path updates, per-leaf
 * newest-stamp-wins merge with tombstoned deletions. Firestore, DOM, and UI
 * stay in callers. See PB_COLLAB_PLAN.md.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CueolaPreProSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ── Shape configuration ────────────────────────────────────────────────
  // Which prePro keys hold row collections (arrays on the legacy wire, ordered
  // maps on the new wire) and which hold scalar-leaf section objects.
  // Everything not listed is an opaque top-level leaf (legacy behavior).
  var ROW_COLLECTIONS = { people: true, videoPatchRows: true, audioPatchRows: true, commsPatchRows: true };
  var SECTIONS = { safety: true };
  // productionSchedule is a section whose 'checklist' key is a row collection.
  var SECTION_ROW_KEYS = { productionSchedule: { checklist: true } };
  // callSheets is a row collection whose rows each contain a nested 'people'
  // row collection (per-sheet crew).
  var NESTED_ROW_KEYS = { callSheets: { people: true } };
  var META_KEYS = { updatedAt: true, _fieldUpdatedAt: true, _stamps: true, activeCallSheetIndex: true };
  var DEL = '__del';
  var TOMBSTONE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  function sanitizeKey(k) {
    var s = String(k == null ? '' : k).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64);
    if (!/^[A-Za-z_]/.test(s)) s = 'k_' + s;
    return s;
  }

  var _idCounter = 0;
  function newRowId(rng) {
    var rand = (typeof rng === 'function' ? rng() : Math.random());
    _idCounter = (_idCounter + 1) % 1296;
    return 'r_' + Math.floor(rand * 60466176).toString(36) + _idCounter.toString(36);
  }

  // ── Row collections: array ⇄ ordered map ──────────────────────────────
  function rowsToMap(rows, opts) {
    opts = opts || {};
    if (isObj(rows)) return rows; // already map shape
    var out = {};
    (Array.isArray(rows) ? rows : []).forEach(function (row, i) {
      if (!isObj(row)) return;
      // Map keys must be Firestore-field-path safe; the row's own id field may
      // carry legacy characters (call sheets use dotted/hyphenated ids) and is
      // preserved verbatim inside the row. sanitizeKey is deterministic, so the
      // same row keys identically on every save — no id churn.
      var ownId = typeof row.id === 'string' && row.id ? row.id : '';
      var key = ownId ? sanitizeKey(ownId) : newRowId(opts.rng);
      while (out[key]) key = key + '_';
      var copy = {};
      Object.keys(row).forEach(function (k) { if (k !== 'id' && k !== 'ord') copy[sanitizeKey(k)] = row[k]; });
      copy.id = ownId || key;
      copy.ord = typeof row.ord === 'number' && isFinite(row.ord) ? row.ord : i + 1;
      out[key] = copy;
    });
    return out;
  }

  function rowsToList(rows) {
    if (Array.isArray(rows)) return rows.slice();
    if (!isObj(rows)) return [];
    return Object.keys(rows)
      .filter(function (id) { return isObj(rows[id]); })
      .map(function (id) {
        var row = rows[id], copy = {};
        Object.keys(row).forEach(function (k) { copy[k] = row[k]; });
        // Prefer the row's own (possibly legacy-charset) id; the map key is
        // its sanitized twin and only fills in when the row never had one.
        copy.id = (typeof row.id === 'string' && row.id) ? row.id : id;
        return copy;
      })
      .sort(function (a, b) {
        var ao = typeof a.ord === 'number' ? a.ord : 1e9;
        var bo = typeof b.ord === 'number' ? b.ord : 1e9;
        return ao === bo ? (a.id < b.id ? -1 : 1) : ao - bo;
      });
  }

  // Fractional index between two neighbors (either may be undefined).
  function ordBetween(before, after) {
    var lo = typeof before === 'number' ? before : 0;
    if (typeof after !== 'number') return lo + 1;
    var mid = (lo + after) / 2;
    return (after - lo) > 1e-6 ? mid : after; // caller should renumber when exhausted
  }

  function renumber(rowsMap) {
    var list = rowsToList(rowsMap);
    list.forEach(function (row, i) { if (rowsMap[row.id]) rowsMap[row.id].ord = i + 1; });
    return rowsMap;
  }

  // ── Doc normalization (legacy arrays → map shape, once per load) ───────
  function normalizeDoc(doc, opts) {
    doc = isObj(doc) ? doc : {};
    var out = {}, changed = false;
    Object.keys(doc).forEach(function (k) { out[k] = doc[k]; });
    Object.keys(ROW_COLLECTIONS).forEach(function (k) {
      if (Array.isArray(out[k])) { out[k] = rowsToMap(out[k], opts); changed = true; }
    });
    Object.keys(SECTION_ROW_KEYS).forEach(function (sect) {
      if (!isObj(out[sect])) return;
      Object.keys(SECTION_ROW_KEYS[sect]).forEach(function (rk) {
        if (Array.isArray(out[sect][rk])) {
          out[sect] = shallowCopy(out[sect]);
          out[sect][rk] = rowsToMap(out[sect][rk], opts);
          changed = true;
        }
      });
    });
    Object.keys(NESTED_ROW_KEYS).forEach(function (coll) {
      if (Array.isArray(out[coll])) { out[coll] = rowsToMap(out[coll], opts); changed = true; }
      if (!isObj(out[coll])) return;
      var rebuilt = null;
      Object.keys(out[coll]).forEach(function (rowId) {
        var row = out[coll][rowId];
        if (!isObj(row)) return;
        Object.keys(NESTED_ROW_KEYS[coll]).forEach(function (nk) {
          if (Array.isArray(row[nk])) {
            if (!rebuilt) { rebuilt = shallowCopy(out[coll]); }
            rebuilt[rowId] = shallowCopy(row);
            rebuilt[rowId][nk] = rowsToMap(row[nk], opts);
            changed = true;
          }
        });
      });
      if (rebuilt) out[coll] = rebuilt;
    });
    if (!isObj(out._stamps)) { out._stamps = {}; changed = changed || doc._stamps !== undefined; }
    return { doc: out, changed: changed };
  }

  function shallowCopy(o) { var c = {}; Object.keys(o).forEach(function (k) { c[k] = o[k]; }); return c; }

  // ── Leaf enumeration ───────────────────────────────────────────────────
  // Yields [pathArray, value] for every syncable leaf in a normalized doc.
  function eachLeaf(doc, cb) {
    Object.keys(doc || {}).forEach(function (k) {
      if (META_KEYS[k]) return;
      var v = doc[k];
      if (SECTIONS[k] && isObj(v)) {
        Object.keys(v).forEach(function (f) { cb([k, f], v[f]); });
      } else if (SECTION_ROW_KEYS[k] && isObj(v)) {
        Object.keys(v).forEach(function (f) {
          if (SECTION_ROW_KEYS[k][f] && isObj(v[f])) eachRowLeaf([k, f], v[f], cb);
          else cb([k, f], v[f]);
        });
      } else if (ROW_COLLECTIONS[k] && isObj(v)) {
        eachRowLeaf([k], v, cb);
      } else if (NESTED_ROW_KEYS[k] && isObj(v)) {
        Object.keys(v).forEach(function (rowId) {
          var row = v[rowId];
          if (!isObj(row)) return;
          Object.keys(row).forEach(function (f) {
            if (NESTED_ROW_KEYS[k][f] && isObj(row[f])) eachRowLeaf([k, rowId, f], row[f], cb);
            else cb([k, rowId, f], row[f]);
          });
        });
      } else {
        cb([k], v); // opaque top-level leaf
      }
    });
  }

  function eachRowLeaf(prefix, rowsMap, cb) {
    Object.keys(rowsMap).forEach(function (rowId) {
      var row = rowsMap[rowId];
      if (!isObj(row)) return;
      Object.keys(row).forEach(function (f) {
        if (f === 'id') return;
        cb(prefix.concat([rowId, f]), row[f]);
      });
    });
  }

  function leafEquals(a, b) {
    if (a === b) return true;
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
  }

  function getPath(obj, path) {
    var cur = obj;
    for (var i = 0; i < path.length; i++) {
      if (!isObj(cur)) return undefined;
      cur = cur[path[i]];
    }
    return cur;
  }

  function setPath(obj, path, value) {
    var cur = obj;
    for (var i = 0; i < path.length - 1; i++) {
      if (!isObj(cur[path[i]])) cur[path[i]] = {};
      cur = cur[path[i]];
    }
    cur[path[path.length - 1]] = value;
  }

  function deletePath(obj, path) {
    var cur = obj;
    for (var i = 0; i < path.length - 1; i++) {
      if (!isObj(cur[path[i]])) return;
      cur = cur[path[i]];
    }
    delete cur[path[path.length - 1]];
  }

  // Row prefix (for tombstones): [coll, rowId] or [sect, rk, rowId] or [coll, sheetId, nk, rowId]
  function rowPrefixes(doc) {
    var out = [];
    Object.keys(ROW_COLLECTIONS).forEach(function (k) {
      if (isObj(doc[k])) Object.keys(doc[k]).forEach(function (id) { out.push([k, id]); });
    });
    Object.keys(SECTION_ROW_KEYS).forEach(function (sect) {
      if (!isObj(doc[sect])) return;
      Object.keys(SECTION_ROW_KEYS[sect]).forEach(function (rk) {
        if (isObj(doc[sect][rk])) Object.keys(doc[sect][rk]).forEach(function (id) { out.push([sect, rk, id]); });
      });
    });
    Object.keys(NESTED_ROW_KEYS).forEach(function (coll) {
      if (!isObj(doc[coll])) return;
      Object.keys(doc[coll]).forEach(function (sheetId) {
        out.push([coll, sheetId]);
        var row = doc[coll][sheetId];
        if (!isObj(row)) return;
        Object.keys(NESTED_ROW_KEYS[coll]).forEach(function (nk) {
          if (isObj(row[nk])) Object.keys(row[nk]).forEach(function (id) { out.push([coll, sheetId, nk, id]); });
        });
      });
    });
    return out;
  }

  // ── Diff: previous normalized doc vs next normalized doc ──────────────
  // Returns { updates, stampWrites, deletePaths, changedPaths } where updates
  // maps dotted leaf paths (NOT prefixed) to values, deletePaths lists dotted
  // row paths removed (tombstoned), and stampWrites mirrors both.
  function diffLeaves(prev, next, now) {
    prev = isObj(prev) ? prev : {};
    next = isObj(next) ? next : {};
    now = typeof now === 'number' ? now : Date.now();
    var updates = {}, stampWrites = {}, deletePaths = [], changedPaths = [];

    eachLeaf(next, function (path, value) {
      var before = getPath(prev, path);
      if (!leafEquals(before, value)) {
        var dotted = path.join('.');
        updates[dotted] = value;
        stampWrites['_stamps.' + dotted] = now;
        changedPaths.push(dotted);
      }
    });

    // Deleted rows → tombstones (deleted opaque/section leaves stay in place;
    // paperwork fields empty out rather than disappear).
    var nextRows = {};
    rowPrefixes(next).forEach(function (p) { nextRows[p.join('.')] = true; });
    rowPrefixes(prev).forEach(function (p) {
      var dotted = p.join('.');
      if (!nextRows[dotted]) {
        deletePaths.push(dotted);
        stampWrites['_stamps.' + dotted] = { };
        stampWrites['_stamps.' + dotted][DEL] = now;
        changedPaths.push(dotted);
      }
    });

    return { updates: updates, stampWrites: stampWrites, deletePaths: deletePaths, changedPaths: changedPaths };
  }

  // ── Stamp lookup with legacy fallback ──────────────────────────────────
  function stampFor(doc, path) {
    var stamps = isObj(doc._stamps) ? doc._stamps : {};
    // exact leaf stamp, or nearest ancestor stamp/tombstone
    for (var end = path.length; end >= 1; end--) {
      var s = getPath(stamps, path.slice(0, end));
      if (typeof s === 'number') return { at: s, del: false };
      if (isObj(s) && typeof s[DEL] === 'number') return { at: s[DEL], del: end <= path.length, tombstonePath: path.slice(0, end) };
    }
    var legacy = isObj(doc._fieldUpdatedAt) ? doc._fieldUpdatedAt : {};
    if (typeof legacy[path[0]] === 'number') return { at: legacy[path[0]], del: false, legacy: true };
    // A stamp-aware doc (any leaf stamps or a legacy map present) treats
    // unstamped leaves as OLD — otherwise every untouched field would inherit
    // doc.updatedAt and look freshly edited after any unrelated save. Only a
    // truly pre-stamp legacy doc falls back to its doc-level updatedAt.
    var stampAware = Object.keys(stamps).length > 0 || isObj(doc._fieldUpdatedAt);
    return { at: stampAware ? 0 : (Number(doc.updatedAt) || 0), del: false, legacy: true };
  }

  // ── Merge: local doc + server doc → converged doc ──────────────────────
  // pendingPaths: Set-like (has()) of dotted leaf paths with in-flight local
  // writes — those keep local values regardless of stamps.
  function mergeDocs(local, server, opts) {
    opts = opts || {};
    var pending = opts.pendingPaths || { has: function () { return false; } };
    var L = normalizeDoc(local, opts).doc;
    var S = normalizeDoc(server, opts).doc;
    var merged = JSON.parse(JSON.stringify(L));
    if (!isObj(merged._stamps)) merged._stamps = {};
    var recovery = {}; // dotted path → local value newer than server (re-push)

    // 1) take newer server leaves
    eachLeaf(S, function (path, sVal) {
      var dotted = path.join('.');
      if (pending.has(dotted)) return;
      var lHas = getPath(L, path) !== undefined;
      var sStamp = stampFor(S, path), lStamp = stampFor(L, path);
      // a newer LOCAL tombstone beats an older server edit
      var lTomb = localTombstone(L, path);
      if (lTomb && lTomb >= sStamp.at) return;
      if (!lHas || sStamp.at >= lStamp.at) {
        setPath(merged, path, sVal);
        setPath(merged._stamps, path, sStamp.at);
      } else if (opts.recoverNewerLocal) {
        recovery[dotted] = getPath(L, path);
      }
    });

    // 2) apply newer server tombstones (delete local rows)
    collectTombstones(S).forEach(function (t) {
      if (pending.has(t.path.join('.'))) return;
      var localRowStamp = newestLeafStampUnder(L, t.path);
      if (t.at >= localRowStamp) {
        deletePath(merged, t.path);
        var stampObj = {}; stampObj[DEL] = t.at;
        setPath(merged._stamps, t.path, stampObj);
      } else if (opts.recoverNewerLocal) {
        // local edited the row after the delete — resurrect: re-push all leaves
        var row = getPath(L, t.path);
        if (isObj(row)) recovery[t.path.join('.')] = row;
      }
    });

    // 3) locally-deleted rows the server still carries: keep deleted if the
    //    local tombstone is newer than the server row's newest edit (handled
    //    in step 1 per-leaf via localTombstone); recover deletions to server.
    if (opts.recoverNewerLocal) {
      collectTombstones(L).forEach(function (t) {
        var serverRow = getPath(S, t.path);
        if (serverRow !== undefined && t.at >= newestLeafStampUnder(S, t.path)) {
          recovery['__delete__.' + t.path.join('.')] = true;
        }
      });
    }

    merged.updatedAt = Math.max(Number(L.updatedAt) || 0, Number(S.updatedAt) || 0);
    // legacy mirror kept for downgrade safety: newest stamp per top-level key
    var legacy = isObj(merged._fieldUpdatedAt) ? merged._fieldUpdatedAt : {};
    eachLeaf(merged, function (path) {
      var st = stampFor(merged, path);
      if (!legacy[path[0]] || st.at > legacy[path[0]]) legacy[path[0]] = st.at;
    });
    merged._fieldUpdatedAt = legacy;
    return { merged: merged, recovery: recovery };
  }

  function localTombstone(doc, path) {
    var stamps = isObj(doc._stamps) ? doc._stamps : {};
    for (var end = path.length; end >= 1; end--) {
      var s = getPath(stamps, path.slice(0, end));
      if (isObj(s) && typeof s[DEL] === 'number' && getPath(doc, path.slice(0, end)) === undefined) return s[DEL];
    }
    return 0;
  }

  function collectTombstones(doc) {
    var out = [];
    (function walk(node, path) {
      if (!isObj(node)) return;
      Object.keys(node).forEach(function (k) {
        var v = node[k];
        if (isObj(v)) {
          if (typeof v[DEL] === 'number' && getPath(doc, path.concat([k])) === undefined) {
            out.push({ path: path.concat([k]), at: v[DEL] });
          } else {
            walk(v, path.concat([k]));
          }
        }
      });
    })(isObj(doc._stamps) ? doc._stamps : {}, []);
    return out;
  }

  function newestLeafStampUnder(doc, prefix) {
    var newest = 0;
    var row = getPath(doc, prefix);
    if (!isObj(row)) return stampFor(doc, prefix).at;
    eachRowLike(row, prefix, function (path) {
      var st = stampFor(doc, path);
      if (st.at > newest) newest = st.at;
    });
    return newest || stampFor(doc, prefix).at;
  }

  function eachRowLike(row, prefix, cb) {
    Object.keys(row).forEach(function (f) {
      if (isObj(row[f])) eachRowLike(row[f], prefix.concat([f]), cb);
      else cb(prefix.concat([f]));
    });
  }

  // ── Firestore masked update construction ──────────────────────────────
  // Turns a diff into { '<base>.<leaf.path>': value } plus stamp writes and
  // deleteField markers. Caller supplies its deleteField sentinel.
  function buildFirestoreUpdates(diff, opts) {
    opts = opts || {};
    var base = opts.base || 'prePro';
    var now = typeof opts.now === 'number' ? opts.now : Date.now();
    var updates = {};
    updates[base + '.updatedAt'] = now;
    Object.keys(diff.updates).forEach(function (dotted) {
      updates[base + '.' + dotted] = diff.updates[dotted];
    });
    Object.keys(diff.stampWrites).forEach(function (dotted) {
      updates[base + '.' + dotted] = diff.stampWrites[dotted];
    });
    (diff.deletePaths || []).forEach(function (dotted) {
      updates[base + '.' + dotted] = opts.deleteField !== undefined ? opts.deleteField : null;
    });
    return updates;
  }

  // ── Tombstone GC ───────────────────────────────────────────────────────
  function gcTombstones(doc, now, maxAgeMs) {
    now = typeof now === 'number' ? now : Date.now();
    maxAgeMs = typeof maxAgeMs === 'number' ? maxAgeMs : TOMBSTONE_MAX_AGE_MS;
    var removed = 0;
    collectTombstones(doc).forEach(function (t) {
      if (now - t.at > maxAgeMs) { deletePath(doc._stamps, t.path); removed++; }
    });
    return removed;
  }

  return Object.freeze({
    ROW_COLLECTIONS: ROW_COLLECTIONS,
    SECTIONS: SECTIONS,
    DEL: DEL,
    sanitizeKey: sanitizeKey,
    newRowId: newRowId,
    rowsToMap: rowsToMap,
    rowsToList: rowsToList,
    ordBetween: ordBetween,
    renumber: renumber,
    normalizeDoc: normalizeDoc,
    diffLeaves: diffLeaves,
    stampFor: stampFor,
    mergeDocs: mergeDocs,
    buildFirestoreUpdates: buildFirestoreUpdates,
    gcTombstones: gcTombstones
  });
});
