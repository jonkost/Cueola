/* Cueola authoritative paperwork-export model.
 *
 * Pure, dependency-free helpers shared by the classic browser app and Node
 * contract tests. Firestore, DOM, PDF rendering, and operator UI stay in
 * callers; this module owns readiness, immutable snapshot shape, deterministic
 * assignment grouping, and revision-fence comparison.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CueolaExportModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var EXPORT_SCHEMA_VERSION = 1;
  var EXPORT_KIND = 'cueola-paperwork-export';
  var READINESS_KIND = 'cueola-export-readiness';
  var AUTHORITY = Object.freeze({
    SERVER: 'server',
    LOCAL: 'local',
    UNPUBLISHED: 'unpublished'
  });
  var READINESS_STATUS = Object.freeze({
    READY: 'ready',
    LOCAL: 'local',
    UNPUBLISHED: 'unpublished',
    WAITING: 'waiting',
    BLOCKED: 'blocked'
  });
  var CANONICAL_ASSIGNMENT_FIELDS = Object.freeze([
    'assignmentId', 'productionSession', 'profileId', 'displayName',
    'positionId', 'positionLabel', 'paperworkIds', 'paperworkLabels',
    'status', 'assignedBy', 'assignedByLabel', 'createdAt', 'updatedAt',
    'revision'
  ]);
  var REVISION_FIELDS = Object.freeze([
    'sessionRevision', 'sessionUpdatedAt', 'rundownBatchId',
    'rundownUpdatedAt', 'preProUpdatedAt', 'assignmentRevision',
    'assignmentUpdatedAt', 'notesRevision', 'notesUpdatedAt',
    'notesFingerprint', 'tokens'
  ]);
  var SCOPE_ORDER = Object.freeze({
    document: 0, rundown: 1, prePro: 2, notes: 3, assignments: 4
  });
  var SEVERITY_ORDER = Object.freeze({ block: 0, wait: 1, warning: 2 });

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
  }

  function isObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  function stringValue(value) {
    return String(value == null ? '' : value);
  }

  function singleLine(value) {
    return stringValue(value).trim().replace(/\s+/g, ' ');
  }

  function cleanId(value) {
    return singleLine(value).toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function finiteNumber(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : (fallback == null ? 0 : fallback);
  }

  function nonnegativeInteger(value) {
    return Math.max(0, Math.floor(finiteNumber(value, 0)));
  }

  function timestampMs(value) {
    if (value && typeof value.toMillis === 'function') {
      try { return nonnegativeInteger(value.toMillis()); } catch (error) {}
    }
    if (value && typeof value === 'object' && Number.isFinite(Number(value.seconds))) {
      return nonnegativeInteger(Number(value.seconds) * 1000 + Number(value.nanoseconds || 0) / 1000000);
    }
    if (value instanceof Date) return nonnegativeInteger(value.getTime());
    return nonnegativeInteger(value);
  }

  function clonePlain(value, stack) {
    if (value === null) return null;
    var type = typeof value;
    if (type === 'string' || type === 'boolean') return value;
    if (type === 'number') return Number.isFinite(value) ? value : null;
    if (type === 'bigint') return String(value);
    if (type === 'undefined' || type === 'function' || type === 'symbol') return undefined;
    if (value instanceof Date) return value.toISOString();
    if (value && typeof value.toMillis === 'function') {
      try { return timestampMs(value); } catch (error) {}
    }
    stack = stack || [];
    if (stack.indexOf(value) >= 0) throw new Error('Cyclic export data is not supported.');
    var nextStack = stack.concat([value]);
    if (Array.isArray(value)) {
      return value.map(function (item) {
        var cloned = clonePlain(item, nextStack);
        return cloned === undefined ? null : cloned;
      });
    }
    if (typeof Map !== 'undefined' && value instanceof Map) {
      var mapped = {};
      Array.from(value.entries()).map(function (entry) {
        return { key: stringValue(entry[0]), value: entry[1] };
      }).sort(function (a, b) { return stableCompare(a.key, b.key); }).forEach(function (entry) {
        var cloned = clonePlain(entry.value, nextStack);
        if (cloned !== undefined) mapped[entry.key] = cloned;
      });
      return mapped;
    }
    if (typeof Set !== 'undefined' && value instanceof Set) {
      return Array.from(value).map(function (item) {
        var cloned = clonePlain(item, nextStack);
        return cloned === undefined ? null : cloned;
      });
    }
    var output = {};
    Object.keys(value).forEach(function (key) {
      var cloned = clonePlain(value[key], nextStack);
      if (cloned !== undefined) output[key] = cloned;
    });
    return output;
  }

  function deepClone(value) {
    return clonePlain(value, []);
  }

  function deepFreeze(value, seen) {
    if (!value || typeof value !== 'object') return value;
    seen = seen || (typeof WeakSet !== 'undefined' ? new WeakSet() : []);
    if (seen instanceof Array) {
      if (seen.indexOf(value) >= 0) return value;
      seen.push(value);
    } else {
      if (seen.has(value)) return value;
      seen.add(value);
    }
    Object.keys(value).forEach(function (key) { deepFreeze(value[key], seen); });
    return Object.freeze(value);
  }

  function stableSerialize(value) {
    if (value === null) return 'null';
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
    if (Array.isArray(value)) return '[' + value.map(stableSerialize).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(function (key) {
        return JSON.stringify(key) + ':' + stableSerialize(value[key]);
      }).join(',') + '}';
    }
    return 'null';
  }

  function stableStringify(value) {
    return stableSerialize(deepClone(value));
  }

  function hash32(value, seed) {
    var hash = seed >>> 0;
    var input = stringValue(value);
    for (var i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  function hex32(number) {
    return (number >>> 0).toString(16).padStart(8, '0');
  }

  function fingerprint(value) {
    var serialized = stableStringify(value);
    return 'ef_' + hex32(hash32(serialized, 2166136261)) + hex32(hash32(serialized, 2246822507));
  }

  function stableSortKey(value) {
    var text = singleLine(value);
    try { text = text.normalize('NFKD'); } catch (error) {}
    return text.toLowerCase();
  }

  function stableCompare(a, b) {
    var left = stableSortKey(a);
    var right = stableSortKey(b);
    if (left < right) return -1;
    if (left > right) return 1;
    left = stringValue(a);
    right = stringValue(b);
    return left < right ? -1 : left > right ? 1 : 0;
  }

  function firstDefined() {
    for (var i = 0; i < arguments.length; i += 1) {
      if (arguments[i] !== undefined && arguments[i] !== null) return arguments[i];
    }
    return undefined;
  }

  function normalizeAuthority(value, source) {
    source = source || {};
    if (source.unpublished === true || source.isUnpublished === true) return AUTHORITY.UNPUBLISHED;
    if (source.localOnly === true || source.isDemo === true || source.isExpert === true) return AUTHORITY.LOCAL;
    if (source.serverConfirmed === true) return AUTHORITY.SERVER;
    var key = singleLine(value).toLowerCase().replace(/[ _]+/g, '-');
    if (['local', 'device', 'device-local', 'demo', 'expert', 'offline-draft'].indexOf(key) >= 0) return AUTHORITY.LOCAL;
    if (['unpublished', 'draft', 'note-draft', 'unpublished-draft'].indexOf(key) >= 0) return AUTHORITY.UNPUBLISHED;
    return AUTHORITY.SERVER;
  }

  function authorityLabel(authority) {
    authority = normalizeAuthority(authority);
    if (authority === AUTHORITY.LOCAL) return 'LOCAL DRAFT — NOT CLOUD CONFIRMED';
    if (authority === AUTHORITY.UNPUBLISHED) return 'UNPUBLISHED DRAFT — NOT SAVED';
    return 'SERVER-CONFIRMED EXPORT';
  }

  function countValue(value) {
    if (value == null || value === false) return 0;
    if (value === true) return 1;
    if (typeof value === 'number') return Math.max(0, Math.floor(value));
    if (Array.isArray(value) || typeof value === 'string') return value.length;
    if (typeof value.size === 'number') return Math.max(0, Math.floor(value.size));
    if (isObject(value) && typeof value.length === 'number') return Math.max(0, Math.floor(value.length));
    return 1;
  }

  function scopeState(input, name) {
    var aliases = name === 'prePro' ? ['preProState', 'preproState', 'prePro', 'prepro']
      : name === 'notes' ? ['notesState', 'noteState', 'notes']
        : name === 'assignments' ? ['assignmentsState', 'assignmentState', 'assignments']
          : ['rundownState', 'rundown'];
    for (var i = 0; i < aliases.length; i += 1) {
      var candidate = input[aliases[i]];
      if (isObject(candidate)) return candidate;
    }
    return {};
  }

  function flatScopeValue(input, name, suffix) {
    var prefixes = name === 'prePro' ? ['prePro', 'prepro', 'paperwork']
      : name === 'notes' ? ['notes', 'note']
        : name === 'assignments' ? ['assignments', 'assignment']
          : ['rundown'];
    for (var i = 0; i < prefixes.length; i += 1) {
      var key = prefixes[i] + suffix;
      if (own(input, key)) return input[key];
    }
    return undefined;
  }

  function issueMessage(scope, code, count) {
    var label = scope === 'prePro' ? 'Planda Bear paperwork'
      : scope === 'notes' ? 'Production notes'
        : scope === 'assignments' ? 'Assignments'
          : scope === 'rundown' ? 'Rundown' : 'Export';
    if (code === 'dirty') return label + ' has unsaved draft changes.';
    if (code === 'debounce') return label + ' still has a deferred save waiting to run.';
    if (code === 'pending') return label + ' has ' + count + ' pending write' + (count === 1 ? '' : 's') + '.';
    if (code === 'loading') return label + ' is still loading its saved state.';
    if (code === 'cache') return label + ' is available only from cache, not a server confirmation.';
    if (code === 'denied') return label + ' was denied by Firestore.';
    if (code === 'conflict') return label + ' has a save conflict that must be resolved.';
    if (code === 'unavailable') return label + ' could not be confirmed because the server is unavailable.';
    if (code === 'failed') return label + ' has a failed save or read.';
    if (code === 'unconfirmed') return label + ' has not been confirmed by the server.';
    return label + ' is not ready to export.';
  }

  function assessReadiness(input) {
    input = isObject(input) ? input : {};
    var authority = normalizeAuthority(input.authority, input);
    var issues = [];
    var issueKeys = new Set();

    function addIssue(scope, code, severity, count) {
      count = Math.max(1, nonnegativeInteger(count || 1));
      var key = scope + '|' + code;
      if (issueKeys.has(key)) return;
      issueKeys.add(key);
      issues.push({
        scope: scope,
        code: code,
        severity: severity,
        count: count,
        message: issueMessage(scope, code, count)
      });
    }

    if (input.dirty === true || input.documentDirty === true) addIssue('document', 'dirty', 'wait', 1);
    if (input.debouncePending === true || input.pendingDebounce === true || input.debounceTimer) {
      addIssue('document', 'debounce', 'wait', countValue(input.debouncePending || input.pendingDebounce || input.debounceTimer));
    }
    if (authority === AUTHORITY.SERVER && input.serverConfirmed === false) addIssue('document', 'unconfirmed', 'block', 1);
    if (input.fromCache === true || input.cacheOnly === true) {
      addIssue('document', 'cache', authority === AUTHORITY.SERVER ? 'block' : 'warning', 1);
    }
    if (input.denied === true || input.permissionDenied === true) {
      addIssue('document', 'denied', authority === AUTHORITY.SERVER ? 'block' : 'warning', 1);
    }
    if (input.conflict === true) addIssue('document', 'conflict', 'block', 1);

    ['rundown', 'prePro', 'notes', 'assignments'].forEach(function (scope) {
      var state = scopeState(input, scope);
      var stateName = singleLine(firstDefined(
        state.saveState, state.state,
        flatScopeValue(input, scope, 'SaveState'),
        flatScopeValue(input, scope, 'State')
      )).toLowerCase();
      var pendingValue = firstDefined(
        state.pendingCount, state.pendingWrites, state.pending, state.hasPendingWrites,
        flatScopeValue(input, scope, 'PendingCount'),
        flatScopeValue(input, scope, 'PendingWrites'),
        flatScopeValue(input, scope, 'Pending'),
        input.pending && input.pending[scope]
      );
      if (scope === 'rundown') pendingValue = firstDefined(pendingValue, input.rundownPendingBatches);
      if (scope === 'prePro') pendingValue = firstDefined(pendingValue, input.preProPendingKeys, input.pendingPreProKeys, input._pbPendingCloudKeys);
      if (scope === 'notes') pendingValue = firstDefined(pendingValue, input.notePendingWrites, input.notesPendingWrites);
      var pendingCount = countValue(pendingValue);
      if (scope === 'rundown' && input.rundownSyncRunning) pendingCount = Math.max(1, pendingCount);
      var dirty = Boolean(firstDefined(state.dirty, flatScopeValue(input, scope, 'Dirty'),
        scope === 'prePro' ? input.paperworkDirty : undefined));
      var debounce = firstDefined(state.debouncePending, state.pendingDebounce, state.debounceTimer,
        flatScopeValue(input, scope, 'DebouncePending'), scope === 'prePro' ? input._pbFieldSaveTimer : undefined);
      var fromCache = Boolean(firstDefined(state.fromCache, state.cacheOnly, state.cached,
        flatScopeValue(input, scope, 'FromCache'), scope === 'assignments' ? input.assignmentFromCache : undefined));
      var denied = Boolean(firstDefined(state.denied, state.permissionDenied,
        flatScopeValue(input, scope, 'Denied')));
      var conflict = Boolean(firstDefined(state.conflict, flatScopeValue(input, scope, 'Conflict')));
      var unavailable = Boolean(firstDefined(state.unavailable, flatScopeValue(input, scope, 'Unavailable')));
      var failure = firstDefined(state.error, state.failure, flatScopeValue(input, scope, 'Error'));
      var failureCode = singleLine(failure && failure.code ? failure.code : failure).toLowerCase();

      if (stateName === 'saving') pendingCount = Math.max(1, pendingCount);
      if (stateName === 'loading') addIssue(scope, 'loading', 'wait', 1);
      if (stateName === 'unsaved' || stateName === 'dirty') dirty = true;
      if (stateName === 'cached' || stateName === 'cache') fromCache = true;
      if (stateName === 'permission-denied' || stateName === 'denied') denied = true;
      if (stateName === 'conflict') conflict = true;
      if (stateName === 'unavailable' || stateName === 'offline') unavailable = true;
      if (failureCode === 'permission-denied') denied = true;
      if (failureCode === 'unavailable' || failureCode === 'deadline-exceeded') unavailable = true;

      if (dirty) addIssue(scope, 'dirty', 'wait', 1);
      if (countValue(debounce)) addIssue(scope, 'debounce', 'wait', countValue(debounce));
      if (pendingCount) addIssue(scope, 'pending', 'wait', pendingCount);
      if (fromCache) addIssue(scope, 'cache', authority === AUTHORITY.SERVER ? 'block' : 'warning', 1);
      if (denied) addIssue(scope, 'denied', authority === AUTHORITY.SERVER ? 'block' : 'warning', 1);
      if (conflict) addIssue(scope, 'conflict', 'block', 1);
      if (unavailable) addIssue(scope, 'unavailable', authority === AUTHORITY.SERVER ? 'block' : 'warning', 1);
      if ((stateName === 'failed' || stateName === 'error' || failure) && !denied && !unavailable && !fromCache && !conflict) {
        addIssue(scope, 'failed', authority === AUTHORITY.SERVER ? 'block' : 'warning', 1);
      }
    });

    issues.sort(function (a, b) {
      return (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
        || (SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope])
        || stableCompare(a.code, b.code);
    });
    var blocking = issues.filter(function (issue) { return issue.severity === 'block'; });
    var waiting = issues.filter(function (issue) { return issue.severity === 'wait'; });
    var warnings = issues.filter(function (issue) { return issue.severity === 'warning'; });
    var status = blocking.length ? READINESS_STATUS.BLOCKED
      : waiting.length ? READINESS_STATUS.WAITING
        : authority === AUTHORITY.LOCAL ? READINESS_STATUS.LOCAL
          : authority === AUTHORITY.UNPUBLISHED ? READINESS_STATUS.UNPUBLISHED
            : READINESS_STATUS.READY;
    var canExport = !blocking.length && !waiting.length;
    return deepFreeze({
      kind: READINESS_KIND,
      authority: authority,
      status: status,
      canExport: canExport,
      authoritative: canExport && authority === AUTHORITY.SERVER,
      requiresLabel: authority !== AUTHORITY.SERVER,
      label: authorityLabel(authority),
      pendingCount: waiting.reduce(function (total, issue) { return total + issue.count; }, 0),
      blockingCount: blocking.length,
      issues: issues,
      warnings: warnings
    });
  }

  function humanizeId(value) {
    return singleLine(stringValue(value).replace(/^(?:paperwork|position)_/, '').replace(/[_-]+/g, ' '));
  }

  function idFromLabel(prefix, value) {
    var label = singleLine(value);
    return label ? prefix + '_' + fingerprint(label).slice(3, 15) : '';
  }

  function pairedPaperwork(source) {
    var ids = Array.isArray(source.paperworkIds) ? source.paperworkIds : [];
    var labels = Array.isArray(source.paperworkLabels) ? source.paperworkLabels
      : Array.isArray(source.paperwork) ? source.paperwork
        : source.paperwork ? [source.paperwork] : [];
    var count = Math.max(ids.length, labels.length);
    var seen = new Set();
    var output = [];
    for (var i = 0; i < count; i += 1) {
      var label = stringValue(labels[i] == null ? humanizeId(ids[i]) : labels[i]);
      var id = cleanId(ids[i]) || idFromLabel('paperwork', label);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      output.push({ id: id, label: label || humanizeId(id) });
    }
    return output;
  }

  function normalizeAssignment(source) {
    source = isObject(source) ? source : {};
    var profileId = cleanId(source.profileId || source.studentProfileId || source.canonicalProfileId);
    if (!profileId) throw new Error('Canonical export assignment is missing profileId.');
    var productionSession = singleLine(source.productionSession || source.sessionCode || source.session || source.code).toUpperCase();
    if (!productionSession) throw new Error('Canonical export assignment is missing productionSession.');
    var displayName = stringValue(source.displayName || source.studentName || source.person || source.name);
    if (!displayName) throw new Error('Canonical export assignment is missing displayName.');
    var positionLabel = stringValue(source.positionLabel || source.position || source.role);
    var positionId = cleanId(source.positionId || source.crewPositionId) || idFromLabel('position', positionLabel);
    if (!positionId) throw new Error('Canonical export assignment is missing positionId.');
    var paperwork = pairedPaperwork(source);
    var assignmentId = cleanId(source.assignmentId || source.id)
      || 'assignment_' + fingerprint(profileId + '|' + positionId).slice(3);
    var status = singleLine(source.status).toLowerCase();
    if (status !== 'completed') status = 'assigned';
    var record = {
      assignmentId: assignmentId,
      productionSession: productionSession,
      profileId: profileId,
      displayName: displayName,
      positionId: positionId,
      positionLabel: positionLabel || humanizeId(positionId),
      paperworkIds: paperwork.map(function (item) { return item.id; }),
      paperworkLabels: paperwork.map(function (item) { return item.label; }),
      status: status,
      assignedBy: cleanId(source.assignedBy || source.updatedBy || source.createdBy) || 'unknown',
      assignedByLabel: stringValue(source.assignedByLabel || source.updatedByLabel || source.assignedBy || source.updatedBy || source.createdBy || 'Unknown'),
      createdAt: timestampMs(source.createdAt || source.assignedAt || source.updatedAt),
      updatedAt: timestampMs(source.updatedAt || source.assignedAt || source.createdAt),
      revision: Math.max(1, nonnegativeInteger(source.revision || 1))
    };
    return record;
  }

  function normalizeAssignments(records) {
    records = Array.isArray(records) ? records : isObject(records) ? Object.keys(records).map(function (key) {
      var record = records[key];
      return isObject(record) && !record.assignmentId ? Object.assign({ assignmentId: key }, record) : record;
    }) : [];
    var byId = new Map();
    records.forEach(function (source) {
      var record = normalizeAssignment(source);
      var prior = byId.get(record.assignmentId);
      if (!prior || record.revision > prior.revision ||
        (record.revision === prior.revision && record.updatedAt > prior.updatedAt)) {
        byId.set(record.assignmentId, record);
      }
    });
    return Array.from(byId.values()).sort(function (a, b) {
      return stableCompare(a.profileId, b.profileId)
        || stableCompare(a.positionLabel, b.positionLabel)
        || stableCompare(a.positionId, b.positionId)
        || stableCompare(a.assignmentId, b.assignmentId);
    });
  }

  function profileAliasIndex(source) {
    var profiles = Array.isArray(source) ? source : isObject(source) && Array.isArray(source.profiles) ? source.profiles : [];
    var explicit = isObject(source) && isObject(source.aliasMap) ? source.aliasMap
      : isObject(source) && isObject(source.aliases) && !Array.isArray(source.aliases) ? source.aliases
        : (!Array.isArray(source) && isObject(source) && !source.profiles ? source : {});
    var direct = new Map();
    var labels = new Map();
    profiles.forEach(function (profile) {
      if (!isObject(profile)) return;
      var canonical = cleanId(profile.profileId || profile.canonicalProfileId || profile.id);
      if (!canonical) return;
      direct.set(canonical, canonical);
      var label = stringValue(profile.displayName || profile.fullName || profile.name);
      if (label) labels.set(canonical, label);
      [profile.profileAliases, profile.aliases, profile.previousProfileIds,
        profile.mergedProfileIds].forEach(function (list) {
        if (!Array.isArray(list)) return;
        list.forEach(function (alias) {
          alias = cleanId(alias && typeof alias === 'object' ? alias.profileId || alias.id : alias);
          if (alias) direct.set(alias, canonical);
        });
      });
    });
    Object.keys(explicit).forEach(function (alias) {
      var from = cleanId(alias);
      var to = cleanId(explicit[alias]);
      if (from && to) direct.set(from, to);
    });

    function resolve(value) {
      var current = cleanId(value);
      var seen = new Set();
      while (direct.has(current) && direct.get(current) !== current && !seen.has(current)) {
        seen.add(current);
        current = direct.get(current);
      }
      return current;
    }

    var aliasesByCanonical = new Map();
    direct.forEach(function (target, alias) {
      var canonical = resolve(target);
      if (!aliasesByCanonical.has(canonical)) aliasesByCanonical.set(canonical, new Set([canonical]));
      aliasesByCanonical.get(canonical).add(alias);
    });
    return { resolve: resolve, aliasesByCanonical: aliasesByCanonical, labels: labels };
  }

  function groupAssignments(records, aliasSource) {
    var normalized = normalizeAssignments(records);
    var aliases = profileAliasIndex(aliasSource || {});
    var byProfile = new Map();
    normalized.forEach(function (record) {
      var profileId = aliases.resolve(record.profileId) || record.profileId;
      if (!byProfile.has(profileId)) byProfile.set(profileId, []);
      byProfile.get(profileId).push(record);
    });
    var groups = [];
    byProfile.forEach(function (profileRecords, profileId) {
      profileRecords.sort(function (a, b) {
        return stableCompare(a.positionLabel, b.positionLabel)
          || stableCompare(a.positionId, b.positionId)
          || stableCompare(a.assignmentId, b.assignmentId);
      });
      var latest = profileRecords.slice().sort(function (a, b) {
        return b.updatedAt - a.updatedAt || b.revision - a.revision || stableCompare(a.assignmentId, b.assignmentId);
      })[0];
      var profileLabel = aliases.labels.get(profileId);
      var identitySet = aliases.aliasesByCanonical.get(profileId) || new Set([profileId]);
      profileRecords.forEach(function (record) { identitySet.add(record.profileId); });
      var paperworkById = new Map();
      var roles = profileRecords.map(function (record) {
        var rolePaperwork = record.paperworkIds.map(function (id, index) {
          var label = record.paperworkLabels[index] || humanizeId(id);
          if (!paperworkById.has(id)) paperworkById.set(id, {
            paperworkId: id,
            paperworkLabel: label,
            assignmentIds: new Set(),
            positionIds: new Set()
          });
          paperworkById.get(id).assignmentIds.add(record.assignmentId);
          paperworkById.get(id).positionIds.add(record.positionId);
          return { paperworkId: id, paperworkLabel: label };
        });
        return {
          assignmentId: record.assignmentId,
          positionId: record.positionId,
          positionLabel: record.positionLabel,
          status: record.status,
          paperwork: rolePaperwork,
          assignedBy: record.assignedBy,
          assignedByLabel: record.assignedByLabel,
          updatedAt: record.updatedAt,
          revision: record.revision
        };
      });
      var paperwork = Array.from(paperworkById.values()).map(function (item) {
        return {
          paperworkId: item.paperworkId,
          paperworkLabel: item.paperworkLabel,
          assignmentIds: Array.from(item.assignmentIds).sort(stableCompare),
          positionIds: Array.from(item.positionIds).sort(stableCompare)
        };
      }).sort(function (a, b) {
        return stableCompare(a.paperworkLabel, b.paperworkLabel) || stableCompare(a.paperworkId, b.paperworkId);
      });
      groups.push({
        profileId: profileId,
        identityIds: Array.from(identitySet).map(cleanId).filter(Boolean).sort(stableCompare),
        displayName: profileLabel || latest.displayName,
        assignmentIds: profileRecords.map(function (record) { return record.assignmentId; }).sort(stableCompare),
        roles: roles,
        paperwork: paperwork,
        updatedAt: profileRecords.reduce(function (maximum, record) { return Math.max(maximum, record.updatedAt); }, 0)
      });
    });
    groups.sort(function (a, b) {
      return stableCompare(a.displayName, b.displayName) || stableCompare(a.profileId, b.profileId);
    });
    return groups;
  }

  function normalizeRevisions(source) {
    source = isObject(source) ? source : {};
    var prePro = isObject(source.prePro) ? source.prePro : {};
    var notes = isObject(source.notes) ? source.notes : {};
    var tokens = firstDefined(source.tokens, source.extra, source.additional, {});
    var output = {
      sessionRevision: nonnegativeInteger(firstDefined(source.sessionRevision, source.revision, 0)),
      sessionUpdatedAt: timestampMs(firstDefined(source.sessionUpdatedAt, source.updatedAt, 0)),
      rundownBatchId: singleLine(firstDefined(source.rundownBatchId, source.rundownRevision, '')),
      rundownUpdatedAt: timestampMs(firstDefined(source.rundownUpdatedAt, 0)),
      preProUpdatedAt: timestampMs(firstDefined(source.preProUpdatedAt, prePro.updatedAt, 0)),
      assignmentRevision: nonnegativeInteger(firstDefined(source.assignmentRevision, 0)),
      assignmentUpdatedAt: timestampMs(firstDefined(source.assignmentUpdatedAt, 0)),
      notesRevision: nonnegativeInteger(firstDefined(source.notesRevision, notes.revision, 0)),
      notesUpdatedAt: timestampMs(firstDefined(source.notesUpdatedAt, notes.updatedAt, 0)),
      notesFingerprint: singleLine(firstDefined(source.notesFingerprint, notes.fingerprint, '')),
      tokens: isObject(tokens) || Array.isArray(tokens) ? deepClone(tokens) : { value: stringValue(tokens) }
    };
    return output;
  }

  function compareRevisionFence(before, after) {
    var normalizedBefore = normalizeRevisions(before);
    var normalizedAfter = normalizeRevisions(after);
    var beforeFingerprint = fingerprint(normalizedBefore);
    var afterFingerprint = fingerprint(normalizedAfter);
    return deepFreeze({
      stable: beforeFingerprint === afterFingerprint,
      before: normalizedBefore,
      after: normalizedAfter,
      beforeFingerprint: beforeFingerprint,
      afterFingerprint: afterFingerprint
    });
  }

  async function captureWithRevisionFence(config) {
    config = isObject(config) ? config : {};
    var readRevision = config.readRevision || config.readFence;
    var readBefore = config.readBefore || readRevision;
    var readAfter = config.readAfter || readRevision;
    var readData = config.readData || config.readSnapshot;
    if (typeof readBefore !== 'function' || typeof readAfter !== 'function' || typeof readData !== 'function') {
      throw new TypeError('captureWithRevisionFence requires revision and data readers.');
    }
    var maxAttempts = Math.max(1, Math.min(10, nonnegativeInteger(config.maxAttempts || 3)));
    var history = [];
    for (var attempt = 1; attempt <= maxAttempts; attempt += 1) {
      var before = normalizeRevisions(await readBefore({ attempt: attempt, stage: 'before' }));
      var data = await readData({ attempt: attempt, stage: 'data', before: before });
      var after = normalizeRevisions(await readAfter({ attempt: attempt, stage: 'after', before: before, data: data }));
      var comparison = compareRevisionFence(before, after);
      history.push({
        attempt: attempt,
        stable: comparison.stable,
        beforeFingerprint: comparison.beforeFingerprint,
        afterFingerprint: comparison.afterFingerprint
      });
      var accepted = typeof config.isStable === 'function'
        ? Boolean(await config.isStable(comparison, data, attempt)) : comparison.stable;
      if (accepted) {
        return deepFreeze({
          data: deepClone(data),
          revisions: comparison.after,
          attempts: attempt,
          fingerprint: comparison.afterFingerprint,
          history: history
        });
      }
    }
    var error = new Error('Export state changed while the authoritative snapshot was being read.');
    error.code = 'export-revision-conflict';
    error.attempts = maxAttempts;
    error.history = deepFreeze(deepClone(history));
    throw error;
  }

  function normalizeShow(source, fallbackName) {
    source = isObject(source) ? deepClone(source) : {};
    source.name = stringValue(firstDefined(source.name, fallbackName, 'Untitled Show'));
    source.start = stringValue(firstDefined(source.start, source.startTime, ''));
    source.freeMode = Boolean(firstDefined(source.freeMode, false));
    return source;
  }

  function normalizeBeat(source, index) {
    source = isObject(source) ? deepClone(source) : {};
    if (source.id == null || source.id === '') source.id = 'beat_' + fingerprint({ index: index, beat: source }).slice(3);
    source.id = stringValue(source.id);
    source.style = stringValue(source.style || 'flex');
    source.info = stringValue(source.info);
    source.notes = stringValue(source.notes);
    source.min = finiteNumber(source.min, 0);
    source.sec = finiteNumber(source.sec, 0);
    source.done = Boolean(source.done);
    source.cues = isObject(source.cues) ? source.cues : {};
    return source;
  }

  function normalizeNotes(records) {
    records = Array.isArray(records) ? records : [];
    return records.map(function (source, index) {
      var note = isObject(source) ? deepClone(source) : { text: stringValue(source) };
      if (!note.id) note.id = 'note_' + fingerprint({ index: index, note: note }).slice(3);
      note.id = stringValue(note.id);
      note.text = stringValue(note.text);
      if (note.at != null) note.at = timestampMs(note.at);
      if (note.editedAt != null) note.editedAt = timestampMs(note.editedAt);
      if (note.doneAt != null) note.doneAt = timestampMs(note.doneAt);
      return note;
    }).sort(function (a, b) {
      return finiteNumber(a.at, 0) - finiteNumber(b.at, 0)
        || stableCompare(a.id, b.id)
        || stableCompare(fingerprint(a), fingerprint(b));
    });
  }

  function normalizeOptions(source) {
    source = isObject(source) ? deepClone(source) : {};
    source.includeNotes = source.includeNotes === true;
    source.includeAssignments = source.includeAssignments !== false;
    source.includeCompletedAssignments = source.includeCompletedAssignments !== false;
    source.documentType = singleLine(source.documentType || 'package');
    return source;
  }

  function normalizeProduction(input, show, assignments) {
    var source = isObject(input.production) ? input.production : {};
    var assignmentCode = assignments.length ? assignments[0].productionSession : '';
    var sessionCode = singleLine(firstDefined(source.sessionCode, source.productionSession,
      source.code, input.sessionCode, input.productionSession, assignmentCode, '')).toUpperCase();
    var name = stringValue(firstDefined(source.name, source.showName, input.showName, show.name, 'Untitled Show'));
    var productionId = cleanId(firstDefined(source.productionId, source.id, sessionCode, name));
    var identity = stringValue(firstDefined(source.identity, sessionCode || productionId || name));
    return {
      productionId: productionId,
      sessionCode: sessionCode,
      name: name,
      identity: identity
    };
  }

  function coerceReadiness(input, authority) {
    if (input && input.kind === READINESS_KIND && Array.isArray(input.issues)) {
      if (input.authority !== authority) {
        var error = new Error('Export readiness authority does not match the requested snapshot authority.');
        error.code = 'export-authority-mismatch';
        throw error;
      }
      return input;
    }
    var source = isObject(input) ? Object.assign({}, input) : {};
    source.authority = authority;
    return assessReadiness(source);
  }

  function createSnapshot(input, config) {
    input = isObject(input) ? input : {};
    config = isObject(config) ? config : {};
    var authority = normalizeAuthority(input.authority, input);
    var readiness = coerceReadiness(input.readiness, authority);
    if (!readiness.canExport && config.allowUnready !== true) {
      var readinessError = new Error('Export snapshot cannot be created until readiness issues are resolved.');
      readinessError.code = 'export-not-ready';
      readinessError.readiness = readiness;
      throw readinessError;
    }
    var options = normalizeOptions(input.options);
    var assignments = options.includeAssignments
      ? normalizeAssignments(input.canonicalAssignments || input.assignments || []) : [];
    var show = normalizeShow(input.show, input.showName);
    var production = normalizeProduction(input, show, assignments);
    assignments.forEach(function (record) {
      if (production.sessionCode && record.productionSession !== production.sessionCode) {
        var error = new Error('Canonical assignment belongs to a different production session.');
        error.code = 'export-assignment-session-mismatch';
        throw error;
      }
    });
    var labelsSource = isObject(input.labels) ? input.labels : {};
    var customDocumentLabel = stringValue(labelsSource.document || input.documentLabel || '');
    var labels = {
      authority: authorityLabel(authority),
      document: authority === AUTHORITY.SERVER ? customDocumentLabel
        : authorityLabel(authority) + (customDocumentLabel ? ' · ' + customDocumentLabel : '')
    };
    var exportedAt = timestampMs(firstDefined(input.exportedAt,
      typeof config.now === 'function' ? config.now() : config.now,
      Date.now()));
    var notes = options.includeNotes ? normalizeNotes(input.notes || []) : [];
    var aliasSource = input.profileAliases || input.aliasMap
      ? { profiles: input.profiles || [], aliasMap: input.aliasMap || input.profileAliases || {} }
      : input.profiles || {};
    var core = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      kind: EXPORT_KIND,
      authority: authority,
      publicationStatus: authority === AUTHORITY.SERVER ? 'saved'
        : authority === AUTHORITY.LOCAL ? 'local-draft' : 'unpublished-draft',
      authoritative: authority === AUTHORITY.SERVER && readiness.authoritative,
      localOnly: authority !== AUTHORITY.SERVER,
      unpublished: authority === AUTHORITY.UNPUBLISHED,
      labels: labels,
      production: production,
      exportedAt: exportedAt,
      revisions: normalizeRevisions(input.revisions || input.session || {}),
      show: show,
      beats: (Array.isArray(input.beats) ? input.beats : []).map(normalizeBeat),
      prePro: isObject(input.prePro) ? deepClone(input.prePro) : {},
      assignments: assignments,
      assignmentGroups: groupAssignments(assignments, aliasSource),
      notes: notes,
      options: options,
      readiness: readiness
    };
    var contentFingerprint = fingerprint(core);
    var snapshot = Object.assign({
      snapshotId: 'export_' + contentFingerprint.slice(3),
      fingerprint: contentFingerprint
    }, core);
    return deepFreeze(snapshot);
  }

  return Object.freeze({
    EXPORT_SCHEMA_VERSION: EXPORT_SCHEMA_VERSION,
    EXPORT_KIND: EXPORT_KIND,
    READINESS_KIND: READINESS_KIND,
    AUTHORITY: AUTHORITY,
    READINESS_STATUS: READINESS_STATUS,
    CANONICAL_ASSIGNMENT_FIELDS: CANONICAL_ASSIGNMENT_FIELDS,
    REVISION_FIELDS: REVISION_FIELDS,
    deepClone: deepClone,
    deepFreeze: deepFreeze,
    stableStringify: stableStringify,
    fingerprint: fingerprint,
    normalizeAuthority: normalizeAuthority,
    authorityLabel: authorityLabel,
    assessReadiness: assessReadiness,
    normalizeAssignment: normalizeAssignment,
    normalizeAssignments: normalizeAssignments,
    groupAssignments: groupAssignments,
    normalizeRevisions: normalizeRevisions,
    compareRevisionFence: compareRevisionFence,
    captureWithRevisionFence: captureWithRevisionFence,
    withRevisionFence: captureWithRevisionFence,
    createSnapshot: createSnapshot
  });
});
