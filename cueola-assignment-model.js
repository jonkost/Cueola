/* Cueola canonical student-assignment model.
 *
 * Pure, dependency-free helpers shared by the classic browser app and Node
 * contract tests. Firestore and DOM ownership deliberately stay in callers.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CueolaAssignmentModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ASSIGNMENT_STATUSES = Object.freeze(['assigned', 'completed']);
  var CANONICAL_ASSIGNMENT_FIELDS = Object.freeze([
    'assignmentId', 'productionSession', 'profileId', 'displayName',
    'positionId', 'positionLabel', 'paperworkIds', 'paperworkLabels',
    'status', 'assignedBy', 'assignedByLabel', 'createdAt', 'updatedAt',
    'revision'
  ]);
  var STATUS_SET = new Set(ASSIGNMENT_STATUSES);

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
  }

  function cleanText(value, limit) {
    return String(value == null ? '' : value)
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, limit || 240);
  }

  function identityText(value) {
    return cleanText(value, 240).toLowerCase();
  }

  function cleanId(value, limit) {
    return String(value == null ? '' : value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, limit || 180);
  }

  function slug(value, limit) {
    return identityText(value)
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, limit || 42);
  }

  function hash32(value, seed) {
    var hash = seed >>> 0;
    var input = String(value == null ? '' : value);
    for (var i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  function hex32(number) {
    return (number >>> 0).toString(16).padStart(8, '0');
  }

  function hashToken(value) {
    var input = identityText(value);
    return hex32(hash32(input, 2166136261)) + hex32(hash32(input, 2246822507));
  }

  function deterministicId(prefix, value, label) {
    var normalized = identityText(value);
    if (!normalized) return '';
    var readable = slug(label == null ? normalized : label, 40);
    return cleanId(prefix + (readable ? '_' + readable : '') + '_' + hashToken(normalized).slice(0, 12));
  }

  function randomToken() {
    var cryptoObject = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (cryptoObject && typeof cryptoObject.randomUUID === 'function') {
      return cleanId(cryptoObject.randomUUID().replace(/-/g, ''), 80);
    }
    if (cryptoObject && typeof cryptoObject.getRandomValues === 'function') {
      var words = new Uint32Array(4);
      cryptoObject.getRandomValues(words);
      return Array.from(words).map(hex32).join('');
    }
    return hashToken(String(Date.now()) + ':' + String(Math.random()) + ':' + String(Math.random()));
  }

  /* A supplied seed is the deterministic legacy path. No seed creates a new,
   * opaque ID. Callers persist the result once; they never derive a new ID on
   * a profile rename. */
  function createProfileId(seed) {
    if (seed != null && identityText(seed)) {
      return deterministicId('profile_legacy', seed, seed);
    }
    return cleanId('profile_' + randomToken());
  }

  function looksLikeProfileId(value) {
    return /^profile_[a-z0-9_.-]{6,}$/.test(cleanId(value));
  }

  function profileIdFor(profileOrUsername) {
    if (profileOrUsername && typeof profileOrUsername === 'object' && !Array.isArray(profileOrUsername)) {
      var existing = cleanId(profileOrUsername.profileId || profileOrUsername.stableProfileId);
      if (existing) return existing;
      var source = profileOrUsername.username || profileOrUsername.usernameLower ||
        profileOrUsername.id || profileOrUsername.fullName || profileOrUsername.displayName;
      return source ? createProfileId('legacy-profile:' + identityText(source)) : '';
    }
    var raw = cleanText(profileOrUsername, 240);
    if (!raw) return '';
    if (looksLikeProfileId(raw)) return cleanId(raw);
    return createProfileId('legacy-profile:' + identityText(raw));
  }

  function addProfileIdentity(set, value) {
    if (value == null || value === '') return;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      var objectId = profileIdFor(value);
      if (objectId) set.add(objectId);
      return;
    }
    var raw = cleanText(value, 240);
    var id = looksLikeProfileId(raw) ? cleanId(raw) : profileIdFor(raw);
    if (id) set.add(id);
  }

  /* profileAliases is the canonical merge/legacy bridge: an array of prior or
   * source stable profile IDs. Rename retains profileId; merge adds the source
   * profileId and its aliases to the target. Older username alias fields are
   * also accepted during the migration window. */
  function profileIdentityIds(profile) {
    var ids = new Set();
    if (typeof profile === 'string') {
      addProfileIdentity(ids, profile);
      return Array.from(ids);
    }
    profile = profile && typeof profile === 'object' ? profile : {};
    addProfileIdentity(ids, profile);
    [profile.profileAliases, profile.aliases, profile.previousProfileIds,
      profile.mergedProfileIds].forEach(function (list) {
      if (Array.isArray(list)) list.forEach(function (item) { addProfileIdentity(ids, item); });
    });
    [profile.previousUsernames, profile.renamedFrom, profile.mergedFrom].forEach(function (value) {
      if (Array.isArray(value)) value.forEach(function (item) { addProfileIdentity(ids, item); });
      else addProfileIdentity(ids, value);
    });
    // A deterministic alias lets an upgraded profile find documents written
    // before its random profileId was persisted. It is compatibility only.
    if (profile.username || profile.usernameLower || profile.id) {
      addProfileIdentity(ids, profile.username || profile.usernameLower || profile.id);
    }
    return Array.from(ids);
  }

  function positionIdFor(label) {
    if (label && typeof label === 'object' && !Array.isArray(label)) {
      var existing = cleanId(label.positionId || label.id);
      if (existing) return existing;
      label = label.positionLabel || label.label || label.position || label.role;
    }
    var raw = cleanText(label, 160);
    if (!raw) return '';
    if (/^position_[a-z0-9_.-]{4,}$/.test(cleanId(raw))) return cleanId(raw);
    return deterministicId('position', raw, raw);
  }

  function assignmentIdFor(profileId, positionId) {
    var profile = cleanId(profileId);
    var position = cleanId(positionId);
    if (!profile || !position) return '';
    return cleanId('assignment_' + hashToken(profile + '|' + position));
  }

  function paperworkIdFor(label) {
    var raw = cleanText(label, 240);
    var key = identityText(raw);
    if (!key) return '';
    if (/^call sheet(?::|$)/.test(key)) {
      var suffix = cleanText(raw.replace(/^call sheet\s*:?\s*/i, ''), 160);
      return suffix ? deterministicId('call_sheet', suffix, suffix) : 'call-sheet';
    }
    if (key === 'production schedule' || key === 'production scheduler' || key === 'scheduler') return 'production-scheduler';
    if (key.indexOf('safety') >= 0) return 'safety-plan';
    if (key === 'rundown' || key === 'full rendered rundown') return 'rundown';
    if (key.indexOf('flowmingo') >= 0 || key === 'script') return 'flowmingo-script';
    if (key.indexOf('video') >= 0 && key.indexOf('patch') >= 0) return 'video-patch';
    if ((key.indexOf('audio') >= 0 || key.indexOf('comms') >= 0) && key.indexOf('patch') >= 0) return 'audio-comms-patch';
    if (key.indexOf('tech') >= 0 && key.indexOf('check') >= 0) return 'tech-checklist';
    return deterministicId('paperwork', raw, raw);
  }

  function list(value, splitLegacy) {
    if (Array.isArray(value)) {
      return value.reduce(function (all, item) { return all.concat(list(item, false)); }, []);
    }
    var text = cleanText(value, 1000);
    if (!text) return [];
    return splitLegacy ? text.split(/\s*(?:,|\/|·|\n)\s*/).map(function (item) {
      return cleanText(item, 240);
    }).filter(Boolean) : [text];
  }

  function humanizeId(id) {
    return cleanText(String(id || '').replace(/^paperwork_/, '').replace(/[_-]+/g, ' '), 240);
  }

  function normalizePaperwork(source) {
    source = source && typeof source === 'object' ? source : {};
    var ids = list(source.paperworkIds, false).map(function (value) {
      return cleanId(value);
    }).filter(Boolean);
    var labels = list(source.paperworkLabels, false);
    if (!labels.length) {
      labels = list(own(source, 'paperwork') ? source.paperwork :
        (own(source, 'paperworkItems') ? source.paperworkItems : source.file), true);
    }
    labels = labels.reduce(function (expanded, label) {
      var key = identityText(label);
      // The first assignment UI stored the combined label "Patch Sheets".
      // Preserve its meaning explicitly rather than inventing a custom ID.
      if (key === 'patch sheet' || key === 'patch sheets') {
        expanded.push('Video Patch Sheet', 'Audio & Comms Patch Sheet');
      } else {
        expanded.push(label);
      }
      return expanded;
    }, []);
    var count = Math.max(ids.length, labels.length);
    var seen = new Set();
    var outputIds = [];
    var outputLabels = [];
    for (var i = 0; i < count; i += 1) {
      var label = cleanText(labels[i] || humanizeId(ids[i]), 240);
      var id = cleanId(ids[i]) || paperworkIdFor(label);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      outputIds.push(id);
      outputLabels.push(label || humanizeId(id));
    }
    return { ids: outputIds, labels: outputLabels };
  }

  function timestampMs(value) {
    if (value && typeof value.toMillis === 'function') {
      try { return Math.max(0, Math.floor(value.toMillis())); } catch (error) {}
    }
    if (value && typeof value === 'object' && Number.isFinite(Number(value.seconds))) {
      return Math.max(0, Math.floor(Number(value.seconds) * 1000 + Number(value.nanoseconds || 0) / 1000000));
    }
    var number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
  }

  function revisionOf(value) {
    var revision = value && typeof value === 'object' ? value.revision : value;
    revision = Number(revision);
    return Number.isFinite(revision) ? Math.max(0, Math.floor(revision)) : 0;
  }

  function normalizeStatus(value) {
    var status = identityText(value);
    if (status === 'completed' || status === 'complete' || status === 'done') return 'completed';
    return 'assigned';
  }

  function actorValues(source) {
    var actor = source.assignedBy;
    var fallbackActor = source.updatedBy || source.createdBy;
    var assignedBy = '';
    var assignedByLabel = cleanText(source.assignedByLabel || source.updatedByLabel, 160);
    if (actor && typeof actor === 'object' && !Array.isArray(actor)) {
      assignedBy = cleanId(actor.profileId || actor.id || actor.username || actor.name);
      if (!assignedByLabel) assignedByLabel = cleanText(actor.displayName || actor.fullName || actor.name || actor.label, 160);
    } else {
      assignedBy = cleanId(actor || fallbackActor);
    }
    return {
      id: assignedBy || 'legacy-migration',
      label: assignedByLabel || cleanText(actor || fallbackActor, 160) || 'Legacy migration'
    };
  }

  function normalizeAssignmentRecord(row) {
    row = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
    var displayName = cleanText(row.displayName || row.studentName || row.person || row.name, 160);
    var profileId = cleanId(row.profileId || row.studentProfileId) ||
      profileIdFor(row.profileUsername || row.username || displayName);
    var positionLabel = cleanText(row.positionLabel || row.position || row.role, 160);
    var positionId = cleanId(row.positionId || row.crewPositionId) || positionIdFor(positionLabel);
    var paperwork = normalizePaperwork(row);
    var actor = actorValues(row);
    var createdAt = timestampMs(row.createdAt || row.assignedAt || row.updatedAt);
    var updatedAt = timestampMs(row.updatedAt || row.assignedAt || row.createdAt);
    return {
      assignmentId: cleanId(row.assignmentId || row.id) || assignmentIdFor(profileId, positionId),
      productionSession: cleanText(row.productionSession || row.sessionCode || row.session || row.code, 160).toUpperCase(),
      profileId: profileId,
      displayName: displayName,
      positionId: positionId,
      positionLabel: positionLabel,
      paperworkIds: paperwork.ids,
      paperworkLabels: paperwork.labels,
      status: normalizeStatus(row.status),
      assignedBy: actor.id,
      assignedByLabel: actor.label,
      createdAt: createdAt,
      updatedAt: updatedAt || createdAt,
      revision: Math.max(1, revisionOf(row))
    };
  }

  function nowValue(now) {
    if (typeof now === 'function') return timestampMs(now());
    if (now != null) return timestampMs(now);
    return Date.now();
  }

  function assertComplete(record) {
    ['assignmentId', 'productionSession', 'profileId', 'displayName', 'positionId',
      'positionLabel', 'assignedBy', 'assignedByLabel'].forEach(function (field) {
      if (!record[field]) throw new Error(field + ' is required.');
    });
    if (!Array.isArray(record.paperworkIds) || !Array.isArray(record.paperworkLabels)) {
      throw new Error('paperworkIds and paperworkLabels are required arrays.');
    }
    if (record.paperworkIds.length !== record.paperworkLabels.length) {
      throw new Error('paperworkIds and paperworkLabels must be aligned.');
    }
    if (!STATUS_SET.has(record.status)) throw new Error('Unknown assignment status: ' + record.status);
    if (!Number.isFinite(record.createdAt) || !Number.isFinite(record.updatedAt) || record.revision < 1) {
      throw new Error('Assignment timestamps and revision are required.');
    }
  }

  function createAssignmentRecord(input, previous, now) {
    input = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    var prior = previous ? normalizeAssignmentRecord(previous) : null;
    var merged = Object.assign({}, prior || {}, input);
    // Arrays are paired data; an explicitly supplied half must not inherit the
    // stale other half from the previous record.
    if (own(input, 'paperworkIds') && !own(input, 'paperworkLabels')) merged.paperworkLabels = [];
    if (own(input, 'paperworkLabels') && !own(input, 'paperworkIds')) merged.paperworkIds = [];
    ['productionSession', 'profileId', 'displayName', 'positionId', 'positionLabel',
      'paperworkIds', 'paperworkLabels', 'status', 'assignedBy', 'assignedByLabel'].forEach(function (field) {
      if (!own(merged, field)) throw new Error(field + ' is required.');
    });
    var record = normalizeAssignmentRecord(merged);
    var time = nowValue(now);
    var rawStatus = own(input, 'status') ? identityText(input.status) : (prior ? prior.status : 'assigned');
    if (!STATUS_SET.has(rawStatus)) throw new Error('Unknown assignment status: ' + rawStatus);
    record.status = rawStatus;
    record.createdAt = prior && prior.createdAt ? prior.createdAt : time;
    record.updatedAt = time;
    record.revision = prior ? prior.revision + 1 : 1;
    if (prior && (record.assignmentId !== prior.assignmentId ||
      record.productionSession !== prior.productionSession ||
      record.profileId !== prior.profileId || record.positionId !== prior.positionId)) {
      throw new Error('Assignment identity fields are immutable; create a separate record for another profile or position.');
    }
    assertComplete(record);
    return record;
  }

  function serializeAssignmentRecord(record) {
    var normalized = normalizeAssignmentRecord(record);
    assertComplete(normalized);
    return JSON.stringify(normalized);
  }

  function deserializeAssignmentRecord(value) {
    var parsed = typeof value === 'string' ? JSON.parse(value) : value;
    var normalized = normalizeAssignmentRecord(parsed);
    assertComplete(normalized);
    return normalized;
  }

  function recordList(records) {
    if (Array.isArray(records)) return records;
    if (records && typeof records === 'object') return Object.keys(records).map(function (key) {
      var value = records[key];
      return value && typeof value === 'object' && !value.assignmentId
        ? Object.assign({ assignmentId: key }, value) : value;
    });
    return [];
  }

  function assignmentsForProfile(records, profile) {
    var identities = new Set(profileIdentityIds(profile));
    var byAssignment = new Map();
    recordList(records).forEach(function (source) {
      var record = normalizeAssignmentRecord(source);
      if (!record.assignmentId || !identities.has(record.profileId)) return;
      var prior = byAssignment.get(record.assignmentId);
      if (!prior || record.revision > prior.revision ||
        (record.revision === prior.revision && record.updatedAt > prior.updatedAt)) {
        byAssignment.set(record.assignmentId, record);
      }
    });
    return Array.from(byAssignment.values()).sort(function (a, b) {
      var status = ASSIGNMENT_STATUSES.indexOf(a.status) - ASSIGNMENT_STATUSES.indexOf(b.status);
      if (status) return status;
      var position = a.positionLabel.localeCompare(b.positionLabel, undefined, { sensitivity: 'base' });
      return position || a.assignmentId.localeCompare(b.assignmentId);
    });
  }

  function compatibilityRows(records) {
    return recordList(records).map(normalizeAssignmentRecord).filter(function (record) {
      return Boolean(record.displayName && (record.positionLabel || record.paperworkLabels.length));
    }).map(function (record) {
      return {
        person: record.displayName,
        position: record.positionLabel,
        paperwork: record.paperworkLabels.slice()
      };
    });
  }

  function hasRevisionConflict(expected, actual) {
    var expectedMissing = expected == null;
    var actualMissing = actual == null;
    if (expectedMissing || actualMissing) return expectedMissing !== actualMissing;
    if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
      var expectedId = cleanId(expected.assignmentId || expected.id);
      var actualId = cleanId(actual.assignmentId || actual.id);
      if (expectedId && actualId && expectedId !== actualId) return true;
    }
    return revisionOf(expected) !== revisionOf(actual);
  }

  return Object.freeze({
    ASSIGNMENT_STATUSES: ASSIGNMENT_STATUSES,
    CANONICAL_ASSIGNMENT_FIELDS: CANONICAL_ASSIGNMENT_FIELDS,
    createProfileId: createProfileId,
    profileIdFor: profileIdFor,
    profileIdentityIds: profileIdentityIds,
    positionIdFor: positionIdFor,
    assignmentIdFor: assignmentIdFor,
    paperworkIdFor: paperworkIdFor,
    normalizeAssignmentRecord: normalizeAssignmentRecord,
    createAssignmentRecord: createAssignmentRecord,
    serializeAssignmentRecord: serializeAssignmentRecord,
    deserializeAssignmentRecord: deserializeAssignmentRecord,
    assignmentsForProfile: assignmentsForProfile,
    compatibilityRows: compatibilityRows,
    hasRevisionConflict: hasRevisionConflict
  });
});
