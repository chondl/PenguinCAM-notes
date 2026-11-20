/* Penguin Slicer mockup: the Layout step's 3D plate, like Orca's Prepare tab.
 * Pointer: drag a copy to move it across the plate; drag empty space to orbit; right-drag or
 * Shift-drag empty space to pan; wheel or pinch to zoom; click selects, Shift-click adds;
 * the round handle turns the selection about the vertical axis (snaps to 45 deg);
 * in Lay on face mode a click on a flat face lays that copy down on it. */
(function () {
  'use strict';
  var T = THREE;
  var COL = { accent: 0x2f81f7, danger: 0xf85149, plate: 0x2f3946, grid: 0x3d4857, grid5: 0x5b6979, face: 0x2f81f7 };

  function makePlate(scene, plate) {
    var g = new T.BoxGeometry(plate.x, plate.y, 2);
    var m = new T.Mesh(g, new T.MeshStandardMaterial({ color: COL.plate, roughness: 0.9, metalness: 0.05 }));
    m.position.set(plate.x / 2, plate.y / 2, -1.01);
    m.name = 'plate';
    scene.add(m);
    var pts = [], pts5 = [];
    for (var x = 0; x <= plate.x; x += 10) (x % 50 ? pts : pts5).push(x, 0, 0.02, x, plate.y, 0.02);
    for (var y = 0; y <= plate.y; y += 10) (y % 50 ? pts : pts5).push(0, y, 0.02, plate.x, y, 0.02);
    [[pts, COL.grid], [pts5, COL.grid5]].forEach(function (pair) {
      var lg = new T.BufferGeometry(); lg.setAttribute('position', new T.Float32BufferAttribute(pair[0], 3));
      scene.add(new T.LineSegments(lg, new T.LineBasicMaterial({ color: pair[1] })));
    });
    // the margin line and the build volume's outline
    var mg = plate.margin, ml = new T.BufferGeometry();
    ml.setAttribute('position', new T.Float32BufferAttribute([mg, mg, 0.05, plate.x - mg, mg, 0.05, plate.x - mg, mg, 0.05, plate.x - mg, plate.y - mg, 0.05,
      plate.x - mg, plate.y - mg, 0.05, mg, plate.y - mg, 0.05, mg, plate.y - mg, 0.05, mg, mg, 0.05], 3));
    var marginLine = new T.LineSegments(ml, new T.LineDashedMaterial({ color: 0x6b7785, dashSize: 4, gapSize: 3 }));
    marginLine.computeLineDistances();
    scene.add(marginLine);
    var box = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(plate.x, plate.y, plate.height)),
      new T.LineBasicMaterial({ color: 0x3a4450, transparent: true, opacity: 0.5 }));
    box.position.set(plate.x / 2, plate.y / 2, plate.height / 2);
    scene.add(box);
    // a front marker so "front edge" in the sentences has a meaning
    var tri = new T.Mesh(new T.CircleGeometry(5, 3), new T.MeshBasicMaterial({ color: 0x51606f }));
    tri.rotation.z = -Math.PI / 2; tri.position.set(plate.x / 2, -8, 0.05);
    scene.add(tri);
  }

  function lights(scene) {
    scene.add(new T.HemisphereLight(0xffffff, 0x3a4450, 0.85));
    var d = new T.DirectionalLight(0xffffff, 0.7); d.position.set(-200, -300, 500); scene.add(d);
    var d2 = new T.DirectionalLight(0xffffff, 0.3); d2.position.set(400, 500, 200); scene.add(d2);
  }

  function create(container, opts) {
    var plate = opts.plate;
    var canvas = document.createElement('canvas');
    canvas.className = 'gl-canvas'; canvas.tabIndex = 0;
    container.appendChild(canvas);
    var renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    var scene = new T.Scene();
    scene.background = new T.Color(0x0d1116);
    var camera = new T.PerspectiveCamera(40, 1, 1, 5000);
    camera.up.set(0, 0, 1);
    lights(scene); makePlate(scene, plate);

    var hoverTip = document.createElement('div'); hoverTip.className = 'gl-tip'; hoverTip.hidden = true; container.appendChild(hoverTip);

    // Our pointer handler is registered first, in the capture phase, so it can switch the
    // camera controls off before they see a press that lands on a copy or the handle.
    canvas.addEventListener('pointerdown', onDown, true);
    var controls = new T.OrbitControls(camera, canvas);
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.addEventListener('change', invalidate);

    var meshes = {};          // copy id -> mesh
    var raycaster = new T.Raycaster(), ndc = new T.Vector2();
    var layMode = false, drag = null, faceOverlay = null, hoverCopy = null;

    var handle = new T.Group();
    var disc = new T.Mesh(new T.CircleGeometry(1, 24), new T.MeshBasicMaterial({ color: COL.accent }));
    var ring = new T.Mesh(new T.RingGeometry(1.25, 1.6, 32), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
    handle.add(disc); handle.add(ring);
    var stemGeo = new T.BufferGeometry(); stemGeo.setAttribute('position', new T.Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3));
    var stem = new T.Line(stemGeo, new T.LineBasicMaterial({ color: COL.accent }));
    var selBox = new T.LineSegments(new T.BufferGeometry(), new T.LineDashedMaterial({ color: COL.accent, dashSize: 3, gapSize: 2 }));
    scene.add(handle); scene.add(stem); scene.add(selBox);
    var handleDir = new T.Vector2(0, 1);

    var needs = true;
    function invalidate() { needs = true; }
    function loop() {
      requestAnimationFrame(loop);
      if (!needs || !container.offsetParent) return;
      needs = false;
      placeHandle();
      renderer.render(scene, camera);
    }
    requestAnimationFrame(loop);

    function resize() {
      var w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix(); invalidate();
      if (!sized) { sized = true; resetView(); }
    }
    var sized = false;
    if (window.ResizeObserver) new ResizeObserver(resize).observe(container);

    // Look at a rectangle of the plate from the front, a little above: the whole plate, or
    // just the copies so that small parts are large enough to drag and to click a face on.
    function lookAt(cx, cy, w, l, tall) {
      controls.target.set(cx, cy, Math.min(tall, 60) / 3);
      var aspect = Math.max(0.5, camera.aspect || 1), fitH = l * 0.75 + tall * 0.7 + 30, fitW = (w + 30) / aspect;
      var dist = Math.max(fitH, fitW) / (2 * Math.tan(camera.fov * Math.PI / 360)) * 1.08;
      camera.position.set(cx, cy - dist * 0.5, controls.target.z + dist * 0.866);
      controls.update(); invalidate();
    }
    function viewPlate() {
      // the whole plate, widened to take in any copy waiting beside it
      var minX = 0, maxX = plate.x, minY = 0, maxY = plate.y;
      (opts.getCopies ? opts.getCopies() : []).forEach(function (c) {
        var hb = MockPlate.bbox(MockPlate.worldHull(c));
        minX = Math.min(minX, hb.minX); maxX = Math.max(maxX, hb.maxX); minY = Math.min(minY, hb.minY); maxY = Math.max(maxY, hb.maxY);
      });
      lookAt((minX + maxX) / 2, (minY + maxY) / 2, maxX - minX + 50, maxY - minY + 30, 0);
    }
    function resetView() {
      var copies = opts.getCopies ? opts.getCopies() : [];
      if (!copies.length) return viewPlate();
      var b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }, tall = 0;
      copies.forEach(function (c) {
        var hb = MockPlate.bbox(MockPlate.worldHull(c));
        b.minX = Math.min(b.minX, hb.minX); b.maxX = Math.max(b.maxX, hb.maxX);
        b.minY = Math.min(b.minY, hb.minY); b.maxY = Math.max(b.maxY, hb.maxY);
        tall = Math.max(tall, Math.min(MockPlate.derive(c).height, plate.height));
      });
      // never closer than a 120 mm patch, never wider than the whole plate
      var w = Math.max(120, b.maxX - b.minX + 50), l = Math.max(100, b.maxY - b.minY + 50);
      if (w >= plate.x || l >= plate.y) return viewPlate();
      lookAt((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, w, l, tall);
    }
    viewPlate();

    function copyMaterial(def) {
      return new T.MeshStandardMaterial({ color: def.color, roughness: 0.6, metalness: 0.05, flatShading: true });
    }

    function placeMesh(copy) {
      var m = meshes[copy.id], d = MockPlate.derive(copy);
      m.quaternion.copy(copy.q);
      m.position.set(copy.x - d.offset[0], copy.y - d.offset[1], -d.offset[2]);
    }

    // Bring the meshes in line with the copies: add, remove, move and colour.
    function sync() {
      var copies = opts.getCopies(), live = {};
      copies.forEach(function (c) {
        live[c.id] = true;
        if (!meshes[c.id]) {
          var def = MockParts.byKey[c.partKey];
          var m = new T.Mesh(def.geometry, copyMaterial(def));
          m.userData.copyId = c.id;
          meshes[c.id] = m; scene.add(m);
        }
        placeMesh(c);
        var m2 = meshes[c.id], bad = opts.isBad(c.id), sel = opts.isSelected(c.id);
        var base = new T.Color(MockParts.byKey[c.partKey].color);
        if (layMode) base.multiplyScalar(0.4);            // dim the copies so the face patches stand out
        m2.material.color.copy(bad && !layMode ? new T.Color(COL.danger) : base);
        m2.material.emissive = new T.Color(sel ? (bad ? 0x3a0000 : 0x0b2a5c) : 0x000000);
      });
      Object.keys(meshes).forEach(function (id) {
        if (!live[id]) { scene.remove(meshes[id]); meshes[id].material.dispose(); delete meshes[id]; }
      });
      clearFace();
      if (layMode && patches.length !== Object.keys(meshes).length) showPatches();
      invalidate();
    }

    function selectedCopies() { return opts.getCopies().filter(function (c) { return opts.isSelected(c.id); }); }
    function selectionBox() {
      var sel = selectedCopies(); if (!sel.length) return null;
      var b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, maxZ: 0 };
      sel.forEach(function (c) {
        var hb = MockPlate.bbox(MockPlate.worldHull(c));
        b.minX = Math.min(b.minX, hb.minX); b.maxX = Math.max(b.maxX, hb.maxX);
        b.minY = Math.min(b.minY, hb.minY); b.maxY = Math.max(b.maxY, hb.maxY);
      });
      b.cx = (b.minX + b.maxX) / 2; b.cy = (b.minY + b.maxY) / 2;
      return b;
    }
    function placeHandle() {
      var b = selectionBox();
      handle.visible = stem.visible = selBox.visible = !!b && !layMode;
      if (!b) return;
      var dist = camera.position.distanceTo(new T.Vector3(b.cx, b.cy, 0));
      var px = dist * Math.tan(camera.fov * Math.PI / 360) * 2 / Math.max(1, container.clientHeight);
      var r = 7 * px;                                        // about 7 px on screen
      var reach = Math.abs(handleDir.x) * (b.maxX - b.minX) / 2 + Math.abs(handleDir.y) * (b.maxY - b.minY) / 2;
      var edge = new T.Vector3(b.cx + handleDir.x * reach, b.cy + handleDir.y * reach, 0.4);
      var end = new T.Vector3(b.cx + handleDir.x * (reach + 28 * px), b.cy + handleDir.y * (reach + 28 * px), 0.4);
      handle.position.copy(end); handle.scale.setScalar(r);
      var sp = stem.geometry.attributes.position;
      sp.setXYZ(0, edge.x, edge.y, edge.z); sp.setXYZ(1, end.x, end.y, end.z); sp.needsUpdate = true;
      stem.geometry.computeBoundingSphere();
      var z = 0.3, pts = [b.minX, b.minY, z, b.maxX, b.minY, z, b.maxX, b.minY, z, b.maxX, b.maxY, z,
        b.maxX, b.maxY, z, b.minX, b.maxY, z, b.minX, b.maxY, z, b.minX, b.minY, z];
      selBox.geometry.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
      selBox.computeLineDistances();
    }

    function setNdc(e) {
      var r = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
    }
    function hitCopy() {
      var list = Object.keys(meshes).map(function (k) { return meshes[k]; });
      var hits = raycaster.intersectObjects(list, false);
      return hits.length ? hits[0] : null;
    }
    // A press that goes through a hole or a notch of a copy (a pulley's bore, the inside of
    // an L) misses its mesh. It still means that copy: take the copy whose outline on the
    // plate the pointer is over, at the plate, half way up or at its top.
    function hitOutline() {
      var copies = opts.getCopies(), best = null;
      for (var i = 0; i < copies.length; i++) {
        var c = copies[i], h = MockPlate.derive(c).height, hull = MockPlate.worldHull(c);
        var zs = [0, h / 2, h];
        for (var k = 0; k < zs.length; k++) {
          var p = planePoint(zs[k]);
          if (p && MockPlate.inside([p.x, p.y], hull)) {
            var dist = p.distanceTo(camera.position);
            if (!best || dist < best.dist) best = { id: c.id, dist: dist, z: zs[k] };
            break;
          }
        }
      }
      return best;
    }
    function hitHandle() {
      if (!handle.visible) return false;
      return raycaster.intersectObject(disc, false).length > 0 || raycaster.intersectObject(ring, false).length > 0;
    }
    function planePoint(z) {
      var p = new T.Vector3();
      return raycaster.ray.intersectPlane(new T.Plane(new T.Vector3(0, 0, 1), -z), p) ? p : null;
    }
    function copyById(id) { return opts.getCopies().filter(function (c) { return c.id === id; })[0]; }

    function clearFace() {
      if (faceOverlay) { faceOverlay.parent && faceOverlay.parent.remove(faceOverlay); faceOverlay.geometry.dispose(); faceOverlay = null; }
    }
    // With the Lay on face tool on, every face a copy can lie on is marked with a pale
    // patch, as Orca's Place on face does, so the student sees the choices without hunting.
    var patches = [];
    function clearPatches() {
      patches.forEach(function (p) { p.parent && p.parent.remove(p); p.geometry.dispose(); });
      patches = [];
    }
    function showPatches() {
      clearPatches();
      if (!layMode) return;
      var mat = new T.MeshBasicMaterial({ color: 0xbcd9ff, transparent: true, opacity: 0.6, side: T.DoubleSide, depthWrite: false });
      Object.keys(meshes).forEach(function (id) {
        var copy = copyById(id); if (!copy) return;
        var def = MockParts.byKey[copy.partKey], p = def.geometry.attributes.position.array, arr = [];
        def.faces.forEach(function (f) {
          if (!f.flat) return;
          f.tris.forEach(function (t) {
            for (var k = 0; k < 9; k += 3) arr.push(p[t * 9 + k] + f.n.x * 0.1, p[t * 9 + k + 1] + f.n.y * 0.1, p[t * 9 + k + 2] + f.n.z * 0.1);
          });
        });
        if (!arr.length) return;
        var g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(arr, 3));
        var m = new T.Mesh(g, mat); m.raycast = function () {};
        meshes[id].add(m); patches.push(m);
      });
    }
    // Lay a copy down on the face under a hit; says why not when the face cannot be stood on.
    function layOn(hit) {
      var copy = copyById(hit.object.userData.copyId), def = MockParts.byKey[copy.partKey];
      var fi = def.triFace[hit.faceIndex], f = fi >= 0 ? def.faces[fi] : null;
      if (!f || !f.flat) {
        opts.hint(opts.labelFor(copy.id) + ' cannot lie on that surface: ' + (f && f.onHull ? 'it is curved or too small to stand on' : 'another piece of the part sticks out past it') + '. Choose ' + (layMode ? 'one of the pale faces.' : 'a flat face on the outside; Lay on face shows them all.'));
        return false;
      }
      var n = f.n.clone().applyQuaternion(copy.q).normalize();
      if (n.z < -0.999) { opts.hint(opts.labelFor(copy.id) + ' already lies on that face.'); return false; }
      var r = new T.Quaternion().setFromUnitVectors(n, new T.Vector3(0, 0, -1));
      copy.q = r.multiply(copy.q); copy.d = null;
      opts.select(copy.id, 'only');
      opts.changed('lay', copy);
      return true;
    }
    function showFace(hit) {
      clearFace();
      var copy = copyById(hit.object.userData.copyId), def = MockParts.byKey[copy.partKey];
      var fi = def.triFace[hit.faceIndex];
      if (fi < 0) return null;
      var f = def.faces[fi], p = def.geometry.attributes.position.array, arr = new Float32Array(f.tris.length * 9);
      f.tris.forEach(function (t, i) {
        for (var k = 0; k < 9; k += 3) {
          arr[i * 9 + k] = p[t * 9 + k] + f.n.x * 0.15; arr[i * 9 + k + 1] = p[t * 9 + k + 1] + f.n.y * 0.15; arr[i * 9 + k + 2] = p[t * 9 + k + 2] + f.n.z * 0.15;
        }
      });
      var g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(arr, 3));
      faceOverlay = new T.Mesh(g, new T.MeshBasicMaterial({ color: f.flat ? COL.face : COL.danger, transparent: true, opacity: 0.92, side: T.DoubleSide, depthTest: true }));
      hit.object.add(faceOverlay);
      invalidate();
      return f;
    }

    function onDown(e) {
      if (e.button !== 0 || e.shiftKey && !hitCopyAt(e)) return;     // Shift-drag on empty space pans
      setNdc(e);
      canvas.focus();
      if (!layMode && hitHandle()) {
        controls.enabled = false;
        var b = selectionBox(), p0 = planePoint(0.4);
        drag = { type: 'rotate', pivot: new T.Vector2(b.cx, b.cy), a0: Math.atan2(p0.y - b.cy, p0.x - b.cx),
                 snap: selectedCopies().map(function (c) { return { c: c, x: c.x, y: c.y, q: c.q.clone() }; }), moved: false, sx: e.clientX, sy: e.clientY };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      var hit = hitCopy(), near = hit || layMode ? null : hitOutline();
      if (!hit && !near) { drag = { type: 'empty', sx: e.clientX, sy: e.clientY, shift: e.shiftKey }; return; }
      controls.enabled = false;
      var id = hit ? hit.object.userData.copyId : near.id;
      if (layMode) { drag = { type: 'lay', hit: hit, sx: e.clientX, sy: e.clientY }; canvas.setPointerCapture(e.pointerId); return; }
      if (e.shiftKey) opts.select(id, 'toggle');
      else if (!opts.isSelected(id)) opts.select(id, 'only');
      var z = hit ? hit.point.z : near.z, p = planePoint(z);
      drag = { type: 'move', z: z, p0: p, id: id, sx: e.clientX, sy: e.clientY, moved: false, shift: e.shiftKey,
               snap: selectedCopies().map(function (c) { return { c: c, x: c.x, y: c.y }; }) };
      canvas.setPointerCapture(e.pointerId);
      sync();
    }
    function hitCopyAt(e) { setNdc(e); return !!hitCopy() || hitHandle() || (!layMode && !!hitOutline()); }

    canvas.addEventListener('pointermove', function (e) {
      setNdc(e);
      if (drag && (drag.type === 'move' || drag.type === 'rotate')) {
        if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3) drag.moved = true;
        if (!drag.moved) return;
        if (drag.type === 'move') {
          var p = planePoint(drag.z); if (!p || !drag.p0) return;
          var dx = p.x - drag.p0.x, dy = p.y - drag.p0.y;
          drag.snap.forEach(function (s) { s.c.x = s.x + dx; s.c.y = s.y + dy; });
        } else {
          var q = planePoint(0.4); if (!q) return;
          var a = Math.atan2(q.y - drag.pivot.y, q.x - drag.pivot.x), deg = (a - drag.a0) * 180 / Math.PI;
          var snapped = Math.round(deg / 45) * 45;
          if (Math.abs(snapped - deg) <= 5) deg = snapped;
          handleDir.set(q.x - drag.pivot.x, q.y - drag.pivot.y).normalize();
          var rad = deg * Math.PI / 180, cs = Math.cos(rad), sn = Math.sin(rad);
          var rz = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), rad);
          drag.snap.forEach(function (s) {
            var vx = s.x - drag.pivot.x, vy = s.y - drag.pivot.y;
            s.c.x = drag.pivot.x + vx * cs - vy * sn; s.c.y = drag.pivot.y + vx * sn + vy * cs;
            s.c.q = rz.clone().multiply(s.q); s.c.d = null;
          });
          drag.deg = deg;
        }
        opts.changed('live');
        return;
      }
      if (drag) return;
      // hover
      var hit = hitCopy(), over = hit || layMode ? null : hitOutline();
      var id = hit ? hit.object.userData.copyId : (over ? over.id : null);
      if (layMode) {
        if (hit) {
          var f = showFace(hit);
          canvas.style.cursor = f && f.flat ? 'pointer' : 'not-allowed';
        } else { clearFace(); canvas.style.cursor = 'default'; invalidate(); }
      } else {
        canvas.style.cursor = hitHandle() ? 'grab' : (id ? 'move' : 'default');
      }
      if (id !== hoverCopy) {
        hoverCopy = id;
        if (id) { hoverTip.textContent = opts.labelFor(id); hoverTip.hidden = false; } else hoverTip.hidden = true;
      }
    });

    canvas.addEventListener('pointerup', function (e) {
      var d = drag; drag = null; controls.enabled = true;
      if (!d) return;
      var still = Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) <= 3;
      if (d.type === 'empty') { if (still && !d.shift) opts.select(null, 'none'); return; }
      if (d.type === 'lay') {
        if (still) layOn(d.hit);
        return;
      }
      if (d.type === 'move' && still && !d.shift) opts.select(d.id, 'only');
      opts.changed(d.moved ? (d.type === 'rotate' ? 'rotate' : 'move') : 'select');
    });
    // A double-click on a flat face lays the copy down on it without the tool. A plain
    // click stays "select", and a drag stays "move", so nothing collides.
    canvas.addEventListener('dblclick', function (e) {
      if (layMode) return;
      setNdc(e);
      var hit = hitCopy();
      if (hit) { e.preventDefault(); layOn(hit); }
    });
    canvas.addEventListener('pointerleave', function () { if (!drag) { hoverTip.hidden = true; hoverCopy = null; if (layMode) { clearFace(); invalidate(); } } });
    canvas.addEventListener('keydown', function (e) {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); opts.onKey('delete'); }
      if (e.key === 'Escape') opts.onKey('escape');
      if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); opts.onKey('all'); }
    });

    function setLayMode(on) {
      layMode = !!on; clearFace();
      canvas.classList.toggle('lay-mode', layMode);
      sync(); showPatches();
      invalidate();
    }
    function resetHandle() { handleDir.set(0, 1); invalidate(); }
    // Whether a copy's middle is comfortably inside the picture (not at its edge or behind
    // the view buttons), so a copy that was just added is never left out of sight.
    function inView(copyId) {
      var c = copyById(copyId); if (!c) return true;
      camera.updateMatrixWorld();
      var p = new T.Vector3(c.x, c.y, MockPlate.derive(c).height / 2).project(camera);
      return Math.abs(p.x) < 0.78 && p.y < 0.82 && p.y > -0.62;
    }

    // For scripted walks: the page position of a copy's centre, or of the middle of its
    // largest flat face that faces the camera.
    container.__screenOf = function (copyId, face) {
      var m = meshes[copyId]; if (!m) return null;
      m.updateMatrixWorld();
      var p = new T.Vector3();
      if (face) {
        var def = MockParts.byKey[copyById(copyId).partKey], best = null, pos = def.geometry.attributes.position.array;
        def.faces.forEach(function (f) {
          if (!f.flat) return;
          var cents = f.tris.map(function (t) { return new T.Vector3(
            (pos[t * 9] + pos[t * 9 + 3] + pos[t * 9 + 6]) / 3, (pos[t * 9 + 1] + pos[t * 9 + 4] + pos[t * 9 + 7]) / 3, (pos[t * 9 + 2] + pos[t * 9 + 5] + pos[t * 9 + 8]) / 3); });
          var mean = new T.Vector3(); cents.forEach(function (v) { mean.add(v); }); mean.divideScalar(cents.length);
          var c = cents.reduce(function (a, v) { return v.distanceTo(mean) < a.distanceTo(mean) ? v : a; });
          var wc = c.clone().applyMatrix4(m.matrixWorld), wn = f.n.clone().applyQuaternion(m.quaternion);
          if (wn.dot(camera.position.clone().sub(wc)) <= 0) return;
          if (!best || f.area > best.area) best = { area: f.area, p: wc };
        });
        if (!best) return null;
        p.copy(best.p);
      } else { var c0 = copyById(copyId); p.set(c0.x, c0.y, MockPlate.derive(c0).height / 2); }
      p.project(camera);
      var r = canvas.getBoundingClientRect();
      return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
    };
    container.__handle = function () {
      if (!handle.visible) return null;
      var p = handle.position.clone().project(camera), r = canvas.getBoundingClientRect();
      return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
    };

    return { sync: sync, resetView: resetView, viewPlate: viewPlate, setLayMode: setLayMode, resize: resize, resetHandle: resetHandle, inView: inView,
             invalidate: invalidate, canvas: canvas, renderer: renderer };
  }

  window.Layout3D = { create: create, lights: lights, makePlate: makePlate };
})();
