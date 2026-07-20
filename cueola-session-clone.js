/* ============================================================================
 * cueola-session-clone.js — v2.1 Phase 6 (design D5): "Start Next Episode".
 *
 * Pure whitelist-carry cloning: the most recent episode IS the living
 * template. buildEpisodeSeed copies STRUCTURE (rundown skeleton, cue columns,
 * paperwork shells, config) and strips everything episode-specific or
 * identity-bearing (presence, notes, activity, assignments, prompter script,
 * clocks, live state). Whitelist-carry, never blacklist-strip — the P2607
 * lesson (D8 rule 2): anything not listed here does NOT ride along.
 *
 * DOM-free and Firestore-free so the contract tests run in plain Node; the
 * dashboard supplies the async transaction wrapper. Classic global script:
 * attaches window.CueolaSessionClone.
 * ==========================================================================*/
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CueolaSessionClone = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Top-level session fields that carry into the next episode.
  const CLONE_TOP_FIELDS = ['beats', 'cues', 'rundownAliases', 'customSources',
    'freeMode', 'startTime', 'requireLoginCode', 'groups', 'groupsLocked'];
  // Paperwork STRUCTURE inside prePro that carries (D6 config included).
  const CLONE_PREPRO_FIELDS = ['callSheets', 'callSheetTombstones', 'productionSchedule',
    'safety', 'videoPatchRows', 'audio-commsPatchRows', 'commsPatchRows', 'paperworkEnabled',
    'positionsCustom', 'positionsRemoved'];

  function deepCopy(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  // "Ep 12" → "Ep 13"; "Show" → "Show 2"; "" → "Next Episode".
  function nextEpisodeName(name) {
    const clean = String(name || '').trim();
    if (!clean) return 'Next Episode';
    const match = clean.match(/^(.*?)(\d+)\s*$/);
    if (match) {
      const width = match[2].length;
      const next = String(Number(match[2]) + 1);
      return match[1] + (next.length < width ? next.padStart(width, '0') : next);
    }
    return clean + ' 2';
  }

  // New-day scrub for a carried call sheet: structure, venue, times, and the
  // crew grid stay; the date, weather, and sheet id are fresh (a copied id
  // would make old assignment rows dangle onto the new sheet).
  function scrubCallSheet(sheet, index) {
    const copy = deepCopy(sheet) || {};
    copy.id = 'call_sheet_' + (index + 1);
    copy.date = '';
    copy.weather = null;
    return copy;
  }

  // Whitelist-carry a prePro map (session master copy OR a group subdoc's).
  function seedPrePro(sourcePrePro, now) {
    const source = (sourcePrePro && typeof sourcePrePro === 'object') ? sourcePrePro : {};
    const prePro = {};
    const stamps = {};
    CLONE_PREPRO_FIELDS.forEach(key => {
      if (source[key] === undefined) return;
      prePro[key] = deepCopy(source[key]);
      stamps[key] = now;
    });
    if (Array.isArray(prePro.callSheets)) {
      prePro.callSheets = prePro.callSheets.map(scrubCallSheet);
    }
    delete prePro.callSheetTombstones;   // tombstones belong to the OLD sheets' ids
    if (source.production !== undefined) { prePro.production = deepCopy(source.production); stamps.production = now; }
    prePro.updatedAt = now;
    // D8 rule 4: every restore/clone path re-stamps per copied field so a
    // future sync engine can never silently revert the fresh docs.
    prePro._fieldUpdatedAt = stamps;
    return prePro;
  }

  // Pure single-doc seed. Grouped sources additionally clone each group
  // subdoc via seedGroupDoc — the caller owns that async fan-out.
  function buildEpisodeSeed(sourceDoc, opts) {
    const source = (sourceDoc && typeof sourceDoc === 'object') ? sourceDoc : {};
    const options = opts || {};
    const now = Number(options.now) || Date.now();
    const seed = {
      code: String(options.code || '').toUpperCase(),
      showName: String(options.name || nextEpisodeName(source.showName)),
      createdAt: now,
      createdBy: String(options.createdBy || ''),
      activeIdx: 0,
      status: 'idle',
      participants: [],
      clonedFrom: String(source.code || options.sourceCode || ''),
    };
    if (options.ownerUid) seed.ownerUid = String(options.ownerUid);
    CLONE_TOP_FIELDS.forEach(key => {
      if (source[key] !== undefined) seed[key] = deepCopy(source[key]);
    });
    seed.prePro = seedPrePro(source.prePro, now);
    // Legacy top-level re-spread: old clients read the active sheet's fields
    // off the session doc root — seed them from the first carried sheet.
    const firstSheet = Array.isArray(seed.prePro.callSheets) ? seed.prePro.callSheets[0] : null;
    if (firstSheet) {
      ['label', 'production', 'call', 'showStart', 'wrap', 'doors', 'location', 'address',
        'venue', 'parking', 'entrance', 'late', 'stream', 'dress', 'meals', 'mealTime', 'notes']
        .forEach(key => { if (firstSheet[key] !== undefined) seed[key] = deepCopy(firstSheet[key]); });
      seed.date = '';   // new episode, new day
    }
    return seed;
  }

  // Fresh group subdoc for the new session, carrying that group's own living
  // paperwork structure (NOT the stale pre-group master copy).
  function seedGroupDoc(sourceGroupDoc, now) {
    const stamp = Number(now) || Date.now();
    return {
      prePro: seedPrePro(sourceGroupDoc && sourceGroupDoc.prePro, stamp),
      updatedAt: stamp,
    };
  }

  // D5: one shared code alphabet — YY + MM + two letters from the 24-letter
  // no-I/O alphabet = 576 codes/month. Collisions are handled ONLY by the
  // caller's create-if-missing transaction retry.
  const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  function generateEpisodeCode(date, randomFn) {
    const when = date instanceof Date ? date : new Date();
    const rand = typeof randomFn === 'function' ? randomFn : Math.random;
    const yy = String(when.getFullYear() % 100).padStart(2, '0');
    const mm = String(when.getMonth() + 1).padStart(2, '0');
    const pick = () => CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
    return `${yy}${mm}${pick()}${pick()}`;
  }

  return {
    CLONE_TOP_FIELDS: CLONE_TOP_FIELDS.slice(),
    CLONE_PREPRO_FIELDS: CLONE_PREPRO_FIELDS.slice(),
    CODE_ALPHABET,
    nextEpisodeName,
    scrubCallSheet,
    seedPrePro,
    buildEpisodeSeed,
    seedGroupDoc,
    generateEpisodeCode,
  };
});
