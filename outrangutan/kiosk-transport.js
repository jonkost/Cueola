/* Outrangutan kiosk transport helpers.
 *
 * Shared by the controller (outrangutan.js) and the output renderer
 * (output.html) when Outrangutan drives kiosk-mode Chrome instances through
 * the local kiosk helper daemon (scripts/kiosk-helper.mjs). Kiosk Chrome runs
 * in its own profile, so BroadcastChannel and window.opener never reach it —
 * every envelope rides the helper's loopback SSE + POST relay instead, and
 * media blobs are fetched from the helper's cache into the kiosk profile's
 * own IndexedDB.
 *
 * Dependency-free and DOM-free so it loads in both pages and in Node tests.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CueolaKioskTransport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULT_HELPER_HOST = '127.0.0.1:17845';
  var HELPER_APP = 'cueola-kiosk-helper';
  // Must match the helper daemon's Origin allowlist.
  var HELPER_HOST_RE = /^127\.0\.0\.1(:\d+)?$/;

  /* 'helper' hash/query param value -> 'http://127.0.0.1:17845' base, or ''
   * when the value is missing/not loopback (a hostile URL must never make the
   * renderer fetch media from an arbitrary host). */
  function helperBase(hostPort) {
    var value = String(hostPort == null ? '' : hostPort).trim();
    if (!value) return '';
    if (!value.includes(':')) value += ':' + DEFAULT_HELPER_HOST.split(':')[1];
    if (!HELPER_HOST_RE.test(value)) return '';
    return 'http://' + value;
  }

  function eventsUrl(base, options) {
    var params = [];
    params.push('role=' + encodeURIComponent(options.role || 'unknown'));
    params.push('session=' + encodeURIComponent(options.session || ''));
    if (options.output != null) params.push('output=' + encodeURIComponent(options.output));
    params.push('instance=' + encodeURIComponent(options.instance || ''));
    return base + '/events?' + params.join('&');
  }

  function sendBody(session, senderInstance, envelope) {
    return JSON.stringify({ session: session, senderInstance: senderInstance, envelope: envelope });
  }

  /* Absolute kiosk launch URL. Kiosk Chrome cannot resolve the controller's
   * relative outputUrl(); origin comes from the controller's own location.
   * The launch token defeats HTTP caching of the page, and the helper param
   * tells the renderer where to connect. */
  function buildKioskLaunchUrl(origin, relativeOutputUrl, helperHostPort, launchToken) {
    var url = String(relativeOutputUrl || '');
    var hashIndex = url.indexOf('#');
    var page = hashIndex === -1 ? url : url.slice(0, hashIndex);
    var hash = hashIndex === -1 ? '' : url.slice(hashIndex + 1);
    var extra = 'helper=' + encodeURIComponent(String(helperHostPort || DEFAULT_HELPER_HOST));
    var base = String(origin || '').replace(/\/$/, '');
    return base + '/' + page.replace(/^\.?\//, '')
      + '?launch=' + encodeURIComponent(String(launchToken || ''))
      + '#' + (hash ? hash + '&' : '') + extra;
  }

  /* Media ids a kiosk renderer needs: cue media only. Pads never render in
   * output windows (pad/SFX audio rides the controller's own audio graph). */
  function neededIds(cues) {
    var seen = {};
    var ids = [];
    (Array.isArray(cues) ? cues : []).forEach(function (cue) {
      var id = cue && cue.mediaId;
      if (!id || seen[id]) return;
      seen[id] = true;
      ids.push(String(id));
    });
    return ids;
  }

  return {
    DEFAULT_HELPER_HOST: DEFAULT_HELPER_HOST,
    HELPER_APP: HELPER_APP,
    helperBase: helperBase,
    eventsUrl: eventsUrl,
    sendBody: sendBody,
    buildKioskLaunchUrl: buildKioskLaunchUrl,
    neededIds: neededIds
  };
});
