/* Penguin Slicer mockup: the wizard in the panel. Four steps in the CNC wizard's order
 * (Setup, Parts, Layout, Preview), advanced mode, mocked export, slicing progress, layer
 * preview and print progress, and every armed error from the scenario strip.
 * Everything here is fake: no request leaves the page. */
(function () {
  'use strict';
  var T = THREE, P = MockParts, ST = MockSettings, PL = MockPlate;
  var PLATE = ST.PRINTER.plate;
  var ORDER = ['setup', 'parts', 'layout', 'preview'];
  var MAX_COPIES = 25;                                    // print/limits.py MAX_COPIES
  var PLATE_VOLUME_CAP_CM3 = 600;                         // invented: a volume cap from the memory model
  var SLICE_TIMEOUT_S = 240;                              // print/limits.py PLATE_SLICE_TIMEOUT_S
  var TOO_MANY_COPIES_MESSAGE = 'Up to ' + MAX_COPIES + ' copies per plate; print the rest in a second job.';
  var ONE_PLATE_MESSAGE = 'Not every copy fits on one plate; lower the quantities and print the rest in a second job.';
  var PAGE_ID = 'K7Q2-9XMD';

  function $(s) { return document.querySelector(s); }
  function $all(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(label, fn, cls) { var b = el('button', 'btn small' + (cls ? ' ' + cls : ''), label); b.type = 'button'; b.addEventListener('click', fn); return b; }

  /* ------------------------------------------------------------------ mock controls */
  var Mock = {
    armed: [], speed: 'fast',
    factor: function (kind) {
      var fast = this.speed === 'fast';
      if (kind === 'print') return fast ? 900 : 60;
      if (kind === 'export') return fast ? 3 : 1;
      return fast ? 6 : 1;
    },
    has: function (k) { return this.armed.indexOf(k) >= 0; },
    take: function (k) { var i = this.armed.indexOf(k); if (i < 0) return false; this.armed.splice(i, 1); if (this.onChange) this.onChange(); return true; },
    arm: function (k) { if (!this.has(k)) this.armed.push(k); if (this.onChange) this.onChange(); },
    disarm: function (k) { var i = this.armed.indexOf(k); if (i >= 0) this.armed.splice(i, 1); if (this.onChange) this.onChange(); }
  };

  /* ------------------------------------------------------------------ state */
  var S;
  function fresh(ctx) {
    return { ctx: ctx, step: 'setup', filament: 'petg', profile: 'structural', changes: {}, parts: [], copies: [],
             selected: [], nextId: 1, laidOut: false, problems: [], job: null, result: null, resultSig: null,
             print: null, action: 'print', layer: 0, advTab: 'Quality', advSearch: '', advOnlyChanged: false, advTier: 'common', advOpen: {},
             followPrint: true, layoutNotes: [], previewMsg: null, undo: [], redo: [], hiddenTypes: {} };
  }
  // The choices made in the scenario strip; they outlast Reset, since they are the owner's,
  // not the student's: how a copy is laid on a face, the mouse scheme, how parts arrive.
  var Opt = { lay: 'strip', scheme: 'O', arrival: 'auto' };
  function profileObj() { return ST.PROFILES.filter(function (p) { return p.id === S.profile; })[0]; }
  function filamentObj() { return ST.FILAMENTS.filter(function (f) { return f.id === S.filament; })[0]; }
  function eff() {
    var v = {}, pv = profileObj().values;
    Object.keys(pv).forEach(function (k) { v[k] = pv[k]; });
    Object.keys(S.changes).forEach(function (k) { v[k] = S.changes[k]; });
    return v;
  }
  function setSetting(key, value) {
    var pv = profileObj().values[key];
    if (value === pv) delete S.changes[key]; else S.changes[key] = value;
  }
  function changeCount() { return Object.keys(S.changes).length; }
  function partById(id) { return S.parts.filter(function (p) { return p.id === id; })[0]; }
  function copyById(id) { return S.copies.filter(function (c) { return c.id === id; })[0]; }
  function copyLabel(c) {
    var n = 0, name = partById(c.partId) ? partById(c.partId).name : P.byKey[c.partKey].name;
    for (var i = 0; i < S.copies.length; i++) { if (S.copies[i].partId === c.partId) n++; if (S.copies[i] === c) break; }
    return name + ' #' + n;
  }
  function totalCopies() { return S.parts.reduce(function (a, p) { return a + (p.status === 'ready' ? p.qty : 0); }, 0); }
  function docName() { return S.ctx === 'standalone' ? 'Upload' : P.PART_STUDIO.name; }
  function fileName() { return docName().replace(/\s+/g, '_') + '_plate_1.gcode.3mf'; }

  /* ------------------------------------------------------------------ time */
  var jobs = [];
  var last = performance.now();
  setInterval(function () {
    var now = performance.now(), dt = Math.min(0.5, (now - last) / 1000); last = now;
    jobs.slice().forEach(function (j) { j.tick(dt); });
  }, 100);
  function addJob(j) { jobs.push(j); return j; }
  function dropJob(j) { var i = jobs.indexOf(j); if (i >= 0) jobs.splice(i, 1); }
  function after(mockSeconds, kind, fn) {          // a one-shot timer on the mock clock
    var t = 0, j = addJob({ tick: function (dt) { t += dt * Mock.factor(kind); if (t >= mockSeconds) { dropJob(j); fn(); } } });
    return j;
  }
  function clock(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }
  function hm(s) { s = Math.round(s / 60); var h = Math.floor(s / 60), m = s % 60; return h ? h + ' h ' + m + ' min' : m + ' min'; }
  function sizeText(sz) { return sz.x + ' × ' + sz.y + ' × ' + sz.z + ' mm'; }
  function clockTime(d) {                               // a time of day, as a student reads a clock
    var h = d.getHours(), m = d.getMinutes(), pm = h >= 12; h = h % 12 || 12;
    return h + ':' + ('0' + m).slice(-2) + (pm ? ' pm' : ' am');
  }

  /* ------------------------------------------------------------------ messages */
  // what happened; what to do next; remedy buttons; optional details for a mentor
  function msg(kind, what, todo, acts, details) {
    var d = el('div', 'msg ' + kind);
    d.appendChild(el('div', 'what', what));
    if (todo) d.appendChild(el('div', 'todo', todo));
    if (acts && acts.length) {
      var a = el('div', 'acts');
      acts.forEach(function (x) { a.appendChild(btn(x[0], x[1], x[2])); });
      d.appendChild(a);
    }
    if (details) {
      var det = el('details'); det.appendChild(el('summary', null, 'Details for a mentor'));
      det.appendChild(el('code', null, details + '\nPage id ' + PAGE_ID)); d.appendChild(det);
    }
    return d;
  }

  /* ------------------------------------------------------------------ thumbnails */
  var thumbR = null, thumbs = {};
  function thumbRenderer(px) {
    if (!thumbR) thumbR = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbR.setSize(px, px);
    return thumbR;
  }
  // A small picture of a part lying one way, seen from the front and above, on a patch of
  // plate so that "down" reads at a glance. Cached per part and position.
  function restThumb(key, idx, q) {
    var ck = key + '#' + idx;
    if (thumbs[ck] !== undefined) return thumbs[ck];
    try {
      var r = thumbRenderer(104), def = P.byKey[key], scene = new T.Scene();
      Layout3D.lights(scene);
      var m = new T.Mesh(def.geometry, new T.MeshStandardMaterial({ color: def.color, flatShading: true, roughness: 0.6 }));
      m.quaternion.copy(q); m.updateMatrixWorld();
      var box = new T.Box3().setFromObject(m), c = new T.Vector3(), sz = new T.Vector3(); box.getCenter(c); box.getSize(sz);
      m.position.set(-c.x, -c.y, -box.min.z); scene.add(m);
      var span = Math.max(sz.x, sz.y, sz.z);
      var pl = new T.Mesh(new T.PlaneGeometry(Math.max(sz.x, sz.y) * 1.25 + 6, Math.max(sz.x, sz.y) * 1.25 + 6), new T.MeshBasicMaterial({ color: 0x2f3946 }));
      pl.position.z = -0.2; scene.add(pl);
      var cam = new T.PerspectiveCamera(30, 1, 0.5, 10000); cam.up.set(0, 0, 1);
      var dist = span * 0.62 / Math.sin(15 * Math.PI / 180);
      cam.position.set(dist * 0.35, -dist * 0.8, sz.z / 2 + dist * 0.5); cam.lookAt(0, 0, sz.z / 2);
      r.render(scene, cam);
      thumbs[ck] = r.domElement.toDataURL();
    } catch (e) { thumbs[ck] = ''; }
    return thumbs[ck];
  }
  function thumb(key) {
    if (thumbs[key]) return thumbs[key];
    try {
      thumbRenderer(80);
      var def = P.byKey[key], scene = new T.Scene();
      Layout3D.lights(scene);
      scene.add(new T.Mesh(def.geometry, new T.MeshStandardMaterial({ color: def.color, flatShading: true, roughness: 0.6 })));
      var r = def.geometry.boundingSphere || (def.geometry.computeBoundingSphere(), def.geometry.boundingSphere);
      var cam = new T.PerspectiveCamera(30, 1, 1, 5000); cam.up.set(0, 0, 1);
      var dist = r.radius / Math.sin(15 * Math.PI / 180) * 1.05;
      cam.position.set(dist * 0.55, -dist * 0.7, dist * 0.45); cam.lookAt(0, 0, 0);
      thumbR.render(scene, cam);
      thumbs[key] = thumbR.domElement.toDataURL();
    } catch (e) { thumbs[key] = ''; }
    return thumbs[key];
  }

  /* ================================================================== navigation */
  function canLeave(step) {
    if (step === 'parts') {
      var ready = S.parts.filter(function (p) { return p.status === 'ready'; }).length;
      var busy = S.parts.some(function (p) { return p.status !== 'ready'; });
      return ready > 0 && !busy && totalCopies() <= MAX_COPIES;
    }
    if (step === 'layout') return S.copies.length > 0 && S.problems.length === 0;
    return true;
  }
  function navigateTo(name) {
    var target = ORDER.indexOf(name), cur = ORDER.indexOf(S.step);
    if (target === cur) return;
    if (target > cur) { for (var i = cur; i < target; i++) { if (i === 2) enterLayoutData(); if (!canLeave(ORDER[i])) return; } }
    gotoStep(name);
  }
  function gotoStep(name) {
    if (S.step === 'preview' && name !== 'preview' && S.job && S.job.state === 'running') cancelSlice('left');
    S.step = name;
    $all('#wizard .step').forEach(function (s) { s.hidden = s.getAttribute('data-step') !== name; });
    $all('#stepbar li').forEach(function (li) {
      var s = li.getAttribute('data-step');
      li.classList.toggle('active', s === name);
      li.classList.toggle('done', ORDER.indexOf(s) < ORDER.indexOf(name));
    });
    $('#btn-back').disabled = name === 'setup';
    $('#btn-next').hidden = name === 'preview';
    $('#final-action').hidden = name !== 'preview';
    $('#wiz-body').scrollTop = 0;
    if (name === 'setup') renderSetup();
    if (name === 'parts') renderParts();
    if (name === 'layout') enterLayout();
    if (name === 'preview') enterPreview();
    updateNext(); updateSummary();
  }
  function updateNext() {
    if (S.step !== 'preview') $('#btn-next').disabled = !canLeave(S.step);
    var ready = !!S.result && (!S.job || S.job.state !== 'running');
    var live = !!S.print && ['upload', 'prepare', 'printing'].indexOf(S.print.phase) >= 0;
    var b = $('#btn-do');
    // while this page's own plate is on the printer, the button cannot send a second one
    b.textContent = S.action === 'download' ? 'Download' : (live ? (S.print.phase === 'upload' ? 'Sending…' : 'Printing…') : 'Send to Printer');
    b.disabled = !ready || (S.action === 'print' && live);
    $('#btn-do-caret').disabled = !ready;
  }
  function updateSummary() {
    var box = $('#wiz-summary'), idx = ORDER.indexOf(S.step);
    box.innerHTML = '';
    if (idx < 1) { box.hidden = true; return; }
    box.hidden = false;
    function chip(t, cls) { box.appendChild(el('span', 'chip' + (cls ? ' ' + cls : ''), t)); }
    chip(filamentObj().type); chip(profileObj().name);
    var n = changeCount(); if (n) chip('+' + n + ' change' + (n > 1 ? 's' : ''), 'adv');
    if (idx >= 2) {
      var parts = S.parts.filter(function (p) { return p.status === 'ready'; }).length;
      chip(parts + ' part' + (parts === 1 ? '' : 's') + ' · ' + totalCopies() + ' cop' + (totalCopies() === 1 ? 'y' : 'ies'));
    }
    if (idx >= 3 && S.copies.length) {
      var b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
      S.copies.forEach(function (c) { var h = PL.bbox(PL.worldHull(c)); b.minX = Math.min(b.minX, h.minX); b.maxX = Math.max(b.maxX, h.maxX); b.minY = Math.min(b.minY, h.minY); b.maxY = Math.max(b.maxY, h.maxY); });
      chip(Math.round(b.maxX - b.minX) + ' × ' + Math.round(b.maxY - b.minY) + ' mm of plate');
    }
  }

  /* ================================================================== Setup step */
  function renderConfig() {
    var box = $('#config-info');
    box.innerHTML = '';
    var p = el('p', 'config-status');
    p.appendChild(document.createTextNode('Config: '));
    var a = el('a', null, '6238 (Popcorn Penguins)'); a.href = '#'; a.title = 'Open PenguinCAM-config.yaml (mockup: does nothing)';
    a.addEventListener('click', function (e) { e.preventDefault(); });
    p.appendChild(a);
    var r = el('a', 'config-refresh', '↻'); r.href = '#'; r.title = 'Reload team configuration from Onshape';
    r.addEventListener('click', function (e) { e.preventDefault(); });
    p.appendChild(r);
    box.appendChild(p);
    if (S.ctx === 'standalone') box.appendChild(el('p', 'config-status-reason', 'Loaded from your saved team configuration link.'));
  }

  function renderPrinterLine() {
    var box = $('#p-printer'); box.innerHTML = '';
    box.appendChild(el('span', null, ST.PRINTER.name));
    box.appendChild(el('span', 'model', ST.PRINTER.model));
    var st = printerState();
    box.appendChild(el('span', 'pstate' + (st.busy ? ' busy' : ''), st.text));
  }
  function printerState() {
    var pr = S && S.print;
    if (pr && pr.phase === 'upload') return { busy: true, text: 'Receiving your plate' };
    if (pr && (pr.phase === 'prepare' || pr.phase === 'printing')) return { busy: true, text: 'Printing ' + Math.floor(pr.pct) + '%' };
    return { busy: false, text: 'Idle' };
  }

  function fillSelect(sel, options, value) {
    sel.innerHTML = '';
    options.forEach(function (o) { var op = el('option', null, o.text); op.value = o.value; sel.appendChild(op); });
    sel.value = value;
  }

  function renderSetup() {
    renderConfig(); renderPrinterLine();
    fillSelect($('#p-filament'), ST.FILAMENTS.map(function (f) { return { value: f.id, text: f.name + (f.id === 'petg' ? ' (most prints)' : '') }; }), S.filament);
    fillSelect($('#p-profile'), ST.PROFILES.map(function (p) { return { value: p.id, text: p.name }; }), S.profile);
    $('#p-profile-about').textContent = 'For ' + profileObj().about + '. ' + ST.formatValue(ST.byKey.layer_height, profileObj().values.layer_height) + ' layers.';
    var v = eff(), pv = profileObj().values;
    Object.keys(ST.QUICK).forEach(function (qk) {
      var q = ST.QUICK[qk], s = ST.byKey[q.key], sel = $('#ov-' + qk);
      var opts = [{ value: '', text: 'Default (' + q.text(pv[q.key]) + ')' }];
      q.choices.forEach(function (c) { if (c !== pv[q.key]) opts.push({ value: String(c), text: q.text(c) }); });
      var changed = S.changes.hasOwnProperty(q.key);
      if (changed && q.choices.indexOf(v[q.key]) < 0) opts.push({ value: String(v[q.key]), text: q.text(v[q.key]) + ' (advanced mode)' });
      fillSelect(sel, opts, changed ? String(v[q.key]) : '');
      sel.classList.toggle('changed', changed);
      sel.title = s.label + ' in advanced mode';
    });
    var n = changeCount(), box = $('#adv-effect');
    box.hidden = !n; box.innerHTML = '';
    if (n) {
      var head = el('div'); head.innerHTML = '<strong>' + n + ' setting' + (n > 1 ? 's' : '') + ' changed from ' + profileObj().name + '</strong> for this print:';
      box.appendChild(head);
      var ul = el('ul');
      Object.keys(S.changes).forEach(function (k) {
        var s = ST.byKey[k];
        ul.appendChild(el('li', null, s.group + ' › ' + s.label + ': ' + ST.formatValue(s, S.changes[k]) + ' (profile ' + ST.formatValue(s, pv[k]) + ')'));
      });
      box.appendChild(ul);
      var row = el('div', 'row');
      row.appendChild(btn('Review in advanced mode', openAdvanced));
      row.appendChild(btn('Reset all', function () { S.changes = {}; $('#setup-notes').hidden = true; renderSetup(); updateSummary(); }));
      box.appendChild(row);
    }
    $('#setup-hint').textContent = 'Your team’s configuration lists these printers, filaments and profiles; a mentor changes them there.';
  }

  function bindSetup() {
    $('#p-filament').addEventListener('change', function () { S.filament = this.value; updateSummary(); });
    $('#p-profile').addEventListener('change', function () {
      S.profile = this.value;
      var pv = profileObj().values;
      Object.keys(S.changes).forEach(function (k) { if (S.changes[k] === pv[k]) delete S.changes[k]; });
      var n = changeCount(), notes = $('#setup-notes');
      notes.hidden = !n;
      notes.textContent = n ? 'Kept your ' + n + ' change' + (n > 1 ? 's' : '') + ' on top of ' + profileObj().name + '. Press Reset all to print ' + profileObj().name + ' as it is.' : '';
      renderSetup(); updateSummary();
    });
    Object.keys(ST.QUICK).forEach(function (qk) {
      $('#ov-' + qk).addEventListener('change', function () {
        var q = ST.QUICK[qk], raw = this.value;
        if (raw === '') delete S.changes[q.key];
        else {
          var val = q.choices.filter(function (c) { return String(c) === raw; })[0];
          if (val === undefined) val = S.changes[q.key];
          setSetting(q.key, val);
        }
        renderSetup(); updateSummary();
      });
    });
    $('#btn-advanced').addEventListener('click', openAdvanced);
  }

  /* ================================================================== advanced mode */
  var advResetArmed = false;
  function openAdvanced() { $('#advanced').hidden = false; S.advSearch = ''; $('#adv-search').value = ''; renderAdvanced(); fitAdvanced(); $('#adv-search').focus(); }
  function closeAdvanced() { $('#advanced').hidden = true; advResetArmed = false; renderSetup(); updateSummary(); }
  // Advanced mode follows the panel's width (a ResizeObserver, not a media query, so it also
  // follows a panel the student drags wider): a row of tabs when narrow, a rail of tabs on
  // the left from 480 px, and the groups in two columns from 700 px.
  function fitAdvanced() {
    var a = $('#advanced'), w = a.clientWidth;
    if (!w) return;
    a.classList.toggle('wide', w >= 480);
    a.classList.toggle('xwide', w >= 700);
  }
  function inTier(s) { return S.advTier === 'all' || !s.more; }
  function renderAdvanced() {
    var pv = profileObj().values, v = eff(), n = changeCount();
    $('#adv-sub').textContent = profileObj().name + (n ? ', ' + n + ' changed' : ', no changes');
    var ra = $('#adv-reset-all'); ra.disabled = !n; ra.textContent = advResetArmed ? 'Reset all ' + n + '?' : 'Reset all';
    ra.classList.toggle('primary', advResetArmed);
    $all('#adv-tier button').forEach(function (b) { var on = b.getAttribute('data-tier') === S.advTier; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    var tabs = $('#adv-tabs'); tabs.innerHTML = '';
    ST.GROUPS.forEach(function (g) {
      var b = el('button', g === S.advTab && !S.advSearch ? 'on' : '', g); b.type = 'button'; b.setAttribute('role', 'tab');
      var cnt = Object.keys(S.changes).filter(function (k) { return ST.byKey[k].group === g; }).length;
      if (cnt) b.appendChild(el('span', 'n', String(cnt)));
      b.addEventListener('click', function () { S.advTab = g; S.advSearch = ''; $('#adv-search').value = ''; renderAdvanced(); });
      tabs.appendChild(b);
    });
    var list = $('#adv-list'); list.innerHTML = '';
    var q = S.advSearch.trim().toLowerCase();
    // Search and "Changed only" look through every setting, whatever the Common/All switch says.
    var rows = ST.SETTINGS.filter(function (s) {
      if (S.advOnlyChanged && !S.changes.hasOwnProperty(s.key)) return false;
      if (q) return (s.label + ' ' + s.sub + ' ' + s.group + ' ' + s.key.replace(/_/g, ' ')).toLowerCase().indexOf(q) >= 0;
      return S.advOnlyChanged || (s.group === S.advTab && inTier(s));
    });
    if (!rows.length) { list.appendChild(el('div', 'adv-empty', q ? 'No setting matches “' + S.advSearch + '”.' : 'No settings changed from ' + profileObj().name + '.')); return; }
    // Subgroups collapse. In Common every one starts open; in All only the first, so a long
    // tab reads as a list of headings to open. Search and "Changed only" open them all.
    var groups = [], cur = null, firstOfTab = {};
    rows.forEach(function (s) {
      if (!cur || cur.group !== s.group || cur.sub !== s.sub) { cur = { group: s.group, sub: s.sub, rows: [] }; groups.push(cur); if (!firstOfTab[s.group]) firstOfTab[s.group] = cur; }
      cur.rows.push(s);
    });
    var lastGroup = null, cols = el('div', 'adv-cols');
    groups.forEach(function (g) {
      if ((q || S.advOnlyChanged) && g.group !== lastGroup) cols.appendChild(el('div', 'adv-group', g.group));
      lastGroup = g.group;
      var key = S.advTier + '|' + g.group + '|' + g.sub;
      var ch = g.rows.filter(function (s) { return S.changes.hasOwnProperty(s.key); }).length;
      var open = q || S.advOnlyChanged ? true : (S.advOpen.hasOwnProperty(key) ? S.advOpen[key] : (S.advTier === 'common' || firstOfTab[g.group] === g || ch > 0));
      var box = el('div', 'adv-grp' + (open ? ' open' : ''));
      var head = el('button', 'adv-sub'); head.type = 'button'; head.setAttribute('aria-expanded', open ? 'true' : 'false');
      head.appendChild(el('span', 'car', open ? '▾' : '▸'));
      head.appendChild(el('span', 'nm', g.sub));
      head.appendChild(el('span', 'ct', g.rows.length + (ch ? ' · ' + ch + ' changed' : '')));
      if (ch) head.classList.add('has-changes');
      head.addEventListener('click', function () { S.advOpen[key] = !open; renderAdvanced(); });
      box.appendChild(head);
      if (open) g.rows.forEach(function (s) { box.appendChild(advRow(s, v[s.key], pv[s.key], q)); });
      cols.appendChild(box);
    });
    list.appendChild(cols);
    if (!q && !S.advOnlyChanged) {
      var shown = rows.length, total = ST.SETTINGS.filter(function (s) { return s.group === S.advTab; }).length;
      list.appendChild(el('div', 'adv-mock', S.advTier === 'common'
        ? 'Common shows the ' + shown + ' ' + S.advTab + ' settings teams change most; All settings shows ' + total + '. Mockup note: in Orca this tab has about ' + ST.ORCA_COUNT[S.advTab] + '; the product lists every one, taken from Orca’s own definitions.'
        : 'Mockup note: All settings shows ' + total + ' of Orca’s about ' + ST.ORCA_COUNT[S.advTab] + ' ' + S.advTab + ' settings as a sample; the product lists every one, taken from Orca’s own definitions.'));
    }
  }
  function advRow(s, value, profVal, q) {
    var changed = S.changes.hasOwnProperty(s.key);
    var row = el('div', 'adv-row' + (changed ? ' changed' : ''));
    var id = 'adv-' + s.key;
    var lab = el('label'); lab.htmlFor = id;
    if (q) {
      var i = s.label.toLowerCase().indexOf(q);
      if (i >= 0) { lab.appendChild(document.createTextNode(s.label.slice(0, i))); lab.appendChild(el('mark', null, s.label.slice(i, i + q.length))); lab.appendChild(document.createTextNode(s.label.slice(i + q.length))); }
      else lab.textContent = s.label;
    } else lab.textContent = s.label;
    if (s.quick) lab.title = 'Also on the Setup step as ' + ST.QUICK[s.quick].label;
    var ctl = el('div', 'ctl'), input;
    if (s.type === 'num') {
      input = el('input'); input.type = 'number'; input.step = String(s.step); input.min = String(s.min); input.max = String(s.max); input.value = String(value);
      ctl.appendChild(input); ctl.appendChild(el('span', 'unit', s.unit));
      input.addEventListener('change', function () {
        var x = parseFloat(input.value);
        var bad = row.querySelector('.bad'); if (bad) bad.remove();
        if (isNaN(x) || x < s.min || x > s.max) {
          input.classList.add('invalid');
          row.appendChild(el('div', 'bad', s.label + ' must be between ' + s.min + ' and ' + s.max + (s.unit ? ' ' + s.unit : '') + '. Kept ' + ST.formatValue(s, value) + '.'));
          return;
        }
        if (s.step >= 1) x = Math.round(x);
        setSetting(s.key, x); renderAdvanced();
      });
    } else if (s.type === 'sel') {
      input = el('select');
      s.options.forEach(function (o) { var op = el('option', null, o.text); op.value = o.value; input.appendChild(op); });
      input.value = value;
      input.addEventListener('change', function () { setSetting(s.key, input.value); renderAdvanced(); });
      ctl.appendChild(input);
    } else {
      input = el('input'); input.type = 'checkbox'; input.checked = !!value;
      input.addEventListener('change', function () { setSetting(s.key, input.checked); renderAdvanced(); });
      ctl.appendChild(input);
    }
    input.id = id;
    var reset = el('button', 'reset', '↶'); reset.type = 'button';
    reset.title = 'Undo this change: back to ' + profileObj().name + '’s ' + ST.formatValue(s, profVal);
    reset.setAttribute('aria-label', 'Reset ' + s.label);
    reset.addEventListener('click', function () { delete S.changes[s.key]; renderAdvanced(); });
    row.appendChild(lab); row.appendChild(ctl); row.appendChild(reset);
    if (changed) row.appendChild(el('div', 'was', profileObj().name + ': ' + ST.formatValue(s, profVal)));
    return row;
  }
  function bindAdvanced() {
    $('#adv-back').addEventListener('click', closeAdvanced);
    $('#adv-done').addEventListener('click', closeAdvanced);
    $('#adv-search').addEventListener('input', function () { S.advSearch = this.value; renderAdvanced(); });
    $('#adv-only-changed').addEventListener('change', function () { S.advOnlyChanged = this.checked; renderAdvanced(); });
    $('#adv-reset-all').addEventListener('click', function () {
      if (!advResetArmed) { advResetArmed = true; renderAdvanced(); return; }
      advResetArmed = false; S.changes = {}; renderAdvanced();
    });
    $('#advanced').addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAdvanced(); });
    $all('#adv-tier button').forEach(function (b) {
      b.addEventListener('click', function () { S.advTier = b.getAttribute('data-tier'); renderAdvanced(); });
    });
    if (window.ResizeObserver) new ResizeObserver(fitAdvanced).observe($('#advanced'));
  }

  /* ================================================================== Parts step */
  var partsNote = null;      // one transient message above the list
  function setPartsNote(node) { partsNote = node; renderPartsMessages(); }
  function renderPartsMessages() {
    var box = $('#parts-messages'); box.innerHTML = '';
    if (partsNote) box.appendChild(partsNote);
  }

  function addPart(key, o) {
    o = o || {};
    var def = P.byKey[key];
    var existing = S.parts.filter(function (p) { return p.key === key && !o.fileName; })[0];
    if (existing && !o.qty) {
      // a second click changes nothing: the row flashes and a sentence says where to go next
      setPartsNote(msg('info', existing.name + ' is already in the list.', 'To print more of it, raise its quantity. If you changed it in Onshape, press ↻ on its row to bring in the new version.'));
      renderParts();
      var li = document.querySelector('[data-part="' + existing.id + '"]');
      if (li) { li.classList.remove('flash'); void li.offsetWidth; li.classList.add('flash'); }
      return existing;
    }
    if (existing && o.qty) { existing.qty = Math.min(MAX_COPIES, Math.max(existing.qty, o.qty)); renderParts(); return existing; }
    var part = { id: 'p' + (S.nextId++), key: key, name: o.fileName ? o.fileName.replace(/\.(stl|3mf)$/i, '') : def.name,
                 file: o.fileName || null, qty: o.qty || 1, status: 'exporting', warn: null, error: null };
    S.parts.push(part);
    renderParts();
    exportPart(part, o);
    return part;
  }
  function exportPart(part, o) {
    part.status = 'exporting'; part.error = null;
    var fail = o.fail || (!o.noArm && Mock.take('export_fail'));
    var warn = o.warn || (!o.noArm && !fail && Mock.take('not_watertight'));
    after((o.delay || 0) + 0.7 + Math.random() * 0.8, 'export', function () {
      if (S.parts.indexOf(part) < 0) return;
      if (fail) {
        part.status = 'failed';
        part.error = S.ctx === 'standalone'
          ? { what: 'Could not read ' + part.file + ': it is not a valid STL or 3MF file.', todo: 'Export it again from your CAD program as STL (millimetres), then upload the new file.', details: 'STL parse: unexpected end of file at byte 18,204 (header says 2,140 triangles).' }
          : { what: 'Onshape could not export ' + part.name + '.', todo: 'Your other parts are not affected. Try again; if it fails again, check that ' + part.name + ' is a single solid part that Onshape can export as STL.', details: 'POST /partstudios/.../stl answered HTTP 500 “Translation failed” after 3.1 s. Element "' + P.PART_STUDIO.tab + '", part ' + part.name + '.' };
      } else {
        part.status = 'ready';
        if (warn) part.warn = { what: part.name + ' is not watertight: its mesh has 14 open edges in 2 places.', todo: 'It may still slice and print. If the slice fails, repair the model in CAD (look for faces that do not meet), then ' + (S.ctx === 'standalone' ? 'upload the repaired file.' : 'press ↻ on this row to bring in the repaired version.') };
      }
      renderParts();
      if (S.step === 'parts') updateNext();
    });
  }

  function renderParts() {
    var ctx = S.ctx;
    $('#parts-onshape').hidden = ctx === 'standalone';
    $('#parts-upload').hidden = ctx !== 'standalone';
    $('#parts-assembly').hidden = ctx !== 'assembly';
    var busy = S.parts.some(function (p) { return p.status === 'exporting'; });
    var ss = $('#select-status');
    ss.classList.toggle('busy', busy);
    ss.innerHTML = '';
    if (busy) { ss.appendChild(el('span', 'spin')); ss.appendChild(document.createTextNode(' Exporting from Onshape… keep clicking to add more.')); }
    else ss.textContent = ctx === 'assembly' ? 'Click a part in the assembly to add it.' : 'Click a part in Onshape to add it.';
    $('#parts-hint').textContent = ctx === 'assembly'
      ? 'Click instances in the list or the graphics area to add one part at a time, or bring them all in with the button.'
      : 'In the Parts list or the graphics area. Keep clicking to add more, then set how many of each to print.';
    renderPartsMessages();
    var list = $('#parts-list'); list.innerHTML = '';
    S.parts.forEach(function (p) {
      var def = P.byKey[p.key];
      var li = el('li', 'part-item' + (p.status === 'failed' ? ' failed' : '')); li.setAttribute('data-part', p.id);
      var row = el('div', 'row');
      var img = el('img'); img.alt = ''; img.src = thumb(p.key); row.appendChild(img);
      var meta = el('div', 'meta');
      var nm = el('div', 'name', p.name); nm.title = p.name; meta.appendChild(nm);
      var dims = el('div', 'dims');
      if (p.status === 'exporting') { dims.appendChild(el('span', 'spin')); dims.appendChild(document.createTextNode(ctx === 'standalone' ? ' Uploading…' : ' Exporting from Onshape…')); }
      else if (p.status === 'failed') dims.textContent = ctx === 'standalone' ? 'Not read' : 'Not exported';
      else { dims.textContent = sizeText(def.size); dims.title = 'Size as modelled; ' + (def.volume / 1000).toFixed(1) + ' cm³ of plastic'; }
      meta.appendChild(dims); row.appendChild(meta);
      if (ctx !== 'standalone' && p.status === 'ready') {
        var rf = el('button', 'refresh', '↻'); rf.type = 'button';
        rf.title = 'Refresh ' + p.name + ' from Onshape (after you change it there)'; rf.setAttribute('aria-label', rf.title);
        rf.addEventListener('click', function () { p.warn = null; partsNote = null; exportPart(p, {}); renderParts(); });
        row.appendChild(rf);
      }
      var qty = el('input', 'part-qty'); qty.type = 'number'; qty.min = '1'; qty.max = String(MAX_COPIES); qty.step = '1';
      qty.value = String(p.qty); qty.disabled = p.status !== 'ready'; qty.setAttribute('aria-label', 'Copies of ' + p.name);
      qty.addEventListener('change', function () {
        var n = Math.round(Number(qty.value)); if (!(n >= 1)) n = 1; if (n > MAX_COPIES) n = MAX_COPIES;
        p.qty = n; qty.value = String(n); renderPartsTotal(); updateNext(); updateSummary();
      });
      row.appendChild(qty);
      var rm = el('button', 'remove', '×'); rm.type = 'button'; rm.setAttribute('aria-label', 'Remove ' + p.name); rm.title = 'Remove ' + p.name;
      rm.addEventListener('click', function () {
        S.parts = S.parts.filter(function (q) { return q !== p; });
        S.copies = S.copies.filter(function (c) { return c.partId !== p.id; });
        partsNote = null; renderParts(); updateNext(); updateSummary();
      });
      row.appendChild(rm);
      li.appendChild(row);
      if (p.status === 'failed' && p.error) {
        var sub = el('div', 'sub');
        sub.appendChild(msg('error', p.error.what, p.error.todo, [
          [S.ctx === 'standalone' ? 'Choose another file' : 'Try again', function () {
            if (S.ctx === 'standalone') { $('#f-upload').click(); S.parts = S.parts.filter(function (q) { return q !== p; }); renderParts(); }
            else { exportPart(p, { noArm: true }); renderParts(); }
          }, 'primary'],
          ['Remove', function () { S.parts = S.parts.filter(function (q) { return q !== p; }); renderParts(); updateNext(); }]
        ], p.error.details));
        li.appendChild(sub);
      }
      if (p.status === 'ready' && p.warn) {
        var w = el('div', 'sub'); w.appendChild(msg('warn', p.warn.what, p.warn.todo)); li.appendChild(w);
      }
      list.appendChild(li);
    });
    renderPartsTotal();
    if (S.step === 'parts') updateNext();
  }
  function renderPartsTotal() {
    var box = $('#parts-total'), n = totalCopies(), parts = S.parts.length;
    box.innerHTML = '';
    if (!parts) { box.textContent = 'No parts yet.'; return; }
    box.textContent = parts + ' part' + (parts > 1 ? 's' : '') + ', ' + n + ' cop' + (n === 1 ? 'y' : 'ies') + ' on one plate (up to ' + MAX_COPIES + ').';
    if (n > MAX_COPIES) box.appendChild(msg('error', 'This plate would hold ' + n + ' copies.', TOO_MANY_COPIES_MESSAGE));
    var failed = S.parts.filter(function (p) { return p.status === 'failed'; });
    if (failed.length) box.appendChild(el('div', 'hint', 'Next waits until ' + failed.map(function (p) { return p.name; }).join(', ') + ' is added or removed.'));
  }

  // Onshape selection from the page (Part Studio or Assembly)
  function onOnshapeSelect(key) {
    if (S.step !== 'parts' || S.ctx === 'standalone') return false;
    addPart(key, {});
    return true;
  }

  function importAssembly() {
    var A = P.ASSEMBLY, failAt = Mock.take('export_fail') ? 2 : -1, warnAt = Mock.take('not_watertight') ? 1 : -1;
    var added = 0;
    A.instances.forEach(function (inst, i) {
      var have = S.parts.filter(function (p) { return p.key === inst.key; })[0];
      if (have) { have.qty = inst.count; return; }
      addPart(inst.key, { qty: inst.count, delay: i * 0.35, noArm: true, fail: i === failAt, warn: i === warnAt });
      added++;
    });
    var std = A.standardContent.map(function (s) { return s.count + ' × ' + s.name; }).join('; ');
    setPartsNote(msg('info', 'Added the ' + A.instances.length + ' parts of ' + A.name + ', each with its count in the assembly.',
      'Remove what you do not print (for example the hex shafts). Left out as bought, not printed: ' + std + '.'));
    renderParts();
  }

  function bindParts() {
    $('#btn-import-assembly').addEventListener('click', importAssembly);
    var dz = $('#dropzone'), input = $('#f-upload'), next = 0;
    var keys = P.LIB.map(function (d) { return d.key; }).filter(function (k) { return k !== 'shaft'; });
    function addFiles(files) {
      Array.prototype.slice.call(files).forEach(function (f) {
        var key = keys[next++ % keys.length];
        addPart(key, { fileName: f.name || (P.byKey[key].name.replace(/\s+/g, '_') + '.stl') });
      });
      setPartsNote(msg('info', 'Mockup: each file you choose becomes one of the mock parts; the file itself is not read.', null));
    }
    dz.addEventListener('click', function () { input.click(); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', function () { if (input.files.length) addFiles(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (n) { dz.addEventListener(n, function (e) { e.preventDefault(); dz.classList.add('drag'); }); });
    ['dragleave', 'drop'].forEach(function (n) { dz.addEventListener(n, function (e) { e.preventDefault(); dz.classList.remove('drag'); }); });
    dz.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
    // for the scenario walk: a fake upload without a file dialog
    window.__mockUpload = function (name) { addFiles([{ name: name }]); };
  }

  /* ================================================================== Layout step */
  var editor = null;
  // A new copy lies the way auto-orient chose for its part (unless the scenario strip says
  // parts arrive as modelled); copy.auto says the choice was automatic, so the panel can say so.
  function newCopy(part) {
    var c = { id: 'c' + (S.nextId++), partId: part.id, partKey: part.key, q: new T.Quaternion(), x: 0, y: 0, auto: false };
    if (Opt.arrival === 'auto') {
      var best = P.resting(part.key).list[0];
      if (best && !best.modelled) { c.q = best.q.clone(); c.auto = true; }
    }
    return c;
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function arrangeNote(res, offer) {
    if (!res.parked) return [];
    // Arrange keeps how each copy lies. `offer`, when given, is a plate Arrange also tried
    // with every copy laid its best way, and which left fewer copies over: one button takes it.
    var acts = [['Back to Parts', function () { gotoStep('parts'); }]];
    if (offer) acts.unshift(['Lay them the best way: ' + (offer.parked ? (res.parked - offer.parked) + ' more fit' : 'all fit'), function () {
      // done afresh on the plate as it is now, in case it changed since Arrange was pressed
      pushUndo();
      var n = 0;
      S.copies.forEach(function (c) { var best = P.resting(c.partKey).list[0]; if (best && P.restIndex(c.partKey, c.q) !== 0 && turnToRest(c, best)) { c.auto = true; n++; } });
      var now = PL.bestArrange(S.copies, PLATE);
      S.layoutNotes = arrangeNote(now);
      layHint = msg('ok', 'Laid ' + plural(n, 'copy', 'copies') + ' the best way and arranged again: ' + (now.parked ? plural(now.placed, 'copy fits', 'copies fit') + ' now.' : 'every copy now fits.'), null);
      recheck(); editor.resetHandle(); editor.sync(); editor.resetView(); scheduleLayoutRender();
    }]);
    return [msg('error', 'Arrange placed ' + res.placed + ' of ' + (res.placed + res.parked) + ' copies' + (res.turned ? ', turning ' + res.turned : '') + '; ' + plural(res.parked, 'copy does', 'copies do') + ' not fit and ' + (res.parked === 1 ? 'waits' : 'wait') + ' beside the plate.',
      offer ? 'Arrange keeps how each copy lies. With ' + plural(offer.changed, 'copy', 'copies') + ' laid the best way, ' + (offer.parked ? 'more would fit' : 'everything would fit') + '. Or lower the quantities and print the rest in a second job.'
            : 'Lower the quantities and print the rest in a second job, or lay copies another way to make room.', acts)];
  }
  // Arrange keeps how each copy lies. When that leaves copies over and some do not lie
  // their best way, it also tries the plate with every copy laid its best way; only when
  // that leaves fewer over is it offered. Returns { snap, parked, changed } or null, and
  // leaves the plate as Arrange made it.
  function tryBestWay(res) {
    var notBest = S.copies.filter(function (c) { return P.resting(c.partKey).list[0] && P.restIndex(c.partKey, c.q) !== 0; });
    if (!res.parked || !notBest.length) return null;
    var keep = S.copies.map(function (c) { return { c: c, x: c.x, y: c.y, q: c.q.clone(), auto: c.auto }; });
    notBest.forEach(function (c) { if (turnToRest(c, P.resting(c.partKey).list[0])) c.auto = true; });
    var res2 = PL.bestArrange(S.copies, PLATE), offer = res2.parked < res.parked ? { parked: res2.parked, changed: notBest.length } : null;
    keep.forEach(function (k) { k.c.x = k.x; k.c.y = k.y; k.c.q = k.q; k.c.auto = k.auto; k.c.d = null; });
    return offer;
  }
  // Copies follow the Parts step's quantities.
  function enterLayoutData() {
    var fresh = [], before = S.copies.length;
    S.copies = S.copies.filter(function (c) { var p = partById(c.partId); return p && p.status === 'ready'; });
    S.parts.forEach(function (p) {
      if (p.status !== 'ready') return;
      var have = S.copies.filter(function (c) { return c.partId === p.id; });
      while (have.length > p.qty) { var gone = have.pop(); S.copies.splice(S.copies.indexOf(gone), 1); }
      while (have.length < p.qty) { var c = newCopy(p); S.copies.push(c); have.push(c); fresh.push(c); }
    });
    // Undo works within the Layout step; a change made on the Parts step starts afresh.
    if (fresh.length || S.copies.length !== before + fresh.length) { S.undo = []; S.redo = []; }
    // say once per part that it was laid down automatically, and how much lower it now stands
    var told = [];
    fresh.forEach(function (c) {
      var p = partById(c.partId);
      if (!c.auto || p.autoTold) return;
      p.autoTold = true;
      told.push(p.name + ' (' + Math.round(PL.derive(c).height) + ' mm tall instead of ' + Math.round(P.resting(c.partKey).modelled.height) + ' mm)');
    });
    if (told.length) layHint = msg('ok', 'Laid down automatically: ' + told.join(', ') + '.',
      'Chosen by how much touches the plate, how much hangs over air and how tall it stands. Select a copy to see the other ways it can lie, or to put it back as modelled.');
    if (!S.laidOut || fresh.length === S.copies.length) {
      var res = PL.bestArrange(S.copies, PLATE); S.laidOut = true;
      S.layoutNotes = arrangeNote(res);
    } else {
      // copies added to a plate the student already laid out join the group: each takes the
      // free spot nearest the middle of the copies already there, turned if that is what it
      // takes, and nothing else moves
      fresh.forEach(function (c) {
        var others = S.copies.filter(function (o) { return o !== c && fresh.indexOf(o) < 0 || (fresh.indexOf(o) >= 0 && fresh.indexOf(o) < fresh.indexOf(c)); });
        var mid = PL.centre(others, PLATE), q0 = c.q.clone(), turns = [0, 90, 45, 90], ok = false;
        for (var t = 0; t < turns.length && !ok; t++) { if (turns[t]) PL.yaw(c, turns[t]); ok = PL.placeNear(c, others, PLATE, mid[0], mid[1], turns[t] ? 3 : 4); }
        if (!ok) { c.q = q0; c.d = null; PL.place(c, others, PLATE); }
      });
    }
    if (fresh.length) needFit = true;
    S.selected = S.selected.filter(function (id) { return !!copyById(id); });
    recheck();
  }

  /* ---------------------------------------------------------------- undo and redo */
  // Every change on the Layout step can be undone: a snapshot of the copies (and of the
  // parts' quantities, which Duplicate and Delete change) is taken before it.
  var pendingSnap = null;
  function snapshot() {
    return { copies: S.copies.map(function (c) { return { id: c.id, partId: c.partId, partKey: c.partKey, q: c.q.clone(), x: c.x, y: c.y, auto: c.auto }; }),
             parts: S.parts.map(function (p) { return { ref: p, qty: p.qty }; }), selected: S.selected.slice(), notes: S.layoutNotes };
  }
  function restoreSnap(s) {
    S.copies = s.copies.map(function (c) { return { id: c.id, partId: c.partId, partKey: c.partKey, q: c.q.clone(), x: c.x, y: c.y, auto: c.auto }; });
    S.parts = s.parts.map(function (p) { p.ref.qty = p.qty; return p.ref; });
    S.selected = s.selected.slice(); S.layoutNotes = s.notes;
    layHint = null; recheck(); editor.resetHandle(); scheduleLayoutRender(); updateSummary();
  }
  function pushUndo(s) { S.undo.push(s || snapshot()); if (S.undo.length > 60) S.undo.shift(); S.redo = []; }
  function undo() { if (!S.undo.length) return; S.redo.push(snapshot()); restoreSnap(S.undo.pop()); }
  function redo() { if (!S.redo.length) return; S.undo.push(snapshot()); restoreSnap(S.redo.pop()); }

  /* ---------------------------------------------------------------- laying copies down */
  // Turn a copy so that a resting position's face is down, keeping its turn on the plate.
  function turnToRest(c, cand) {
    if (cand.modelled) { if (P.isModelled(c.q)) return false; c.q = new T.Quaternion(); c.d = null; return true; }
    var wn = cand.n.clone().applyQuaternion(c.q);
    if (wn.z < -0.999) return false;
    c.q = new T.Quaternion().setFromUnitVectors(wn.normalize(), P.DOWN).multiply(c.q); c.d = null;
    return true;
  }
  // After copies were laid another way: find each a free spot if it needs one, then one
  // sentence on what happened.
  function afterLay(copies, what) {
    var how = copies.map(function (c) { recheck(); return settle(c); });
    var c0 = copies[0], h = Math.round(PL.derive(c0).height);
    var head = copies.length === 1 ? copyLabel(c0) + ' now lies ' + what + ': ' + h + ' mm tall.'
                                   : copies.length + ' copies of ' + partById(c0.partId).name + ' now lie ' + what + ': ' + h + ' mm tall.';
    var arranged = how.indexOf('arranged') >= 0, moved = how.filter(Boolean).length;
    layHint = msg('ok', head, arranged ? 'It needs more room lying this way, so the whole plate was arranged again.'
      : moved ? (copies.length === 1 ? 'It no longer fitted where it stood, so it was moved' + (how[0] === 'turned' ? ' and turned' : '') + ' to the nearest free spot.' : moved + ' no longer fitted where they stood and moved to the nearest free spots.') : null);
    if (arranged) needRefit = true;
    recheck(); scheduleLayoutRender();
  }
  // The resting-position strip, the "As modelled" link and Auto-orient all end here.
  function layCopies(copies, pick, what) {
    var snap = snapshot(), changed = [];
    copies.forEach(function (c) {
      var cand = pick(c);
      if (cand && turnToRest(c, cand)) changed.push(c);
      if (cand) c.auto = what === 'auto';
    });
    if (!changed.length) { layHint = msg('info', (copies.length === 1 ? copyLabel(copies[0]) + ' already lies' : 'They already lie') + ' that way.', null); scheduleLayoutRender(); return; }
    pushUndo(snap);
    afterLay(changed, what === 'auto' ? 'its best way' : what === 'modelled' ? 'as modelled' : 'that way');
  }
  // Auto-orient: the selection, or every copy when nothing is selected. When every copy
  // changes at once, the plate is arranged again after (as Orca's Q then A).
  function autoOrient(ids) {
    var list = (ids && ids.length ? ids : S.copies.map(function (c) { return c.id; })).map(copyById).filter(Boolean);
    var whole = !(ids && ids.length);
    if (!whole) return layCopies(list, function (c) { return P.resting(c.partKey).list[0]; }, 'auto');
    var snap = snapshot(), changed = 0;
    list.forEach(function (c) { var best = P.resting(c.partKey).list[0]; if (best && turnToRest(c, best)) changed++; if (best) c.auto = true; });
    if (!changed) { layHint = msg('info', 'Every copy already lies its best way.', null); scheduleLayoutRender(); return; }
    pushUndo(snap); recheck();
    var res = null;
    if (S.problems.some(function (p) { return p.rule !== 'too_tall'; })) { res = PL.bestArrange(S.copies, PLATE); S.layoutNotes = arrangeNote(res); needRefit = true; }
    layHint = msg('ok', 'Auto-orient laid ' + plural(changed, 'copy', 'copies') + (changed === 1 ? ' its' : ' their') + ' best way' + (res ? ', then arranged the plate to make room.' : '.'), null);
    recheck(); scheduleLayoutRender();
  }
  // The tip handle: each selected copy steps to its next resting position (Shift: the one before).
  function tipSelected(back) {
    var list = S.selected.map(copyById).filter(Boolean);
    if (!list.length) return;
    var snap = snapshot(), changed = [];
    list.forEach(function (c) {
      var R = P.resting(c.partKey).list, n = R.length; if (!n) return;
      var i = P.restIndex(c.partKey, c.q);
      var next = i < 0 ? (back ? n - 1 : 0) : (i + (back ? n - 1 : 1)) % n;
      if (next !== i && turnToRest(c, R[next])) { c.auto = false; changed.push(c); }
    });
    if (!changed.length) { layHint = msg('info', copyLabel(list[0]) + ' has only one way to lie flat.', null); scheduleLayoutRender(); return; }
    pushUndo(snap);
    var c0 = changed[0], k = P.restIndex(c0.partKey, c0.q), n0 = P.resting(c0.partKey).list.length;
    afterLay(changed, 'on its ' + ordinal(k + 1) + ' of ' + n0 + ' sides' + (k === 0 ? ' (the best)' : ''));
  }
  function ordinal(n) { return ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'][n - 1] || n + 'th'; }
  // One sentence per copy that is too close to two or more others.
  function recheck() {
    var raw = PL.check(S.copies, PLATE, copyLabel), close = raw.filter(function (p) { return p.rule === 'too_close'; });
    var count = {};
    close.forEach(function (p) { p.copies.forEach(function (id) { count[id] = (count[id] || 0) + 1; }); });
    var hubs = Object.keys(count).filter(function (id) { return count[id] >= 2; }).sort(function (a, b) { return count[b] - count[a]; });
    var used = {}, merged = [];
    hubs.forEach(function (id) {
      var mine = close.filter(function (p) { return !used[p.copies.join()] && p.copies.indexOf(id) >= 0; });
      if (mine.length < 2) return;
      mine.forEach(function (p) { used[p.copies.join()] = 1; });
      var others = mine.map(function (p) { return copyLabel(copyById(p.copies[0] === id ? p.copies[1] : p.copies[0])); });
      var list = others.length > 1 ? others.slice(0, -1).join(', ') + ' and ' + others[others.length - 1] : others[0];
      merged.push({ rule: 'too_close', copies: [id].concat(mine.map(function (p) { return p.copies[0] === id ? p.copies[1] : p.copies[0]; })),
                    message: copyLabel(copyById(id)) + ' overlaps or is closer than ' + PLATE.spacing + ' mm to ' + list + '. Drag it to a clear spot, or press Arrange.' });
    });
    S.problems = raw.filter(function (p) { return p.rule !== 'too_close' || !used[p.copies.join()]; }).concat(merged);
  }
  function isBad(id) { return S.problems.some(function (p) { return p.copies.indexOf(id) >= 0; }); }
  // A copy that was just laid down has a new footprint. If it now overlaps a neighbour or
  // crosses the plate edge, find it a free spot, turning it if that is what it takes.
  // It takes the free spot nearest to where it stood, so it stays beside its neighbours.
  // When no spot is free with the others where they are (a long part laid flat among small
  // ones), the whole plate is arranged again, which is what the student would press next.
  // Returns 'moved', 'turned', 'arranged', or null when it was fine or nothing fits at all.
  function settle(copy) {
    function placeProblem() { return S.problems.some(function (p) { return p.rule !== 'too_tall' && p.copies.indexOf(copy.id) >= 0; }); }
    if (!placeProblem()) return null;
    var keep = { x: copy.x, y: copy.y, q: copy.q.clone() }, others = S.copies.filter(function (o) { return o !== copy; });
    var turns = [0, 90, 45, 90], how = 'moved';
    for (var t = 0; t < turns.length; t++) {
      if (turns[t]) { PL.yaw(copy, turns[t]); how = 'turned'; }
      if (PL.placeNear(copy, others, PLATE, keep.x, keep.y, turns[t] ? 3 : 4)) { recheck(); return how; }
    }
    copy.x = keep.x; copy.y = keep.y; copy.q = keep.q; copy.d = null;
    var before = S.copies.map(function (c) { return { c: c, x: c.x, y: c.y, q: c.q.clone() }; });
    if (PL.bestArrange(S.copies, PLATE).parked === 0) { recheck(); if (!S.problems.some(function (p) { return p.rule !== 'too_tall'; })) return 'arranged'; }
    before.forEach(function (b) { b.c.x = b.x; b.c.y = b.y; b.c.q = b.q; b.c.d = null; });
    recheck();
    return null;
  }

  function enterLayout() {
    enterLayoutData();
    $('#layout-info').textContent = ST.PRINTER.name + ': plate ' + PLATE.x + ' × ' + PLATE.y + ' mm, copies up to ' + PLATE.height + ' mm tall and ' + PLATE.spacing + ' mm apart.';
    if (!editor) {
      editor = Layout3D.create($('#layout-view'), {
        plate: PLATE,
        getCopies: function () { return S.copies; },
        isSelected: function (id) { return S.selected.indexOf(id) >= 0; },
        isBad: isBad,
        labelFor: function (id) { var c = copyById(id); return c ? copyLabel(c) : ''; },
        select: function (id, how) {
          if (how === 'none') S.selected = [];
          else if (how === 'only') S.selected = [id];
          else if (how === 'toggle') { var i = S.selected.indexOf(id); if (i >= 0) S.selected.splice(i, 1); else S.selected.push(id); }
          if (how !== 'toggle' || S.selected.length <= 1) editor.resetHandle();
          renderLayoutSide(); editor.sync();
        },
        // a drag or a lay-down is about to change the plate: keep what it was, for undo
        begin: function () { pendingSnap = snapshot(); },
        changed: function (why, copy) {
          if (pendingSnap && (why === 'move' || why === 'rotate' || why === 'lay')) { pushUndo(pendingSnap); pendingSnap = null; }
          recheck();
          if (why === 'lay' && copy) { afterLay([copy], 'on that ' + (Opt.lay === 'box' ? 'side' : 'face')); return; }
          scheduleLayoutRender();
          // a click (not a drag) just selected a copy: bring what can be done with it into
          // sight under the picture. Done on release, so the picture never moves under a press.
          if (why === 'select' && S.selected.length) requestAnimationFrame(function () { requestAnimationFrame(revealSelectionTools); });
        },
        tip: tipSelected,
        hint: function (text) { layHint = msg('warn', text, null); renderLayoutSide(); },
        onKey: function (k) {
          if (k === 'delete') deleteSelected();
          if (k === 'escape') { S.selected = []; renderLayoutSide(); editor.sync(); }
          if (k === 'all') { S.selected = S.copies.map(function (c) { return c.id; }); renderLayoutSide(); editor.sync(); }
          if (k === 'undo') undo();
          if (k === 'redo') redo();
          if (k === 'duplicate') duplicateSelected();
          if (k === 'fit') editor.resetView();
          if (k === 'top') editor.topView();
        }
      });
      editor.setScheme(Opt.scheme); editor.setLayOption(Opt.lay);
    }
    applyLayoutArms();
    var fit = needFit; needFit = false;
    setTimeout(function () { editor.resize(); editor.sync(); if (fit) editor.resetView(); }, 0);
    renderLayoutSide();
  }
  // Scroll the panel just far enough that the selection's row, and the resting-position
  // strip when it is the chosen way, are in sight; never so far that the picture's top goes.
  function revealSelectionTools() {
    var body = $('#wiz-body'), last = Opt.lay === 'strip' && !$('#rest-strip').hidden ? $('#rest-strip') : $('#layout-selrow');
    var b = body.getBoundingClientRect(), r = last.getBoundingClientRect(), top = $('#layout-alert').getBoundingClientRect().top;
    var over = r.bottom + 6 - b.bottom;
    if (over > 0) body.scrollTop += Math.min(over, Math.max(0, top - b.top));
  }
  var needFit = false;      // the copies were just arranged or added to: zoom to them on entry
  var needRefit = false;    // the plate was arranged again behind a lay-down: show all of it
  var layHint = null, rafPending = false;
  function scheduleLayoutRender() {
    if (rafPending) return; rafPending = true;
    requestAnimationFrame(function () {
      rafPending = false; editor.sync(); renderLayoutSide(); updateNext();
      if (needRefit) { needRefit = false; editor.resetHandle(); editor.resetView(); }
    });
  }
  function renderLayoutSide() {
    var sel = S.selected.map(copyById).filter(Boolean);
    $('#btn-dup').disabled = !sel.length; $('#btn-del').disabled = !sel.length;
    var s = $('#layout-selection');
    $('#layout-selrow').classList.toggle('has-sel', sel.length > 0);
    if (!sel.length) s.textContent = S.copies.length + ' cop' + (S.copies.length === 1 ? 'y' : 'ies') + ' on the plate. Click one to select it.';
    else if (sel.length === 1) { var d = PL.derive(sel[0]); s.innerHTML = ''; s.appendChild(el('strong', null, copyLabel(sel[0]))); s.appendChild(document.createTextNode(' ' + Math.round(d.w) + ' × ' + Math.round(d.l) + ' mm, ' + Math.round(d.height) + ' mm tall')); }
    else { s.innerHTML = ''; s.appendChild(el('strong', null, sel.length + ' copies')); s.appendChild(document.createTextNode(' move and turn together')); }
    renderOrientLine(sel); renderStrip(sel); renderGestures();
    $('#btn-undo').disabled = !S.undo.length; $('#btn-redo').disabled = !S.redo.length;
    $('#btn-tilt').hidden = Opt.scheme !== 'T'; $('#btn-top').hidden = Opt.scheme === 'T';
    // The first problem is also said inside the picture, where the student is looking; the
    // full sentences and their remedy buttons are below it.
    var alertBox = $('#layout-alert');
    alertBox.innerHTML = ''; alertBox.classList.toggle('ok', !S.problems.length); alertBox.disabled = !S.problems.length;
    if (S.problems.length) {
      var first = S.problems[0].message.split('. ')[0] + '.';
      alertBox.appendChild(el('span', 'first', first)); alertBox.title = first;
      alertBox.appendChild(el('span', 'more', S.problems.length > 1 ? '+' + (S.problems.length - 1) + ' more ↓' : 'Fix ↓'));
    } else {
      alertBox.title = '';
      alertBox.appendChild(el('span', 'first', S.copies.length ? '✓ ' + (S.copies.length === 1 ? 'The copy fits' : 'All ' + S.copies.length + ' copies fit') + ' the plate.' : 'No copies yet: add parts on the Parts step.'));
    }
    var box = $('#layout-errors'); box.innerHTML = '';
    if (layHint) box.appendChild(layHint);
    S.layoutNotes.forEach(function (n) { box.appendChild(n); });
    if (S.problems.length) {
      box.appendChild(el('div', 'hint fix-first', S.problems.length === 1 ? 'Fix this before Next:' : 'Fix these ' + S.problems.length + ' before Next (click one to select its copies):'));
      S.problems.forEach(function (p) {
        // a copy Arrange left beside the plate: pressing Arrange again cannot help
        var parkedCopy = p.rule === 'off_plate' && S.layoutNotes.length && PL.bbox(PL.worldHull(copyById(p.copies[0]))).minX > PLATE.x;
        var acts = p.rule === 'too_tall' ? [['Auto-orient', function (e) { e.stopPropagation(); S.selected = p.copies.slice(); autoOrient(p.copies); }]]
                 : parkedCopy ? [['Back to Parts', function (e) { e.stopPropagation(); gotoStep('parts'); }]]
                 : [['Arrange', function (e) { e.stopPropagation(); doArrange(); }]];
        var m = msg('error', p.message.split('. ')[0] + '.', parkedCopy ? 'It did not fit: lower its quantity, or lay copies another way to make room.' : p.message.split('. ').slice(1).join('. '), acts);
        m.classList.add('clickable');
        m.addEventListener('click', function () { S.selected = p.copies.slice(); editor.resetHandle(); editor.sync(); renderLayoutSide(); });
        box.appendChild(m);
      });
    }
  }
  // Under the selection: whether it lies as chosen automatically, and the one way back to
  // how it was modelled.
  function renderOrientLine(sel) {
    var box = $('#layout-orient'); box.innerHTML = '';
    var same = sel.length && sel.every(function (c) { return c.partKey === sel[0].partKey; });
    box.hidden = !same;
    if (!same) return;
    var modelled = sel.every(function (c) { return P.isModelled(c.q); }), auto = sel.every(function (c) { return c.auto; });
    var best = P.resting(sel[0].partKey).list[0];
    function link(t, fn) { var b = el('button', 'linkish', t); b.type = 'button'; b.addEventListener('click', fn); box.appendChild(b); }
    if (auto && !modelled) {
      box.appendChild(el('span', 'auto-chip', 'Laid down automatically'));
      link('Put back as modelled', function () { layCopies(sel, function () { return P.resting(sel[0].partKey).modelled; }, 'modelled'); });
    } else if (!modelled) {
      box.appendChild(document.createTextNode('Laid down by you. '));
      link('Put back as modelled', function () { layCopies(sel, function () { return P.resting(sel[0].partKey).modelled; }, 'modelled'); });
    } else if (best && !best.modelled) {
      box.appendChild(document.createTextNode('As modelled. '));
      link('Lay it the best way', function () { autoOrient(sel.map(function (c) { return c.id; })); });
    } else box.appendChild(document.createTextNode('As modelled, which is already its best way.'));
  }
  // The resting-position strip: under the view, while the selection is copies of one part,
  // a picture of each way that part can lie, the auto-orient choice first and marked Best,
  // the way it lies now outlined. A click lays every selected copy that way.
  function renderStrip(sel) {
    var box = $('#rest-strip'); box.innerHTML = '';
    box.hidden = Opt.lay !== 'strip' || !sel.length;
    if (box.hidden) return;
    var key = sel[0].partKey;
    if (sel.some(function (c) { return c.partKey !== key; })) { box.appendChild(el('div', 'hint', 'Select copies of one part to choose how they lie.')); return; }
    var R = P.resting(key), cur = P.restIndex(key, sel[0].q);
    if (sel.some(function (c) { return P.restIndex(key, c.q) !== cur; })) cur = -2;
    var nWays = R.list.length + (R.modelledListed ? 0 : 1);
    box.appendChild(el('div', 'rs-head', nWays === 1 ? 'It can lie flat only this way.' : 'The ' + nWays + ' ways ' + (sel.length > 1 ? 'they' : 'it') + ' can lie. Click one to lay ' + (sel.length > 1 ? 'them' : 'it') + ' that way:'));
    var row = el('div', 'rs-row');
    var items = R.list.map(function (c, i) { return { cand: c, i: i }; });
    if (!R.modelledListed) items.push({ cand: R.modelled, i: 'm' });
    items.forEach(function (it) {
      var c = it.cand, on = it.i === 'm' ? cur === -1 && P.isModelled(sel[0].q) : it.i === cur;
      var b = el('button', 'rs-item' + (on ? ' on' : '')); b.type = 'button';
      var img = el('img'); img.alt = ''; img.src = restThumb(key, it.i, c.q); b.appendChild(img);
      if (it.i === 0) b.appendChild(el('span', 'rs-best', 'Best'));
      var tall = c.height > PLATE.height;
      b.appendChild(el('span', 'rs-line', Math.round(c.height) + ' mm tall'));
      if (it.i === 'm') b.appendChild(el('span', 'rs-line', 'as modelled'));
      if (tall) b.appendChild(el('span', 'rs-line bad', 'too tall'));
      else if (c.supports) b.appendChild(el('span', 'rs-line warn', 'overhangs'));
      b.title = (it.i === 0 ? 'The best way, chosen automatically: ' : it.i === 'm' ? 'As modelled: ' : '') + Math.round(c.height) + ' mm tall, ' + Math.round(c.contact) + ' mm² on the plate' + (c.overhang > 1 ? ', ' + Math.round(c.overhang) + ' mm² over air' : '') + (c.supports ? '. Much of it hangs over air, so it will probably need Supports.' : '');
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.addEventListener('click', function () { layCopies(sel, function () { return c; }, it.i === 0 ? 'auto' : it.i === 'm' ? 'modelled' : 'pick'); });
      row.appendChild(b);
    });
    box.appendChild(row);
  }
  // One line under the view: the gestures of the mouse scheme and of the way to lay a copy
  // down, chosen in the scenario strip, so a student need not be told.
  var GESTURES = {
    O: 'Drag a copy to move it, its round handle to turn it. Right-drag to look around, Shift-drag to slide, scroll to zoom.',
    S: 'Drag a copy to move it, its round handle to turn it. Drag empty space to look around, right-drag to slide, scroll to zoom.',
    T: 'Seen from above. Drag a copy to move it, its round handle to turn it. Drag empty space to slide, scroll to zoom, right-drag or 3D to tilt.'
  };
  var LAY_GESTURE = {
    strip: 'Select a copy to see pictures of the ways it can lie; click one to lay it that way.',
    markers: 'Select a copy, then click an arrow (↓) on one of its faces to lay it on that face.',
    box: 'Select a copy, then click a side of the box around it to put that side down, or drag the box to roll it.',
    tip: 'Select a copy, then click ⤵ beside its round handle to tip it onto its next side.'
  };
  var MORE = {
    O: ['Left-drag on empty plate also looks around; middle-drag, Ctrl + right-drag or Shift-drag slides the view.'],
    S: ['Shift-drag also slides the view.'],
    T: ['Middle-drag also slides; Top puts the view back above the plate.']
  };
  function renderGestures() {
    $('#layout-gestures').textContent = GESTURES[Opt.scheme] + ' ' + LAY_GESTURE[Opt.lay];
    var ul = $('#layout-more'); ul.innerHTML = '';
    MORE[Opt.scheme].concat([
      'Shift- or Ctrl-click adds a copy to the selection; drag one to move them all.',
      'The handle snaps every 45 degrees.',
      'Double-click a flat face to lay the copy down on it.',
      'F zooms to the copies; Ctrl+1 looks from above.',
      'Ctrl+Z undoes, Ctrl+Y or Ctrl+Shift+Z redoes, Ctrl+D duplicates, Delete removes, Ctrl+A selects every copy, Escape clears.'
    ]).forEach(function (t) { ul.appendChild(el('li', null, t)); });
  }
  function doArrange() {
    pushUndo();
    var res = PL.bestArrange(S.copies, PLATE);
    S.layoutNotes = arrangeNote(res, tryBestWay(res));
    layHint = res.parked ? null : msg('ok', 'Arranged ' + plural(res.placed, 'copy', 'copies') + (res.turned ? ', turning ' + res.turned : '') + '.', null);
    recheck(); editor.resetHandle(); editor.sync(); editor.resetView(); scheduleLayoutRender();
  }
  function deleteSelected() {
    if (!S.selected.length) return;
    pushUndo();
    var notes = [];
    S.selected.slice().forEach(function (id) {
      var c = copyById(id); if (!c) return;
      var p = partById(c.partId);
      S.copies.splice(S.copies.indexOf(c), 1);
      p.qty--;
      if (p.qty <= 0) { S.parts.splice(S.parts.indexOf(p), 1); notes.push(p.name); }
    });
    S.selected = [];
    layHint = notes.length ? msg('info', 'Deleted the last copy of ' + notes.join(' and ') + ', so the Parts step no longer lists ' + (notes.length > 1 ? 'them' : 'it') + '.', null) : null;
    recheck(); scheduleLayoutRender(); updateSummary();
  }
  function duplicateSelected() {
      var made = [];
      if (!S.selected.length) return;
      if (S.copies.length + S.selected.length > MAX_COPIES) { layHint = msg('error', 'Cannot duplicate: the plate would hold ' + (S.copies.length + S.selected.length) + ' copies.', TOO_MANY_COPIES_MESSAGE); renderLayoutSide(); return; }
      pushUndo();
      S.selected.forEach(function (id) {
        var c = copyById(id), p = partById(c.partId), n = newCopy(p);
        n.q = c.q.clone(); n.x = c.x; n.y = c.y; n.auto = c.auto;
        // the duplicate lands in the free spot nearest its original
        if (!PL.placeNear(n, S.copies, PLATE, c.x, c.y)) PL.place(n, S.copies, PLATE);
        S.copies.push(n); p.qty++; made.push(n.id);
      });
      S.selected = made; layHint = null; recheck(); editor.resetHandle();
      if (made.some(function (id) { return !editor.inView(id); })) needRefit = true;      // keep the new copy in sight
      scheduleLayoutRender(); updateSummary();
  }
  function bindLayout() {
    $('#btn-arrange').addEventListener('click', doArrange);
    $('#btn-orient').addEventListener('click', function () { autoOrient(S.selected.slice()); });
    $('#btn-undo').addEventListener('click', undo);
    $('#btn-redo').addEventListener('click', redo);
    $('#btn-view').addEventListener('click', function () { editor && editor.resetView(); });
    $('#btn-view-plate').addEventListener('click', function () { editor && editor.viewPlate(); });
    $('#btn-top').addEventListener('click', function () { editor && editor.topView(); });
    $('#btn-tilt').addEventListener('click', function () { if (editor) $('#btn-tilt').textContent = editor.toggleTilt() ? 'Above' : '3D'; });
    $('#layout-alert').addEventListener('click', function () { $('#layout-errors').scrollIntoView({ block: 'start', behavior: 'smooth' }); });
    $('#btn-del').addEventListener('click', deleteSelected);
    $('#btn-dup').addEventListener('click', duplicateSelected);
  }
  function setOption(name, value) {
    Opt[name] = value;
    if (name === 'scheme') $('#btn-tilt').textContent = '3D';
    if (editor) { if (name === 'scheme') editor.setScheme(value); if (name === 'lay') editor.setLayOption(value); }
    if (S.step === 'layout') renderLayoutSide();
  }

  // put a copy at the candidate spot that causes the fewest problems besides the wanted one
  function bestSpot(c, spots, rule) {
    var best = null;
    spots.forEach(function (s) {
      c.x = s[0]; c.y = s[1];
      var ps = PL.check(S.copies, PLATE, copyLabel), wanted = ps.filter(function (p) { return p.rule === rule; }).length;
      var score = wanted ? ps.length - wanted : 99;
      if (!best || score < best.score) best = { score: score, s: s };
    });
    c.x = best.s[0]; c.y = best.s[1];
  }

  // armed layout errors: applied now if on the Layout step, else when it is next entered
  function applyLayoutArms() {
    if (S.step !== 'layout' || !S.copies.length) return;
    var c0 = S.copies[0], d0, note = null;
    if (Mock.take('too_close')) {
      if (S.copies.length < 2) { var p = partById(c0.partId), n = newCopy(p); n.q = c0.q.clone(); S.copies.push(n); p.qty++; }
      // put one copy 2 mm from another: the pair and the side that break no other rule
      var pick = null;
      S.copies.forEach(function (a) {
        S.copies.forEach(function (b) {
          if (a === b) return;
          var da = PL.derive(a), db = PL.derive(b), keep = [b.x, b.y];
          var gx = da.w / 2 + db.w / 2 + 2, gy = da.l / 2 + db.l / 2 + 2;
          [[a.x + gx, a.y], [a.x - gx, a.y], [a.x, a.y + gy], [a.x, a.y - gy]].forEach(function (s) {
            b.x = s[0]; b.y = s[1];
            var ps = PL.check(S.copies, PLATE, copyLabel), wanted = ps.filter(function (p) { return p.rule === 'too_close'; }).length;
            var score = wanted ? ps.length - wanted : 99;
            if (!pick || score < pick.score) pick = { score: score, b: b, s: s };
          });
          b.x = keep[0]; b.y = keep[1];
        });
      });
      pick.b.x = pick.s[0]; pick.b.y = pick.s[1];
    }
    if (Mock.take('off_plate')) {
      var c = S.copies[S.copies.length - 1], d = PL.derive(c);
      var yy = Math.min(Math.max(c.y, d.l / 2 + 10), PLATE.y - d.l / 2 - 10), xx = Math.min(Math.max(c.x, d.w / 2 + 10), PLATE.x - d.w / 2 - 10);
      bestSpot(c, [[PLATE.x - d.w * 0.25, yy], [d.w * 0.25, yy], [xx, PLATE.y - d.l * 0.25], [xx, d.l * 0.25]], 'off_plate');
    }
    if (Mock.take('too_tall')) {
      var rib = S.copies.filter(function (x) { return x.partKey === 'rib'; })[0];
      if (!rib) {
        var part = { id: 'p' + (S.nextId++), key: 'rib', name: P.byKey.rib.name, qty: 1, status: 'ready', warn: null, error: null };
        S.parts.push(part); rib = newCopy(part); rib.q = new T.Quaternion(); rib.auto = false; S.copies.push(rib);
        var ribOthers = S.copies.filter(function (x) { return x !== rib; }), ribMid = PL.centre(ribOthers, PLATE);
        if (!PL.placeNear(rib, ribOthers, PLATE, ribMid[0], ribMid[1])) PL.place(rib, ribOthers, PLATE);
        note = msg('info', 'Mockup: added a ' + part.name + ' standing up, to show the height rule.', null);
      } else { rib.q = new T.Quaternion(); rib.d = null; rib.auto = false; note = msg('info', 'Mockup: stood ' + copyLabel(rib) + ' up as modelled, to show the height rule.', null); }
    }
    if (note) layHint = note;
    recheck();
    if (editor) { editor.sync(); renderLayoutSide(); updateNext(); updateSummary(); }
  }

  /* ================================================================== Preview step */
  var viewer = null, gen = null;
  var STAGES = [
    { name: 'Sending the plate to the slicer', w: 0.06 },
    { name: 'Slicing mesh', w: 0.12 },
    { name: 'Generating perimeters', w: 0.18 },
    { name: 'Preparing infill', w: 0.1 },
    { name: 'Generating infill toolpath', w: 0.22 },
    { name: 'Generating support', w: 0.12, support: true },
    { name: 'Generating skirt & brim', w: 0.04 },
    { name: 'Generating G-code', w: 0.16 }
  ];
  function signature() {
    return JSON.stringify({ c: S.copies.map(function (c) { return [c.partKey, c.q.toArray().map(function (x) { return +x.toFixed(4); }), +c.x.toFixed(1), +c.y.toFixed(1)]; }), s: eff(), f: S.filament });
  }
  function plateVolume() { return S.copies.reduce(function (a, c) { return a + P.byKey[c.partKey].volume; }, 0) / 1000; }

  function enterPreview() {
    if (S.result && S.resultSig === signature()) { showResult(); return; }
    if (S.job && S.job.state === 'running') return;
    startSlice();
  }
  function clearPreview() {
    $('#preview-errors').innerHTML = ''; $('#preview-result').hidden = true; $('#slice-card').hidden = true; $('#preview-toast').hidden = true;
  }
  function startSlice() {
    clearPreview(); S.result = null; S.resultSig = null; updateNext();
    var v = eff(), vol = plateVolume(), copies = S.copies.slice();
    var forced = Mock.take('too_large');
    if (forced || vol > PLATE_VOLUME_CAP_CM3) {
      var cap = forced ? Math.max(10, Math.floor(vol * 0.75 / 10) * 10) : PLATE_VOLUME_CAP_CM3;
      $('#preview-errors').appendChild(msg('error',
        'This plate is too large for the server to slice: its ' + copies.length + ' copies hold about ' + Math.round(vol) + ' cm³ of plastic, and the server slices up to ' + cap + ' cm³ at once.',
        copies.length > 1 ? 'Lower the quantities and print the rest in a second job.'
                          : 'This one copy is more than the server can slice, so it cannot be printed from here. Slice it in Orca Slicer on a shop computer.',
        copies.length > 1 ? [['Back to Parts', function () { gotoStep('parts'); }, 'primary'], ['Back to Layout', function () { gotoStep('layout'); }]]
                          : [['Back to Parts', function () { gotoStep('parts'); }]],
        'Refused before slicing: plate_volume_cm3=' + vol.toFixed(1) + ' cap=' + cap + ' (memory model, supports ' + (v.enable_support ? 'on' : 'off') + ').'));
      if (forced) $('#preview-errors').appendChild(msg('info', 'Mockup: the cap was lowered for this plate to show the message. The mockup’s real cap is ' + PLATE_VOLUME_CAP_CM3 + ' cm³.', null));
      return;
    }
    // which failure, if any, this slice will meet
    var fail = null, suspect = pickSuspect();
    var armedEmpty = Mock.has('empty_layers'), armedFaulty = Mock.has('faulty_mesh');
    if (!v.enable_support && (armedEmpty || armedFaulty)) { if (armedEmpty) Mock.take('empty_layers'); fail = { type: 'empty', at: 0.18 }; }
    else if (v.enable_support && armedFaulty) { Mock.take('faulty_mesh'); fail = { type: 'faulty', at: 0.18 }; }
    else if (v.enable_support && armedEmpty) Mock.take('empty_layers');        // Supports on is the fix: it slices
    var timeout = Mock.take('timeout'), conn = Mock.take('conn_lost'), autoCancel = Mock.take('cancel');
    var layers = Math.max.apply(null, copies.map(function (c) { return Math.ceil(PL.derive(c).height / v.layer_height); }));
    var expected = Math.round(8 + 1.6 * copies.length + vol * 0.12 + layers * 0.04 + (v.enable_support ? 6 : 0));
    var job = S.job = { state: 'running', t: 0, shown: 0, expected: expected, actual: expected * (0.88 + Math.random() * 0.24),
                        fail: fail, suspect: suspect, timeout: timeout, conn: conn ? { at: 0.35 + Math.random() * 0.1 } : null,
                        autoCancel: autoCancel, tp: null, support: v.enable_support, settings: v, sig: signature(), copies: copies };
    gen = Preview3D.generate(copies, v, function (res) { job.tp = res; });
    renderStages(job, 0);
    $('#slice-card').hidden = false; $('#slice-card').classList.remove('stalled');
    $('#slice-expected').textContent = 'about ' + clock(expected) + ' left';
    $('#slice-conn').hidden = true;
    job.ticker = addJob({ tick: function (dt) { tickSlice(job, dt); } });
    tickSlice(job, 0);
  }
  function pickSuspect() {
    var warned = S.copies.filter(function (c) { var p = partById(c.partId); return p && p.warn; })[0];
    if (warned) return warned;
    return S.copies.slice().sort(function (a, b) { return PL.derive(b).height - PL.derive(a).height; })[0];
  }
  function activeStages(job) { return STAGES.filter(function (s) { return !s.support || job.support; }); }
  function stageAt(job, p) {
    var st = activeStages(job), tot = st.reduce(function (a, s) { return a + s.w; }, 0), acc = 0;
    for (var i = 0; i < st.length; i++) { acc += st[i].w / tot; if (p < acc - 1e-9) return { i: i, name: st[i].name }; }
    return { i: st.length - 1, name: st[st.length - 1].name };
  }
  function renderStages(job, p) {
    var ol = $('#slice-stages'); ol.innerHTML = '';
    var cur = stageAt(job, p).i, n = 0;
    STAGES.forEach(function (s) {
      var li = el('li', null, s.name);
      if (s.support && !job.support) { li.className = 'skip'; li.title = 'Supports is off'; ol.appendChild(li); return; }
      li.className = n < cur || p >= 1 ? 'done' : (n === cur ? 'now' : '');
      n++; ol.appendChild(li);
    });
  }
  function tickSlice(job, dt) {
    if (job.state !== 'running') return;
    job.t += dt * Mock.factor('slice');
    var p = Math.min(1, job.t / job.actual);
    if (job.timeout) p = Math.min(0.93, 0.62 * (1 - Math.exp(-job.t / 25)) + 0.3 * Math.min(1, job.t / SLICE_TIMEOUT_S));
    // connection lost: the page stops hearing for a while; the clock keeps going
    var lost = false;
    if (job.conn && p >= job.conn.at && !job.conn.done) {
      if (job.conn.start == null) { job.conn.start = job.t; job.conn.real = performance.now(); }
      var gone = (performance.now() - job.conn.real) / 1000;          // a network outage runs on the real clock
      if (gone < 8) {
        lost = true;
        var c = $('#slice-conn'); c.hidden = false; c.className = 'conn lost';
        c.innerHTML = ''; c.appendChild(el('span', 'spin'));
        c.appendChild(document.createTextNode(' Lost the connection to the server at ' + clock(job.conn.start) + '. Reconnecting (try ' + (1 + Math.floor(gone / 2.5)) + ')… The slice keeps running on the server.'));
      } else {
        job.conn.done = true;
        var cc = $('#slice-conn'); cc.className = 'conn back';
        cc.textContent = 'Reconnected at ' + clock(job.t) + '. The slice kept running; the progress below is up to date.';
        after(5, 'slice', function () { if (job.conn.done) $('#slice-conn').hidden = true; });
      }
    }
    if (lost) {                         // the page hears nothing: only its own clock moves
      $('#slice-elapsed').textContent = clock(job.t);
      $('#slice-stage').textContent = stageAt(job, job.shown).name + ' (last heard)';
      var exl = $('#slice-expected'); exl.className = 'late'; exl.textContent = 'no news since ' + clock(job.conn.start);
      $('#slice-card').classList.add('stalled');
      $all('#g-layers rect').forEach(function (r) { r.classList.remove('on'); });
      return;
    }
    job.shown = p;
    if (job.conn && job.conn.done && p >= 1 && !job.conn.told) {
      job.conn.told = true;
      $('#slice-conn').textContent = 'Reconnected at ' + clock(job.t) + '. The slice finished on the server while the connection was down.';
    }
    if (job.timeout && job.t >= SLICE_TIMEOUT_S) return failSlice(job, 'timeout');
    if (job.fail && p >= job.fail.at) return failSlice(job, job.fail.type);
    if (job.autoCancel && p >= 0.5) return cancelSlice('auto');
    var shown = job.shown;
    if (p >= 1 && !job.tp) shown = 0.99;
    $('#slice-pct').textContent = Math.floor(shown * 100) + '%';
    $('#slice-stage').textContent = stageAt(job, shown).name;
    $('#slice-elapsed').textContent = clock(job.t);
    var late = job.t > job.expected * 1.3;
    var ex = $('#slice-expected'); ex.className = late ? 'late' : '';
    var left = job.expected - job.t;
    ex.textContent = late ? 'taking longer than the expected ' + clock(job.expected)
      : left > 1 ? 'about ' + clock(left) + ' left' : 'finishing';
    $('#slice-card').classList.toggle('stalled', lost || late);
    $('#g-fill').style.strokeDasharray = String(2 * Math.PI * 27);
    $('#g-fill').style.strokeDashoffset = String(2 * Math.PI * 27 * (1 - shown));
    $('#slice-bar-fill').style.width = (shown * 100).toFixed(1) + '%';
    var lit = lost ? -1 : Math.floor(job.t * 2 / Math.max(1, Mock.factor('slice') / 2)) % 5;
    $all('#g-layers rect').forEach(function (r, i) { r.classList.toggle('on', 3 - i < lit); });
    renderStages(job, shown);
    if (p >= 1 && job.tp) finishSlice(job);
  }
  function stopJob(job) { job.state = job.state === 'running' ? 'stopped' : job.state; dropJob(job.ticker); if (gen) gen.cancel(); }
  function failSlice(job, type) {
    stopJob(job); job.state = 'failed';
    $('#slice-card').hidden = true;
    var box = $('#preview-errors'); box.innerHTML = '';
    var sus = job.suspect, label = sus ? copyLabel(sus) : 'A copy', h = sus ? PL.derive(sus).height : 40;
    var z1 = +(h * 0.62).toFixed(2), z2 = +(z1 + 0.72).toFixed(2), zr = Math.round(z1 * 10) / 10;
    var name = sus && partById(sus.partId) ? partById(sus.partId).name : 'the part';
    var orca = 'Orca returned -100. result.json: "Object can’t be printed for empty layer between ' + z1 + ' and ' + z2 + '. Make sure the object is printable or the object has faulty mesh."';
    if (type === 'empty') {
      box.appendChild(msg('error', 'The slice failed: ' + label + ' has empty layers at about ' + zr + ' mm above the plate.',
        'Part of it starts in mid-air there, and Supports is off, so nothing would hold it up while it prints. Turn Supports on and slice again.',
        [['Turn on Supports and slice again', function () { setSetting('enable_support', true); startSlice(); updateSummary(); }, 'primary'], ['Back to Layout', function () { gotoStep('layout'); }]],
        orca + '\nSupports: off. Copy ' + label + ', part ' + name + '.'));
    } else if (type === 'faulty') {
      box.appendChild(msg('error', 'The slice failed: ' + label + ' has a faulty mesh at about ' + zr + ' mm above the plate.',
        'Supports is already on, so the model itself has gaps or zero-thickness pieces there. Repair ' + name + ' in CAD (look for faces that do not meet near ' + zr + ' mm), then ' +
          (S.ctx === 'standalone' ? 'upload the repaired file on the Parts step.' : 'press ↻ on its row on the Parts step to bring in the repaired version.'),
        [['Back to Parts', function () { gotoStep('parts'); }, 'primary']],
        orca + '\nSupports: on (' + job.settings.support_type + '). Copy ' + label + ', part ' + name + '.'));
    } else if (type === 'timeout') {
      box.appendChild(msg('error', 'The slice took longer than ' + (SLICE_TIMEOUT_S / 60) + ' minutes, the server’s limit, and was stopped.',
        job.copies.length > 1
          ? 'Slice again first: the server may have been busy. If it stops again, this plate of ' + job.copies.length + ' copies is too much at once: lower the quantities and print the rest on a second plate, or pick the Draft profile.'
          : 'Slice again first: the server may have been busy. If it stops again, pick the Draft profile, whose thicker layers slice faster.',
        job.copies.length > 1 ? [['Slice again', startSlice, 'primary'], ['Back to Parts', function () { gotoStep('parts'); }]]
                              : [['Slice again', startSlice, 'primary'], ['Back to Setup', function () { gotoStep('setup'); }]],
        'Orca killed after ' + SLICE_TIMEOUT_S + ' s at stage "' + stageAt(job, job.shown).name + '". Copies ' + job.copies.length + ', volume ' + plateVolume().toFixed(1) + ' cm³.'));
    }
    updateNext();
  }
  function cancelSlice(why) {
    var job = S.job; if (!job || job.state !== 'running') return;
    var at = clock(job.t), stage = stageAt(job, job.shown).name;
    stopJob(job); job.state = 'cancelled';
    $('#slice-card').hidden = true;
    if (why === 'left') return;            // leaving the Preview step stops the slice quietly
    var box = $('#preview-errors'); box.innerHTML = '';
    box.appendChild(msg('info', 'Slice cancelled at ' + at + ', during “' + stage + '”. Nothing was saved or sent to the printer.',
      'Change the plate or the settings with Back, or slice again.',
      [['Slice again', startSlice, 'primary'], ['Back to Layout', function () { gotoStep('layout'); }]]));
    updateNext();
  }
  function finishSlice(job) {
    stopJob(job); job.state = 'done';
    var est = Preview3D.estimate(job.tp, job.settings, filamentObj());
    S.result = { tp: job.tp, est: est, copies: job.copies, settings: job.settings, filament: filamentObj(), sliceTime: job.t };
    S.resultSig = job.sig;
    $('#slice-card').hidden = true;
    showResult();
    if (job.conn && job.conn.done) {
      var t = $('#preview-toast'); t.hidden = false;
      t.textContent = 'The connection to the server dropped at ' + clock(job.conn.start) + ' and came back; the slice kept running and finished normally.';
      $('#preview-result').parentNode.insertBefore(t, $('#preview-result'));
    }
  }
  function showResult() {
    clearPreview();
    var r = S.result; $('#preview-result').hidden = false;
    var stats = $('#preview-stats'); stats.innerHTML = '';
    // the two numbers a student plans around, large; the rest on one quiet line
    [['Print time', hm(r.est.seconds)], ['Filament', Math.round(r.est.grams) + ' g ' + r.filament.type]].forEach(function (s) {
      var d = el('div', 'stat'); d.appendChild(el('strong', null, s[1])); d.appendChild(document.createTextNode(s[0])); stats.appendChild(d);
    });
    stats.appendChild(el('div', 'stat-line', r.copies.length + ' cop' + (r.copies.length === 1 ? 'y' : 'ies') + ' · ' + r.tp.layers + ' layers of ' + r.settings.layer_height + ' mm · sliced in ' + clock(r.sliceTime)));
    if (!viewer) viewer = Preview3D.createViewer($('#viewer-container'), PLATE);
    setTimeout(function () {
      viewer.resize(); viewer.show(r.tp, r.copies);
      Object.keys(S.hiddenTypes).forEach(function (k) { if (S.hiddenTypes[k]) viewer.setVisible(k, false); });
      setLayer(r.tp.layers - 1);
    }, 0);
    renderLegend(r);
    renderPrint();
    updateNext();
  }
  // The legend, as Orca's for line types: each type's share of the print time, and a click
  // on a row hides that type in the layer preview (and shows it again).
  function renderLegend(r) {
    var lg = $('#legend'); lg.innerHTML = '';
    var total = r.est.seconds;
    function short(s) { return s < 60 ? '<1 min' : hm(s); }
    function pct(s) { var p = s / total * 100; return p < 1 ? '<1%' : Math.round(p) + '%'; }
    Preview3D.TYPES.forEach(function (ty) {
      if (!r.tp.acc[ty.id].pos.length) return;
      var off = !!S.hiddenTypes[ty.id], secs = r.est.byType[ty.id] || 0;
      var li = el('li', 'lg-row' + (off ? ' off' : '')); li.setAttribute('role', 'button'); li.tabIndex = 0;
      li.setAttribute('aria-pressed', off ? 'false' : 'true');
      li.title = (off ? 'Show ' : 'Hide ') + ty.label.toLowerCase() + ' in the layer preview';
      var sw = el('i'); sw.style.background = '#' + ('00000' + ty.color.toString(16)).slice(-6); li.appendChild(sw);
      li.appendChild(el('span', 'lg-name', ty.label));
      li.appendChild(el('span', 'lg-time', short(secs)));
      li.appendChild(el('span', 'lg-pct', pct(secs)));
      function flip() { S.hiddenTypes[ty.id] = !S.hiddenTypes[ty.id]; if (viewer) viewer.setVisible(ty.id, !S.hiddenTypes[ty.id]); renderLegend(r); }
      li.addEventListener('click', flip);
      li.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
      lg.appendChild(li);
    });
    var other = el('li', 'lg-row fixed');
    other.appendChild(el('i', 'none')); other.appendChild(el('span', 'lg-name', 'Heating, travel, layer changes'));
    other.appendChild(el('span', 'lg-time', short(r.est.overhead))); other.appendChild(el('span', 'lg-pct', pct(r.est.overhead)));
    lg.appendChild(other);
  }
  function setLayer(k) {
    var r = S.result; if (!r) return;
    k = Math.max(0, Math.min(r.tp.layers - 1, Math.round(k)));
    S.layer = k;
    if (viewer) viewer.setLayer(k);
    var frac = r.tp.layers > 1 ? k / (r.tp.layers - 1) : 1;
    $('#ls-thumb').style.top = ((1 - frac) * 100) + '%';
    $('#ls-fill').style.height = (frac * 100) + '%';
    var z = r.tp.zs[k] || 0;
    $('#ls-label').textContent = 'Layer ' + (k + 1);
    $('#layer-readout').textContent = (k + 1) + ' of ' + r.tp.layers + ' · ' + z.toFixed(1) + ' mm high';
  }
  function bindPreview() {
    $('#btn-cancel').addEventListener('click', function () { cancelSlice('button'); });
    var slider = $('#layer-slider'), dragging = false;
    function fromY(e) {
      var r = slider.getBoundingClientRect(), f = 1 - (e.clientY - r.top) / r.height;
      if (S.result) { S.followPrint = false; syncFollow(); setLayer(f * (S.result.tp.layers - 1)); }
    }
    slider.addEventListener('pointerdown', function (e) { dragging = true; slider.setPointerCapture(e.pointerId); fromY(e); e.preventDefault(); e.stopPropagation(); });
    slider.addEventListener('pointermove', function (e) { if (dragging) fromY(e); });
    slider.addEventListener('pointerup', function () { dragging = false; });
    slider.addEventListener('keydown', function (e) {
      if (!S.result) return;
      var n = S.result.tp.layers, k = S.layer;
      var map = { ArrowUp: k + 1, ArrowRight: k + 1, ArrowDown: k - 1, ArrowLeft: k - 1, PageUp: k + 10, PageDown: k - 10, Home: 0, End: n - 1 };
      if (map[e.key] !== undefined) { e.preventDefault(); S.followPrint = false; syncFollow(); setLayer(map[e.key]); }
    });
    $('#btn-layer-up').addEventListener('click', function () { S.followPrint = false; syncFollow(); setLayer(S.layer + 1); });
    $('#btn-layer-down').addEventListener('click', function () { S.followPrint = false; syncFollow(); setLayer(S.layer - 1); });
    $('#btn-preview-view').addEventListener('click', function () { if (viewer && S.result) viewer.reset(S.result.copies); });
    // final action: split button, as the CNC wizard
    $('#btn-do').addEventListener('click', function () { doAction(S.action); });
    $('#btn-do-caret').addEventListener('click', function (e) { e.stopPropagation(); $('#do-menu').hidden = !$('#do-menu').hidden; });
    $all('#do-menu li').forEach(function (li) {
      li.addEventListener('click', function () {
        // Choosing from the menu only changes what the button does; a separate press acts.
        // (On the first hardware test, a menu choice that printed at once surprised the owner.)
        S.action = li.getAttribute('data-action'); $('#do-menu').hidden = true;
        updateNext();
      });
    });
    document.addEventListener('click', function () { $('#do-menu').hidden = true; });
  }
  function doAction(a) {
    if (!S.result) return;
    if (a === 'download') {
      var t = $('#preview-toast'); t.hidden = false;
      t.textContent = 'Downloaded ' + fileName() + ' (' + (0.4 + S.result.copies.length * 0.21).toFixed(1) + ' MB). Mockup: no file is saved.';
      return;
    }
    confirmSend();
  }

  /* ================================================================== printing */
  // A physical print starts only after a second, deliberate press that names the printer
  // and what will be printed.
  function confirmSend() {
    var box = $('#preview-errors'); box.innerHTML = '';
    $('#preview-toast').hidden = true;
    var r = S.result, c = el('div', 'send-confirm');
    c.appendChild(el('div', 'sc-title', 'Send this plate to ' + ST.PRINTER.name + '?'));
    var ul = el('ul');
    ul.appendChild(el('li', null, r.copies.length + ' cop' + (r.copies.length === 1 ? 'y' : 'ies') + ': ' + S.parts.filter(function (p) { return p.status === 'ready'; }).map(function (p) { return (p.qty > 1 ? p.qty + ' × ' : '') + p.name; }).join(', ')));
    ul.appendChild(el('li', null, hm(r.est.seconds) + ', ' + Math.round(r.est.grams) + ' g of ' + r.filament.name));
    ul.appendChild(el('li', null, 'It starts printing as soon as it arrives.'));
    c.appendChild(ul);
    c.appendChild(el('div', 'sc-check', 'Check that the plate is empty and ' + r.filament.type + ' is loaded.'));
    var acts = el('div', 'acts');
    acts.appendChild(btn('Send and print', function () { box.innerHTML = ''; sendToPrinter(); }, 'primary'));
    acts.appendChild(btn('Not yet', function () { box.innerHTML = ''; }));
    c.appendChild(acts);
    box.appendChild(c);
    $('#wiz-body').scrollTop = 0;
  }
  function sendToPrinter() {
    var box = $('#preview-errors'); box.innerHTML = '';
    $('#preview-toast').hidden = true;
    var pr = S.print;
    if (pr && (pr.phase === 'upload' || pr.phase === 'prepare' || pr.phase === 'printing')) {
      box.appendChild(msg('error', ST.PRINTER.name + ' is busy: it is printing your earlier plate, ' + pr.file + ', ' + hm(pr.remaining) + ' left.',
        'This plate was not sent. Send it when that print ends, or Download the file.',
        [['Download', function () { doAction('download'); }]]));
      return;
    }
    if (Mock.take('printer_unreachable')) {
      box.appendChild(msg('error', 'Penguin Slicer cannot reach ' + ST.PRINTER.name + ': the shop computer that talks to the printer last reported 7 minutes ago.',
        'Your plate was not sent. Check that the printer and that computer are on and connected to the shop network, then send again. Or Download the file and print it another way.',
        [['Send again', confirmSend, 'primary'], ['Download', function () { doAction('download'); }]],
        'Relay: nothing heard from the team’s daemon for 7 min (last sync 14:02:11). Printer serial 0938…A1.'));
      return;
    }
    if (Mock.take('printer_busy')) {
      box.appendChild(msg('error', ST.PRINTER.name + ' is busy: it is printing drivetrain_gussets.gcode.3mf for someone else, 38 min left.',
        'Your plate was not sent. Send it again when that print ends, or Download the file.',
        [['Send again', confirmSend, 'primary'], ['Download', function () { doAction('download'); }]],
        'Printer state RUNNING, 61% of drivetrain_gussets.gcode.3mf, sent from another page.'));
      return;
    }
    var r = S.result, total = r.est.seconds;
    pr = S.print = { phase: 'upload', file: fileName(), up: 0, t: 0, prep: 270, total: total, layers: r.tp.layers, pct: 0, layer: 0,
                     remaining: total + 270, fail: Mock.take('print_fail') ? 0.38 : null,
                     finishAt: new Date(Date.now() + (total + 270) * 1000) };
    $('#print-card').hidden = false; $('#print-card').removeAttribute('data-key');
    pr.job = addJob({ tick: function (dt) { tickPrint(pr, dt); } });
    renderPrint();
  }
  function tickPrint(pr, dt) {
    if (pr !== S.print) { dropJob(pr.job); return; }
    if (pr.phase === 'upload') {
      pr.up += dt * Mock.factor('slice') / 8;
      if (pr.up >= 1) { pr.up = 1; pr.phase = 'prepare'; }
    } else if (pr.phase === 'prepare' || pr.phase === 'printing') {
      pr.t += dt * Mock.factor('print');
      if (pr.t < pr.prep) pr.phase = 'prepare';
      else {
        pr.phase = 'printing';
        var f = Math.min(1, (pr.t - pr.prep) / pr.total);
        pr.pct = f * 100; pr.layer = Math.max(1, Math.ceil(f * pr.layers));
        if (pr.fail && f >= pr.fail) { pr.phase = 'failed'; dropJob(pr.job); }
        else if (f >= 1) { pr.phase = 'finished'; pr.layer = pr.layers; dropJob(pr.job); }
        if (S.followPrint && S.result && S.step === 'preview') setLayer(pr.layer - 1);
      }
      pr.remaining = Math.max(0, pr.prep + pr.total - pr.t);
    }
    renderPrint();
    if (S.step === 'setup') renderPrinterLine();
  }
  function syncFollow() { var f = $('#pc-follow-box'); if (f) f.checked = S.followPrint; }
  // The four figures under the print's bar: layer of total, time left, time since it was
  // sent, and the time of day it should finish.
  function printCells(pr) {
    if (pr.phase === 'failed') return [[pr.layer + ' of ' + pr.layers, 'layer reached'], [hm(Math.max(0, pr.t)), 'after it was sent']];
    if (pr.phase === 'finished') return [[pr.layers + ' of ' + pr.layers, 'layers'], [hm(Math.max(0, pr.t)), 'from sending to done'], [clockTime(pr.finishAt), 'finished at']];
    return [
      [pr.phase === 'prepare' ? '0 of ' + pr.layers : pr.layer + ' of ' + pr.layers, 'layer'],
      [hm(pr.remaining), 'time left'],
      [hm(Math.max(0, pr.t)), 'since it was sent'],
      [clockTime(pr.finishAt), 'expected finish']
    ];
  }
  function renderPrint() {
    var pr = S.print, card = $('#print-card');
    if (!pr) { card.hidden = true; card.removeAttribute('data-key'); $('#preview-stats').hidden = false; return; }
    card.hidden = S.step !== 'preview';
    // The stage the print is in, as the printer reports it, on a track of the stages a print
    // goes through, so a student sees where it is and what comes next.
    var TRACK = ['Sending', 'Heating', 'Leveling', 'Printing', 'Done'];
    var at = pr.phase === 'upload' ? 0 : pr.phase === 'prepare' ? (pr.t < 150 ? 1 : 2) : pr.phase === 'finished' ? 4 : 3;
    if (pr.phase === 'failed') at = pr.failAt != null ? pr.failAt : 3;
    // The card is built once per stage; between stages only its figures change, so a
    // button or checkbox in it is never replaced under the pointer.
    var key = pr.phase + ':' + at;
    if (card.getAttribute('data-key') === key && card.firstChild) {
      var pc = card.querySelector('.pc-pct'), bf = card.querySelector('.pc-bar div'), strongs = card.querySelectorAll('.pc-grid strong');
      if (pc) pc.textContent = pr.phase === 'upload' ? Math.floor(pr.up * 100) + '%' : Math.floor(pr.pct) + '%';
      if (bf) bf.style.width = (pr.phase === 'upload' ? pr.up * 100 : pr.pct) + '%';
      printCells(pr).forEach(function (c, i) { if (strongs[i]) strongs[i].textContent = c[0]; });
      updateNext();
      return;
    }
    card.setAttribute('data-key', key); card.innerHTML = '';
    // while the plate is on its way or printing, the card says it all: the two planning
    // figures step aside so the layer preview stays in reach under the card
    $('#preview-stats').hidden = pr.phase === 'upload' || pr.phase === 'prepare' || pr.phase === 'printing';
    card.className = 'print-card' + (pr.phase === 'upload' ? ' uploading' : '') + (pr.phase === 'failed' ? ' failed' : '');
    var head = el('div', 'pc-head');
    var states = { upload: 'Sending to ' + ST.PRINTER.name,
                   prepare: pr.t < 150 ? 'Heating the bed and nozzle' : 'Leveling the bed',
                   printing: 'Printing', finished: 'Print finished', failed: 'Print stopped' };
    var dot = el('span', 'dot' + (pr.phase === 'printing' || pr.phase === 'prepare' || pr.phase === 'upload' ? ' pulse' : ''));
    if (pr.phase === 'failed') dot.style.background = 'var(--danger)';
    if (pr.phase === 'upload') dot.style.background = 'var(--accent)';
    head.appendChild(dot); head.appendChild(el('span', 'pc-state', states[pr.phase]));
    var big = pr.phase === 'upload' ? Math.floor(pr.up * 100) + '%' : pr.phase === 'prepare' ? '' : Math.floor(pr.pct) + '%';
    if (big) head.appendChild(el('span', 'pc-pct', big));
    card.appendChild(head);
    card.appendChild(el('div', 'pc-file', pr.file + ' on ' + ST.PRINTER.name));
    var track = el('ol', 'pc-track');
    TRACK.forEach(function (name, i) {
      var li = el('li', i < at ? 'done' : i === at ? (pr.phase === 'failed' ? 'bad' : pr.phase === 'finished' ? 'done' : 'now') : '', name);
      track.appendChild(li);
    });
    card.appendChild(track);
    var bar = el('div', 'pc-bar'), fill = el('div'); fill.style.width = (pr.phase === 'upload' ? pr.up * 100 : pr.pct) + '%'; bar.appendChild(fill); card.appendChild(bar);
    if (pr.phase === 'upload') {
      card.appendChild(el('div', 'pc-note', 'Nothing prints until the whole file has arrived.'));
      var ua = el('div', 'pc-acts');
      ua.appendChild(btn('Cancel sending', function () {
        dropJob(pr.job); S.print = null; renderPrint(); updateNext();
        var box = $('#preview-errors'); box.innerHTML = '';
        box.appendChild(msg('info', 'Sending cancelled. Nothing was sent to ' + ST.PRINTER.name + ' and nothing will print.', 'The sliced plate is still here: send it again or download it when you are ready.'));
        if (S.step === 'setup') renderPrinterLine();
      }, 'danger-outline'));
      card.appendChild(ua);
    } else {
      var g = el('div', 'pc-grid');
      var live = pr.phase === 'prepare' || pr.phase === 'printing';
      printCells(pr).forEach(function (c) { var d = el('div'); d.appendChild(el('strong', null, c[0])); d.appendChild(document.createTextNode(c[1])); g.appendChild(d); });
      card.appendChild(g);
      if (live) {
        card.appendChild(el('div', 'pc-note', 'From the printer’s own report, a few seconds behind. To pause or stop the print, use the printer’s screen.'));
        var fl = el('label', 'pc-follow'), cb = el('input'); cb.type = 'checkbox'; cb.id = 'pc-follow-box'; cb.checked = S.followPrint;
        cb.addEventListener('change', function () { S.followPrint = cb.checked; if (cb.checked && pr.layer) setLayer(pr.layer - 1); });
        fl.appendChild(cb); fl.appendChild(document.createTextNode('Layer preview follows the print')); card.appendChild(fl);
      }
    }
    if (pr.phase === 'finished') card.appendChild(msg('ok', 'The print finished: layer ' + pr.layers + ' of ' + pr.layers + '.', 'Take the plate off once the bed has cooled; PETG lets go more easily when cool.'));
    if (pr.phase === 'failed') card.appendChild(msg('error', 'The print stopped at layer ' + pr.layer + ' of ' + pr.layers + ' (' + Math.floor(pr.pct) + '%): the printer reported a filament tangle or a clogged nozzle.',
      'Clear the plate and check the filament path at the printer, then send the plate again. The sliced file is still here.',
      [['Send again', function () { S.print = null; renderPrint(); updateNext(); confirmSend(); }, 'primary'], ['Download', function () { doAction('download'); }]],
      'Printer state FAILED, print_error 0x0300800A at layer ' + pr.layer + '. File ' + pr.file + '.'));
    updateNext();
  }

  /* ================================================================== wiring */
  function bindNav() {
    $('#btn-next').addEventListener('click', function () { var i = ORDER.indexOf(S.step); if (i < 3 && canLeave(S.step)) gotoStep(ORDER[i + 1]); });
    $('#btn-back').addEventListener('click', function () { var i = ORDER.indexOf(S.step); if (i > 0) gotoStep(ORDER[i - 1]); });
    $all('#stepbar li').forEach(function (li) {
      li.addEventListener('click', function () { navigateTo(li.getAttribute('data-step')); });
      li.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateTo(li.getAttribute('data-step')); } });
    });
  }

  function reset(ctx) {
    jobs.slice().forEach(dropJob);
    if (gen) gen.cancel();
    S = fresh(ctx || 'partstudio');
    partsNote = null; layHint = null;
    $('#advanced').hidden = true;
    $('#print-card').hidden = true;
    pendingSnap = null;
    if (editor) editor.sync();
    if (viewer) viewer.clear();
    clearPreview();
    gotoStep('setup');
  }

  bindNav(); bindSetup(); bindAdvanced(); bindParts(); bindLayout(); bindPreview();

  window.Wizard = {
    Mock: Mock, reset: reset, onOnshapeSelect: onOnshapeSelect, setOption: setOption,
    armed: function () { if (S.step === 'layout') applyLayoutArms(); },
    state: function () { return S; },
    step: function () { return S.step; },
    resize: function () { if (editor) editor.resize(); if (viewer) viewer.resize(); }
  };
})();
