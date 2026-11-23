/* Prompter mockups: draws the pieces that repeat on every page, so the
   control set is truly ONE definition. Design only. Not loaded by the app. */
(function () {
  var PAGES = [
    ['index.html', 'Start here'],
    ['01-controls.html', 'The one control set'],
    ['02-talent.html', 'Talent screen'],
    ['03-live-operator.html', 'Operator inside Live'],
    ['04-operator.html', 'Stand-alone operator'],
    ['05-show-code.html', 'Show codes'],
    ['06-settings.html', 'Settings'],
    ['07-script.html', 'Script and formatting'],
    ['08-stream-deck.html', 'Stream Deck'],
    ['09-rundown-cue.html', 'Script cue in the rundown'],
    ['10-states.html', 'Empty and error states']
  ];

  // The fifteen controls. Same name, order and icon everywhere.
  // Three groups of five = the three rows of a Stream Deck.
  var CONTROLS = [
    { g: 'Roll', id: 'prev', label: 'Prev row', sym: 'pt.prev', key: '↑', does: 'Jump to the start of the row before.' },
    { g: 'Roll', id: 'back', label: 'Back', sym: 'pt.back', key: '←', does: 'Hold to roll backward. Let go and it stops.' },
    { g: 'Roll', id: 'play', label: 'Play', sym: 'pt.play', key: 'Space', does: 'Start the roll. While rolling it reads Pause.' },
    { g: 'Roll', id: 'ahead', label: 'Ahead', sym: 'pt.ahead', key: '→', does: 'Hold to roll forward fast. Let go and it stops.' },
    { g: 'Roll', id: 'next', label: 'Next row', sym: 'pt.next', key: '↓', does: 'Jump to the start of the next row.' },
    { g: 'Place and speed', id: 'top', label: 'Top', sym: 'pt.top', key: 'T', does: 'Stop and go to the top of the script.' },
    { g: 'Place and speed', id: 'follow', label: 'Follow', sym: 'pt.follow', key: 'F', does: 'On: every TAKE cues the prompter to that row. Off: you place it by hand.' },
    { g: 'Place and speed', id: 'slower', label: 'Slower', pm: '−', key: '[', does: 'Speed down by 5.' },
    { g: 'Place and speed', id: 'speed', label: 'Speed', val: '60', key: '', does: 'Shows the speed the talent screen is really running at.' },
    { g: 'Place and speed', id: 'faster', label: 'Faster', pm: '+', key: ']', does: 'Speed up by 5.' },
    { g: 'On screen', id: 'clock', label: 'Clock', sym: 'time.clock', key: 'C', does: 'Show or hide the clock for the talent. Hold for which clock.' },
    { g: 'On screen', id: 'slate', label: 'Slate', sym: 'content.display', key: 'S', does: 'Cover the script with Standby. Hold for bars or tech difficulties.' },
    { g: 'On screen', id: 'message', label: 'Message', sym: 'pt.message', key: 'M', does: 'Send the talent a short message or a question.' },
    { g: 'On screen', id: 'wrap', label: 'Wrap', sym: 'pt.wrap', key: 'W', does: 'Show a wrap up countdown for the talent.' },
    { g: 'On screen', id: 'clear', label: 'Clear', sym: 'action.close', key: 'Esc', does: 'Take everything off the screen but the script.' }
  ];
  window.PT_CONTROLS = CONTROLS;

  function sym(name) { return '<span class="sf-symbol" data-symbol="' + name + '" aria-hidden="true"></span>'; }
  window.sym = sym;

  function face(c, st, cls) {
    var k = cls, label = c.label, inner;
    if (c.id === 'play') { k += ' play'; if (st.rolling) { k += ' rolling'; label = 'Pause'; } }
    if (c.id === 'follow' && st.follow !== false) k += ' lit cy';
    if (st.on && st.on.indexOf(c.id) >= 0) k += ' lit yl';
    if (c.id === 'speed') k += ' read';
    if (c.sym) inner = sym(c.id === 'play' && st.rolling ? 'pt.pause' : c.sym);
    else if (c.pm) inner = '<span class="pm">' + c.pm + '</span>';
    else inner = '<span class="val">' + (st.speed || c.val) + '</span>';
    return '<button class="' + k + '" type="button">' + inner + '<span>' + label + '</span></button>';
  }

  // st: { size:'compact'|'touch', rolling, follow, on:['clock'], off, captions:false, speed }
  window.ptStrip = function (st) {
    st = st || {};
    var groups = {}, order = [];
    CONTROLS.forEach(function (c) { if (!groups[c.g]) { groups[c.g] = []; order.push(c.g); } groups[c.g].push(c); });
    return '<div class="strip ' + (st.size || '') + (st.off ? ' off' : '') + '">' + order.map(function (g) {
      return '<div class="grp">' + (st.captions === false ? '' : '<div class="gcap">' + g + '</div>') +
        '<div class="keys">' + groups[g].map(function (c) { return face(c, st, 'ck'); }).join('') + '</div></div>';
    }).join('') + '</div>';
  };
  window.ptDeckKey = function (id, st, extra) {
    var c = CONTROLS.filter(function (x) { return x.id === id; })[0];
    return face(c, st || {}, 'dk' + (extra ? ' ' + extra : '')).replace(/<button/, '<div').replace(/button>$/, 'div>').replace(' type="button"', '');
  };

  // ---------- Talent screen ----------
  var SAY = '<span class="t-spk">HOST</span><p>Good evening and welcome to Campus News. Tonight, <span class="t-em">three big stories</span> from around campus.</p>';
  var PAST = '<div class="t-past"><p>Tonight on Campus News.</p><div class="t-row"><i>3</i>Anchor Wide: Welcome</div></div>';
  var NOW = '<div class="t-now">' +
    SAY +
    '<span class="t-note">TURN TO CAMERA 2</span><p>First, the student council voted last night on next year\'s budget.</p></div>';
  var NOW_S = '<div class="t-now">' + SAY + '</div>';
  var ARROWS = '<span class="t-arrow l"></span><span class="t-arrow r"></span>';
  function bar(link) {
    return '<div class="t-bar"><b>Campus News: Demo Show</b><span class="dim num">DEMO1</span><span class="sp"></span>' +
      '<span>Row 3 · Anchor Wide: Welcome</span><span class="dim num">0:14 left</span><span class="sp"></span>' + link + '</div>';
  }
  var LINKED = '<span class="t-pill ok">● LINKED · MAYA</span>';
  var FOOT = '<div class="t-foot"><span class="t-pill">NEXT · 4 Anchor Lower Third</span><span class="sp"></span><span class="t-pill num">7:02:14 PM</span></div>';
  function dock(st) { return '<div class="t-dock">' + window.ptStrip(st) + '</div>'; }

  var TALENT = {
    rolling: function () { return '<div class="t-air"></div>' + PAST + NOW + ARROWS + '<div class="t-foot"><span class="t-pill air">ON AIR</span><span class="t-pill">NEXT · 4 Anchor Lower Third</span><span class="sp"></span><span class="t-pill num">0:14 left in row</span></div>'; },
    paused: function () { return PAST + NOW_S + ARROWS + bar('<span class="t-pill warn">PAUSED</span>' + LINKED) + dock({ follow: true }); },
    clock: function () { return '<div class="t-air"></div>' + PAST + NOW + ARROWS + '<div class="t-clock"><small>SHOW ENDS IN</small><b>04:32</b></div>' + FOOT; },
    message: function () { return '<div class="t-air"></div>' + NOW + ARROWS + '<div class="t-msg"><small>FROM THE BOOTH</small>WRAP UP · 2:00</div>' + FOOT; },
    question: function () { return NOW + ARROWS + '<div class="t-msg" style="background:#5b8df8;color:#fff"><small>QUESTION</small>What surprised you most?</div>' + FOOT; },
    slate: function () { return '<div class="t-cover"><p style="letter-spacing:.2em;font-weight:800">CAMPUS NEWS: DEMO SHOW</p><h3>STANDBY</h3><div class="big">7:00:00 PM</div><p>Show starts in 2:14. The script is loaded and ready.</p></div>'; },
    bars: function () { return '<div class="t-cover bars"><h3>COLOR BARS</h3></div>'; },
    tech: function () { return '<div class="t-cover"><h3>TECHNICAL DIFFICULTIES</h3><p>Please stand by. Keep your place. The booth will cue you.</p></div>'; },
    lost: function () { return '<div class="t-air"></div>' + PAST + NOW_S + ARROWS + bar('<span class="t-pill warn">LINK LOST · STILL ROLLING · CONTROLS ARE HERE</span>') + dock({ rolling: true, follow: false }); },
    back: function () { return '<div class="t-air"></div>' + PAST + NOW + ARROWS + bar('<span class="t-pill ok">● LINKED AGAIN · MAYA HAS THE CONTROLS</span>') + FOOT; },
    gap: function () {
      return '<div class="t-past"><p>More after this.</p><div class="t-row"><i>5</i>PKG: Student Council · clip 2:15</div><div class="t-row"><i>6</i>Back to Anchor · no script</div>' +
        '<div class="t-row"><i>7</i>Guest Conversation</div></div><div class="t-now"><span class="t-spk">HOST</span><p>Joining me now is the council treasurer.</p><div class="t-stop">STOP · AD LIB</div></div>' + ARROWS +
        '<div class="t-clock"><small>CLIP ENDS IN</small><b>01:48</b></div>' + FOOT;
    },
    waiting: function () { return '<div class="t-cover"><p style="letter-spacing:.2em;font-weight:800">THIS SCREEN IS LINKED TO</p><div class="big">DEMO1</div><h3 style="font-size:3.4cqw">Campus News: Demo Show</h3><p>Waiting for a script. Write it in the rundown\'s Script column and it shows up here.</p></div>'; },
    nolink: function () { return '<div class="t-cover"><h3 style="font-size:3.6cqw">This prompter is not linked to a show</h3><p>Pick a show or type a show code to begin.</p></div>'; },
    self: function () { return PAST + NOW_S + ARROWS + bar('<span class="t-pill">NO OPERATOR · YOU HAVE THE CONTROLS</span>') + dock({ follow: true, size: '' }); }
  };
  window.ptTalent = function (state, attrs) {
    return '<div class="tal" ' + (attrs || '') + '>' + (TALENT[state] || TALENT.rolling)() + '</div>';
  };


  // ---------- Rundown table (same columns as the app; never simplified) ----------
  var ROWS = [
    [1, 'Countdown Slate', 'Roll to air', '00:30', null, ['a', 'STANDBY', 'Theme Bed', 'GO', 'Play Theme Bed'], null, ['g', 'STANDBY', 'Countdown', 'INSERT', 'Countdown'], null, null],
    [2, 'Show Open', 'Theme up full, under at open', '00:15', ['v', 'READY', 'Set OPEN', 'TAKE', 'Dissolve OPEN'], ['a', 'STANDBY', 'Theme Full', 'GO', 'Play Theme Full'], null, ['g', 'STANDBY', 'Title', 'INSERT', 'Title'], null, ['s', 'STANDBY', 'Host', 'CUE', 'Host', '1 line · 0:03']],
    [3, 'Anchor Wide: Welcome', '', '00:20', ['v', 'READY', 'CAM 1', 'TAKE', 'CAM 1'], ['a', 'STANDBY', 'Anchor Mics', 'GO', 'Open Mics 1+2'], null, null, null, ['s', 'STANDBY', 'Host', 'CUE', 'Host', '4 lines · 0:14']],
    [4, 'Anchor Lower Third', 'Name / Title', '00:05', null, null, null, ['g', 'STANDBY', 'Lower Third', 'INSERT', 'Lower Third'], null, null],
    [5, 'PKG: Student Council', 'Nat sound up full', '02:15', ['v', 'READY', 'Set FULL SCREEN', 'TAKE', 'Dissolve to PKG'], ['a', 'STANDBY', 'PKG Audio', 'GO', 'Up PKG SOT'], ['p', 'ROLL', 'SC_042', 'OUT', 'Back to CAM 2'], null, null, null],
    [6, 'Back to Anchor', '', '00:10', ['v', 'READY', 'CAM 2', 'TAKE', 'CAM 2'], ['a', 'STANDBY', 'Anchor Mics', 'GO', 'Open Mic Host'], null, null, null, ['s', 'STANDBY', 'Host', 'CUE', 'Host', '2 lines · 0:08']],
    [7, 'Guest Conversation', '"What surprised you most?"', '05:00', ['v', 'READY', 'Set 2-SHOT', 'TAKE', 'Dissolve 2-SHOT'], ['a', 'STANDBY', 'Guest Mic', 'GO', 'Open Guest Mic'], null, null, null, ['s', 'STANDBY', 'Host', 'CUE', 'Host', '3 lines · ad lib']]
  ];
  function cue(c, mark) {
    if (!c) return '<td></td>';
    return '<td><div class="cue c-' + c[0] + '"><div><em>' + c[1] + '</em>' + c[2] + '</div><div class="go"><em>' + c[3] + '</em>' + c[4] + '</div>' +
      (c[5] ? '<div class="meta">' + c[5] + (mark || '') + '</div>' : '') + '</div></td>';
  }
  // o: { live:true adds State and Time the Live way, air: row number on air, here: row the prompter is on, max }
  window.ptRundown = function (o) {
    o = o || {};
    var dep = [['v', 'Video'], ['a', 'Audio'], ['p', 'Playback'], ['g', 'GFX'], ['l', 'Lighting'], ['s', 'Script']];
    var h = '<table class="rd' + (o.live ? ' rdl' : '') + '"><thead><tr><th>#</th>' + (o.live ? '<th>State</th>' : '') + '<th>' + (o.live ? 'Row' : 'Name') + '</th><th>' + (o.live ? 'Time' : 'Start / Dur') + '</th>' +
      dep.map(function (d) { return '<th style="color:var(--cue-' + ({ v: 'video', a: 'audio', p: 'playback', g: 'gfx', l: 'lighting', s: 'script' })[d[0]] + ')">' + d[1] + '</th>'; }).join('') + '</tr></thead><tbody>';
    ROWS.slice(0, o.max || 7).forEach(function (r) {
      var air = o.air === r[0], sby = o.air && o.air + 1 === r[0];
      h += '<tr class="' + (air ? 'air' : '') + '"><td class="n">' + r[0] + '</td>' +
        (o.live ? '<td><span class="chip ' + (air ? 'air' : sby ? 'sby' : '') + '">' + (air ? 'ON AIR' : sby ? 'STANDBY' : 'LATER') + '</span></td>' : '') +
        '<td class="nm"><b>' + r[1] + '</b><span>' + r[2] + '</span></td><td class="tm">' + r[3] + '</td>';
      for (var i = 4; i < 10; i++) h += cue(r[i], i === 9 && o.here === r[0] ? ' <span class="here">PROMPTER HERE</span>' : '');
      h += '</tr>';
    });
    return h + '</tbody></table>';
  };

  function boot() {
    var qs = new URLSearchParams(location.search);
    var theme = qs.get('theme') || 'cool';
    document.documentElement.setAttribute('data-theme', theme);
    var here = location.pathname.split('/').pop() || 'index.html';
    var i = Math.max(0, PAGES.findIndex(function (p) { return p[0] === here; }));
    var other = theme === 'white' ? 'cool' : 'white';
    var q = theme === 'white' ? '?theme=white' : '';
    if (!qs.has('bare')) {
      var b = document.createElement('div');
      b.className = 'mockbar';
      b.innerHTML = '<b>Prompter mockups</b><span>' + (i + 1) + ' of ' + PAGES.length + ' · ' + PAGES[i][1] + '</span><span class="sp"></span>' +
        '<a href="index.html' + q + '">All pages</a>' +
        (i > 0 ? '<a href="' + PAGES[i - 1][0] + q + '">Back</a>' : '') +
        (i < PAGES.length - 1 ? '<a href="' + PAGES[i + 1][0] + q + '">Next</a>' : '') +
        '<a href="' + here + '?theme=' + other + '">' + (theme === 'white' ? 'Dark' : 'Light') + '</a>';
      document.body.insertBefore(b, document.body.firstChild);
    }
    document.querySelectorAll('[data-strip]').forEach(function (el) {
      el.innerHTML = window.ptStrip(JSON.parse(el.getAttribute('data-strip') || '{}'));
    });
    document.querySelectorAll('[data-talent]').forEach(function (el) {
      el.innerHTML = window.ptTalent(el.getAttribute('data-talent'), el.getAttribute('data-pt') ? 'data-pt="' + el.getAttribute('data-pt') + '"' : '');
    });
    document.querySelectorAll('[data-deck]').forEach(function (el) {
      var st = JSON.parse(el.getAttribute('data-st') || '{}');
      el.innerHTML = el.getAttribute('data-deck').split(',').map(function (id) { return window.ptDeckKey(id.trim(), st, el.getAttribute('data-k') || ''); }).join('');
    });
    document.querySelectorAll('[data-rundown]').forEach(function (el) { el.innerHTML = window.ptRundown(JSON.parse(el.getAttribute('data-rundown') || '{}')); });
    window.PT_PAGES = PAGES;
    document.dispatchEvent(new Event('mock-ready'));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
