/* Penguin Slicer mockup: the Layout step's 3D plate, like Orca's Prepare tab but with no
 * modes: every operation has its own affordance, always on.
 *   select: click a copy; Shift- or Ctrl-click adds or removes; click empty plate clears
 *   move: left drag that starts on a copy (anywhere inside its outline)
 *   turn: drag the round handle beside the selection (snaps every 45 degrees)
 *   lay on a face: double-click a flat face, always; plus one of four ways the scenario strip
 *     picks: the resting-position strip (drawn by wizard.js under the view), face markers
 *     (dots on the selected copy), the box tumbler (a box whose sides are clicked or dragged)
 *     or the tip handle (a second handle that steps to the next resting position)
 *   orbit, pan, zoom: one of three mouse schemes the scenario strip picks (O: Onshape's,
 *     S: slicer's, T: top-down first); in all three the wheel zooms toward the pointer. */
(function () {
  'use strict';
  var T = THREE;
  var COL = { accent: 0x2f81f7, danger: 0xf85149, plate: 0x2f3946, grid: 0x3d4857, grid5: 0x5b6979, face: 0x2f81f7 };
  var DOWN = new T.Vector3(0, 0, -1);

  // Which button does what to the camera, per scheme. OrbitControls swaps ROTATE and PAN
  // when Shift or Ctrl is held, which gives Shift-drag and Ctrl + right drag their pan.
  var SCHEMES = {
    O: { LEFT: 'ROTATE', MIDDLE: 'PAN', RIGHT: 'ROTATE', ONE: 'ROTATE' },
    S: { LEFT: 'ROTATE', MIDDLE: 'DOLLY', RIGHT: 'PAN', ONE: 'ROTATE' },
    T: { LEFT: 'PAN', MIDDLE: 'PAN', RIGHT: 'ROTATE', ONE: 'PAN' }
  };

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
    // Face markers and the tip handle are drawn in HTML over the canvas; the canvas itself
    // hit-tests them by distance, so a press that becomes a drag still moves the copy.
    var overlay = document.createElement('div'); overlay.className = 'gl-overlay'; container.appendChild(overlay);

    // Our pointer and wheel handlers are registered first, in the capture phase, so they
    // can switch the camera controls off before those see a press on a copy or a handle.
    canvas.addEventListener('pointerdown', onDown, true);
    canvas.addEventListener('wheel', onWheel, { capture: true, passive: false });
    var controls = new T.OrbitControls(camera, canvas);
    controls.enableDamping = false;
    controls.rotateSpeed = 0.55;       // the view is small: a full turn per view height is too twitchy
    controls.screenSpacePanning = true;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.addEventListener('change', invalidate);

    var meshes = {};          // copy id -> mesh
    var raycaster = new T.Raycaster(), ndc = new T.Vector2();
    var drag = null, faceOverlay = null, hoverCopy = null, hoverKey = null;
    var scheme = 'O', layOpt = 'strip', tilted = false;

    var handle = new T.Group();
    // The rotation handle is drawn over everything, so a tall copy in front of it (or the
    // copy it belongs to) never hides it.
    var disc = new T.Mesh(new T.CircleGeometry(1, 24), new T.MeshBasicMaterial({ color: COL.accent, depthTest: false, transparent: true }));
    var ring = new T.Mesh(new T.RingGeometry(1.25, 1.6, 32), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false }));
    disc.renderOrder = 10; ring.renderOrder = 10;
    handle.add(disc); handle.add(ring);
    var stemGeo = new T.BufferGeometry(); stemGeo.setAttribute('position', new T.Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3));
    var stem = new T.Line(stemGeo, new T.LineBasicMaterial({ color: COL.accent, depthTest: false, transparent: true }));
    stem.renderOrder = 9;
    var selBox = new T.LineSegments(new T.BufferGeometry(), new T.LineDashedMaterial({ color: COL.accent, dashSize: 3, gapSize: 2 }));
    scene.add(handle); scene.add(stem); scene.add(selBox);
    var handleDir = new T.Vector2(0, 1);

    // The box tumbler: a box around the selected copy, its sides clickable. Six materials so
    // the side under the pointer can be shaded on its own.
    var boxMats = [0, 1, 2, 3, 4, 5].map(function () { return new T.MeshBasicMaterial({ color: COL.accent, transparent: true, opacity: 0, depthWrite: false }); });
    var tumbler = new T.Mesh(new T.BoxGeometry(1, 1, 1), boxMats);
    var tumblerEdges = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(1, 1, 1)), new T.LineBasicMaterial({ color: 0x9cc3ff, transparent: true, opacity: 0.85 }));
    tumbler.add(tumblerEdges); tumbler.visible = false; tumbler.renderOrder = 2;
    var dropLine = new T.LineLoop(new T.BufferGeometry(), new T.LineDashedMaterial({ color: 0x9cc3ff, dashSize: 4, gapSize: 3 }));
    dropLine.visible = false; scene.add(dropLine);
    var hoverSide = -1;

    var needs = true;
    function invalidate() { needs = true; }
    function loop() {
      requestAnimationFrame(loop);
      if (!needs || !container.offsetParent) return;
      needs = false;
      placeOverlays();
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

    /* ------------------------------------------------------------ the camera */
    function fromAbove() { return scheme === 'T' && !tilted; }
    // Look at a rectangle of the plate from the front, a little above, or (Scheme T) from
    // straight above: the whole plate, or just the copies so small parts are large enough.
    function lookAt(cx, cy, w, l, tall, above) {
      var aspect = Math.max(0.5, camera.aspect || 1), half = Math.tan(camera.fov * Math.PI / 360);
      if (above) {
        var fit = Math.max(l + 20, (w + 20) / aspect);
        var d0 = fit / (2 * half) * 1.04;
        controls.target.set(cx, cy, 0);
        camera.position.set(cx, cy - d0 * 0.0005, d0 + tall * 0.5);
      } else {
        controls.target.set(cx, cy, Math.min(tall, 60) / 3);
        var fitH = l * 0.75 + tall * 0.7 + 30, fitW = (w + 30) / aspect;
        var dist = Math.max(fitH, fitW) / (2 * half) * 1.08;
        camera.position.set(cx, cy - dist * 0.5, controls.target.z + dist * 0.866);
      }
      controls.update(); invalidate();
    }
    function copiesBox(list) {
      var b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, tall: 0 };
      list.forEach(function (c) {
        var hb = MockPlate.bbox(MockPlate.worldHull(c));
        b.minX = Math.min(b.minX, hb.minX); b.maxX = Math.max(b.maxX, hb.maxX);
        b.minY = Math.min(b.minY, hb.minY); b.maxY = Math.max(b.maxY, hb.maxY);
        b.tall = Math.max(b.tall, Math.min(MockPlate.derive(c).height, plate.height));
      });
      return b;
    }
    function viewPlate(above) {
      // the whole plate, widened to take in any copy waiting beside it
      var b = copiesBox(opts.getCopies ? opts.getCopies() : []);
      var minX = Math.min(0, b.minX), maxX = Math.max(plate.x, b.maxX), minY = Math.min(0, b.minY), maxY = Math.max(plate.y, b.maxY);
      lookAt((minX + maxX) / 2, (minY + maxY) / 2, maxX - minX + 50, maxY - minY + 30, 0, above === undefined ? fromAbove() : above);
    }
    function resetView() {
      var copies = opts.getCopies ? opts.getCopies() : [];
      if (!copies.length) return viewPlate();
      var b = copiesBox(copies);
      // never closer than a 120 mm patch, never wider than the whole plate
      var w = Math.max(120, b.maxX - b.minX + 50), l = Math.max(100, b.maxY - b.minY + 50);
      if (w >= plate.x || l >= plate.y) return viewPlate();
      lookAt((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, w, l, b.tall, fromAbove());
    }
    // Straight down at what is in view now (the copies, or the plate when there are none).
    function topView() {
      var copies = opts.getCopies ? opts.getCopies() : [];
      if (scheme === 'T') tilted = false;
      if (!copies.length) return viewPlate(true);
      var b = copiesBox(copies), w = Math.max(120, b.maxX - b.minX + 40), l = Math.max(100, b.maxY - b.minY + 40);
      if (w >= plate.x || l >= plate.y) return viewPlate(true);
      lookAt((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, w, l, b.tall, true);
    }
    // Scheme T's "3D" button: tilt the view to the usual three-quarter look, and back.
    function toggleTilt() { tilted = !tilted; resetView(); return tilted; }
    function isTop() { return controls.getPolarAngle() < 0.05; }

    // The wheel zooms toward the point of the plate under the pointer, as Onshape and Orca do.
    function onWheel(e) {
      e.preventDefault(); e.stopImmediatePropagation();
      setNdc(e);
      var p = planePoint(0);
      if (!p || p.distanceTo(camera.position) > 3000) p = controls.target.clone();
      var dist = camera.position.distanceTo(p), s = Math.pow(1.0018, Math.max(-300, Math.min(300, e.deltaY)));
      var nd = Math.min(2600, Math.max(30, dist * s)); s = nd / Math.max(1e-6, dist);
      camera.position.sub(p).multiplyScalar(s).add(p);
      controls.target.sub(p).multiplyScalar(s).add(p);
      controls.update(); invalidate();
    }

    function setScheme(s) {
      scheme = SCHEMES[s] ? s : 'O';
      var m = SCHEMES[scheme];
      controls.mouseButtons = { LEFT: T.MOUSE[m.LEFT], MIDDLE: T.MOUSE[m.MIDDLE], RIGHT: T.MOUSE[m.RIGHT] };
      controls.touches = { ONE: T.TOUCH[m.ONE], TWO: T.TOUCH.DOLLY_PAN };
      tilted = false;
      resetView();
    }
    function setLayOption(o) { layOpt = o; hoverSide = -1; clearFace(); invalidate(); }

    /* ------------------------------------------------------------ copies */
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
        m2.material.color.copy(bad ? new T.Color(COL.danger) : new T.Color(MockParts.byKey[c.partKey].color));
        m2.material.emissive = new T.Color(sel ? (bad ? 0x3a0000 : 0x0b2a5c) : 0x000000);
      });
      Object.keys(meshes).forEach(function (id) {
        if (!live[id]) { if (tumbler.parent === meshes[id]) meshes[id].remove(tumbler); scene.remove(meshes[id]); meshes[id].material.dispose(); delete meshes[id]; }
      });
      clearFace();
      invalidate();
    }

    function selectedCopies() { return opts.getCopies().filter(function (c) { return opts.isSelected(c.id); }); }
    function oneSelected() { var s = selectedCopies(); return s.length === 1 ? s[0] : null; }
    function selectionBox() {
      var sel = selectedCopies(); if (!sel.length) return null;
      var b = copiesBox(sel);
      b.cx = (b.minX + b.maxX) / 2; b.cy = (b.minY + b.maxY) / 2;
      return b;
    }
    function toPx(v) {
      var p = v.clone().project(camera);
      return { x: (p.x + 1) / 2 * container.clientWidth, y: (1 - p.y) / 2 * container.clientHeight, behind: p.z > 1 };
    }
    var dots = [], tipAt = null;      // where the face markers and the tip handle are, in container px
    function placeHandle() {
      var b = selectionBox();
      handle.visible = stem.visible = selBox.visible = !!b;
      if (!b) return null;
      var dist = camera.position.distanceTo(new T.Vector3(b.cx, b.cy, 0));
      var px = dist * Math.tan(camera.fov * Math.PI / 360) * 2 / Math.max(1, container.clientHeight);
      var r = 7 * px;                                        // about 7 px on screen
      var reach = Math.abs(handleDir.x) * (b.maxX - b.minX) / 2 + Math.abs(handleDir.y) * (b.maxY - b.minY) / 2;
      var edge = new T.Vector3(b.cx + handleDir.x * reach, b.cy + handleDir.y * reach, 0.4);
      var end = new T.Vector3(b.cx + handleDir.x * (reach + 28 * px), b.cy + handleDir.y * (reach + 28 * px), 0.4);
      handle.position.copy(end); handle.scale.setScalar(r);
      handle.quaternion.identity();
      var sp = stem.geometry.attributes.position;
      sp.setXYZ(0, edge.x, edge.y, edge.z); sp.setXYZ(1, end.x, end.y, end.z); sp.needsUpdate = true;
      stem.geometry.computeBoundingSphere();
      var z = 0.3, pts = [b.minX, b.minY, z, b.maxX, b.minY, z, b.maxX, b.minY, z, b.maxX, b.maxY, z,
        b.maxX, b.maxY, z, b.minX, b.maxY, z, b.minX, b.maxY, z, b.minX, b.minY, z];
      selBox.geometry.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
      selBox.computeLineDistances();
      return { edge: toPx(edge), end: toPx(end) };
    }
    // Everything drawn around the selection, redrawn whenever the picture is.
    function placeOverlays() {
      var hp = placeHandle();
      overlay.innerHTML = ''; dots = []; tipAt = null;
      var moving = drag && (drag.type === 'move' || drag.type === 'rotate') && drag.moved;
      // the tip handle: beside the rotation handle, square to its stem
      if (layOpt === 'tip' && hp && !moving) {
        var dx = hp.end.x - hp.edge.x, dy = hp.end.y - hp.edge.y, L = Math.sqrt(dx * dx + dy * dy) || 1;
        tipAt = { x: hp.end.x - dy / L * 26, y: hp.end.y + dx / L * 26 };
        var t = document.createElement('span'); t.className = 'tip-handle' + (hoverKey === 'tip' ? ' hover' : ''); t.textContent = '⤵';
        t.style.left = tipAt.x + 'px'; t.style.top = tipAt.y + 'px'; overlay.appendChild(t);
      }
      // face markers: one dot per resting position on the one selected copy, on the faces
      // that face the camera; the face it lies on now has none
      var one = oneSelected();
      if (layOpt === 'markers' && one && !moving && meshes[one.id]) {
        var m = meshes[one.id]; m.updateMatrixWorld();
        var def = MockParts.byKey[one.partKey], R = MockParts.resting(one.partKey), cur = MockParts.restIndex(one.partKey, one.q);
        R.list.forEach(function (cand, i) {
          if (i === cur || cand.face < 0) return;
          var f = def.faces[cand.face];
          var wn = f.n.clone().applyQuaternion(m.quaternion), wc = f.centre.clone().applyMatrix4(m.matrixWorld).addScaledVector(wn, 0.4);
          if (wn.dot(camera.position.clone().sub(wc)) <= 0) return;
          var s = toPx(wc); if (s.behind) return;
          dots.push({ x: s.x, y: s.y, cand: i, face: cand.face, copy: one });
          var dEl = document.createElement('span'); dEl.className = 'face-dot' + (i === 0 ? ' best' : '') + (hoverKey === 'dot' + i ? ' hover' : '');
          dEl.textContent = '↓';
          dEl.style.left = s.x + 'px'; dEl.style.top = s.y + 'px'; overlay.appendChild(dEl);
        });
      }
      // the box tumbler
      if (layOpt === 'box' && one && !moving && meshes[one.id]) {
        var mm = meshes[one.id], sz = MockParts.byKey[one.partKey].size;
        if (tumbler.parent !== mm) mm.add(tumbler);
        tumbler.scale.set(sz.x + 2, sz.y + 2, sz.z + 2); tumbler.visible = true;
        boxMats.forEach(function (bm, i) { bm.opacity = i === hoverSide ? 0.32 : 0.0; });
        showDrop(one, hoverSide);
      } else { tumbler.visible = false; dropLine.visible = false; }
    }

    function setNdc(e) {
      var r = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
    }
    function localPx(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
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
    function hitTip(px) { return tipAt && Math.abs(px.x - tipAt.x) <= 13 && Math.abs(px.y - tipAt.y) <= 13; }
    function hitDot(px) {
      var best = null;
      dots.forEach(function (d) { var r = Math.hypot(px.x - d.x, px.y - d.y); if (r <= 14 && (!best || r < best.r)) best = { r: r, d: d }; });
      return best ? best.d : null;
    }
    // the box side under the pointer: 0..5 (+x, -x, +y, -y, +z, -z of the part as modelled)
    function hitSide() {
      if (!tumbler.visible) return -1;
      var h = raycaster.intersectObject(tumbler, false)[0];
      return h ? h.face.materialIndex : -1;
    }
    var SIDE_N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    function sideWorld(copy, i) { return new T.Vector3().fromArray(SIDE_N[i]).applyQuaternion(copy.q); }
    // The outline the copy would stand on with that side down, drawn dashed on the plate.
    function showDrop(copy, i) {
      if (i < 0) { dropLine.visible = false; return; }
      var sz = MockParts.byKey[copy.partKey].size, dims = [sz.x, sz.y, sz.z], k = Math.floor(i / 2);
      var r = new T.Quaternion().setFromUnitVectors(sideWorld(copy, i), DOWN).multiply(copy.q);
      var ax = [0, 1, 2].filter(function (a) { return a !== k; }).map(function (a) {
        var v = new T.Vector3(); v.setComponent(a, dims[a] / 2); return v.applyQuaternion(r);
      });
      var c = new T.Vector3(copy.x, copy.y, 0.35), pts = [];
      [[1, 1], [-1, 1], [-1, -1], [1, -1]].forEach(function (s) {
        var p = c.clone().addScaledVector(ax[0], s[0]).addScaledVector(ax[1], s[1]); p.z = 0.35; pts.push(p.x, p.y, p.z);
      });
      dropLine.geometry.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
      dropLine.computeLineDistances(); dropLine.visible = true;
    }
    function planePoint(z) {
      var p = new T.Vector3();
      return raycaster.ray.intersectPlane(new T.Plane(new T.Vector3(0, 0, 1), -z), p) ? p : null;
    }
    function copyById(id) { return opts.getCopies().filter(function (c) { return c.id === id; })[0]; }

    function clearFace() {
      if (faceOverlay) { faceOverlay.parent && faceOverlay.parent.remove(faceOverlay); faceOverlay.geometry.dispose(); faceOverlay = null; }
    }
    // Shade one face of a copy: the face under a double-click target, or a face marker's face.
    function showFaceOf(copyId, fi) {
      clearFace();
      var copy = copyById(copyId); if (!copy || fi < 0) return null;
      var def = MockParts.byKey[copy.partKey], f = def.faces[fi], p = def.geometry.attributes.position.array, arr = new Float32Array(f.tris.length * 9);
      f.tris.forEach(function (t, i) {
        for (var k = 0; k < 9; k += 3) {
          arr[i * 9 + k] = p[t * 9 + k] + f.n.x * 0.15; arr[i * 9 + k + 1] = p[t * 9 + k + 1] + f.n.y * 0.15; arr[i * 9 + k + 2] = p[t * 9 + k + 2] + f.n.z * 0.15;
        }
      });
      var g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(arr, 3));
      faceOverlay = new T.Mesh(g, new T.MeshBasicMaterial({ color: f.flat ? COL.face : COL.danger, transparent: true, opacity: 0.85, side: T.DoubleSide }));
      meshes[copyId].add(faceOverlay);
      invalidate();
      return f;
    }

    /* ------------------------------------------------------------ laying a copy down */
    // Turn a copy so that a direction (in the world) points straight down, keeping the rest of
    // its orientation; the wizard then checks the plate, moves the copy if it must, and says so.
    function layWorld(copy, wn, what) {
      wn = wn.clone().normalize();
      if (wn.z < -0.999) { opts.hint(opts.labelFor(copy.id) + ' already lies on that ' + (what || 'face') + '.'); return false; }
      opts.begin();
      copy.q = new T.Quaternion().setFromUnitVectors(wn, DOWN).multiply(copy.q); copy.d = null; copy.auto = false;
      opts.select(copy.id, 'only');
      opts.changed('lay', copy);
      return true;
    }
    // Double-click on a face: lays the copy down on it, or says why not.
    function layOnHit(hit) {
      var copy = copyById(hit.object.userData.copyId), def = MockParts.byKey[copy.partKey];
      var fi = def.triFace[hit.faceIndex], f = fi >= 0 ? def.faces[fi] : null;
      if (!f || !f.flat) {
        opts.hint(opts.labelFor(copy.id) + ' cannot lie on that surface: ' + (f && f.onHull ? 'it is curved or too small to stand on' : 'another piece of the part sticks out past it') + '. Choose a flat face on the outside.');
        return false;
      }
      return layWorld(copy, f.n.clone().applyQuaternion(copy.q));
    }
    function layOnCandidate(copy, candIdx) {
      var cand = MockParts.resting(copy.partKey).list[candIdx];
      return layWorld(copy, cand.n.clone().applyQuaternion(copy.q));
    }

    /* ------------------------------------------------------------ pointer */
    function onDown(e) {
      if (e.button !== 0) return;                     // the middle and right buttons belong to the camera
      var mod = e.shiftKey || e.ctrlKey || e.metaKey;
      setNdc(e); var px = localPx(e);
      canvas.focus();
      var base = { sx: e.clientX, sy: e.clientY, moved: false, mod: mod };
      function take(d) { e.preventDefault(); controls.enabled = false; drag = Object.assign(base, d); canvas.setPointerCapture(e.pointerId); }
      if (hitHandle()) {
        var b = selectionBox(), p0 = planePoint(0.4);
        opts.begin();
        take({ type: 'rotate', pivot: new T.Vector2(b.cx, b.cy), a0: Math.atan2(p0.y - b.cy, p0.x - b.cx),
               snap: selectedCopies().map(function (c) { return { c: c, x: c.x, y: c.y, q: c.q.clone() }; }) });
        return;
      }
      if (hitTip(px)) { take({ type: 'tip', back: e.shiftKey }); return; }
      var dot = hitDot(px), hit = hitCopy();
      if (dot) { take(moveFrom(dot.copy.id, MockPlate.derive(dot.copy).height / 2, false)); drag.dot = dot; return; }
      var side = hit ? -1 : hitSide();
      if (side >= 0) { take({ type: 'box', side: side, p0: planePoint(0), copy: oneSelected() }); return; }
      var near = hit ? null : hitOutline();
      if (!hit && !near) { drag = Object.assign(base, { type: 'empty' }); return; }   // the camera controls take it
      var id = hit ? hit.object.userData.copyId : near.id;
      if (mod) opts.select(id, 'toggle');
      else if (!opts.isSelected(id)) opts.select(id, 'only');
      take(moveFrom(id, hit ? hit.point.z : near.z, true));
      sync();
    }
    function moveFrom(id, z, begun) {
      opts.begin();
      return { type: 'move', z: z, p0: planePoint(z), id: id,
               snap: selectedCopies().map(function (c) { return { c: c, x: c.x, y: c.y }; }) };
    }

    canvas.addEventListener('pointermove', function (e) {
      setNdc(e);
      var px = localPx(e);
      if (drag && drag.type !== 'empty') {
        if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) drag.moved = true;
        if (!drag.moved) return;
        if (drag.type === 'move') {
          var p = planePoint(drag.z); if (!p || !drag.p0) return;
          var dx = p.x - drag.p0.x, dy = p.y - drag.p0.y;
          drag.snap.forEach(function (s) { s.c.x = s.x + dx; s.c.y = s.y + dy; });
          opts.changed('live');
        } else if (drag.type === 'rotate') {
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
          opts.changed('live');
        } else if (drag.type === 'box') {
          var side = rollSide(drag);
          if (side !== hoverSide) { hoverSide = side; invalidate(); }
          hoverTip.textContent = side >= 0 ? 'Let go to roll it this way' : ''; hoverTip.hidden = side < 0;
        }
        return;
      }
      if (drag) return;
      hover(px);
    });
    // Which vertical side of the box a drag across the plate rolls the copy onto.
    function rollSide(d) {
      var p = planePoint(0); if (!p || !d.p0 || !d.copy) return -1;
      var mv = new T.Vector2(p.x - d.p0.x, p.y - d.p0.y); if (mv.length() < 2) return -1;
      mv.normalize();
      var best = -1, bestDot = 0.5;
      for (var i = 0; i < 6; i++) {
        var w = sideWorld(d.copy, i); if (Math.abs(w.z) > 0.7) continue;
        var h = new T.Vector2(w.x, w.y).normalize(), dt = h.dot(mv);
        if (dt > bestDot) { bestDot = dt; best = i; }
      }
      return best;
    }

    function hover(px) {
      var key = null, cursor = 'default', tip = null;
      var dot = hitDot(px), hit = hitCopy();
      if (hitHandle()) { key = 'handle'; cursor = 'grab'; tip = 'Drag to turn'; }
      else if (hitTip(px)) { key = 'tip'; cursor = 'pointer'; tip = 'Tip onto its next side (Shift: the one before)'; }
      else if (dot) {
        key = 'dot' + dot.cand; cursor = 'pointer';
        var cand = MockParts.resting(dot.copy.partKey).list[dot.cand];
        tip = 'Lay it on this face: ' + Math.round(cand.height) + ' mm tall' + (dot.cand === 0 ? ', the best way' : '') + (cand.supports ? ', with overhangs' : '');
      } else {
        var side = hit ? -1 : hitSide();
        if (side !== hoverSide) { hoverSide = side; invalidate(); }
        if (side >= 0) {
          key = 'side' + side; cursor = 'pointer';
          var one = oneSelected(), sz = MockParts.byKey[one.partKey].size;
          tip = 'Put this side down: ' + Math.round([sz.x, sz.y, sz.z][Math.floor(side / 2)]) + ' mm tall';
        } else {
          var over = hit ? null : hitOutline(), id = hit ? hit.object.userData.copyId : (over ? over.id : null);
          if (id) { key = 'copy:' + id; cursor = 'move'; tip = opts.labelFor(id); }
        }
      }
      if (key && key.indexOf('dot') === 0) { if (hoverKey !== key) showFaceOf(dot.copy.id, dot.face); }
      else if (hoverKey && hoverKey.indexOf('dot') === 0) { clearFace(); }
      canvas.style.cursor = cursor;
      if (key !== hoverKey) {
        hoverKey = key; invalidate();
        if (tip) { hoverTip.textContent = tip; hoverTip.hidden = false; } else hoverTip.hidden = true;
      }
      hoverCopy = key && key.indexOf('copy:') === 0 ? key.slice(5) : null;
    }

    canvas.addEventListener('pointerup', function (e) {
      var d = drag; drag = null; controls.enabled = true;
      if (!d) return;
      var still = !d.moved && Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) <= 4;
      if (d.type === 'empty') { if (still && !d.mod) opts.select(null, 'none'); return; }
      if (d.type === 'tip') { if (still) opts.tip(d.back); return; }
      if (d.type === 'box') {
        var side = still ? d.side : rollSide(d);
        hoverSide = -1; hoverTip.hidden = true;
        if (side >= 0 && d.copy) layWorld(d.copy, sideWorld(d.copy, side), 'side');
        invalidate();
        return;
      }
      if (d.type === 'move' && d.dot && still) { clearFace(); hoverKey = null; hoverTip.hidden = true; layOnCandidate(d.dot.copy, d.dot.cand); return; }
      if (d.type === 'move' && still && !d.mod) opts.select(d.id, 'only');
      opts.changed(d.moved ? (d.type === 'rotate' ? 'rotate' : 'move') : 'select');
    });
    // A double-click on a flat face lays the copy down on it, whichever way is chosen. A plain
    // click stays "select" and a drag stays "move", so nothing collides.
    canvas.addEventListener('dblclick', function (e) {
      setNdc(e);
      var hit = hitCopy();
      if (hit) { e.preventDefault(); layOnHit(hit); }
    });
    canvas.addEventListener('pointerleave', function () {
      if (drag) return;
      hoverTip.hidden = true; hoverCopy = null; hoverKey = null;
      if (hoverSide >= 0) { hoverSide = -1; }
      clearFace(); invalidate();
    });
    canvas.addEventListener('keydown', function (e) {
      var k = e.key, mod = e.ctrlKey || e.metaKey;
      function go(name) { e.preventDefault(); opts.onKey(name); }
      if (k === 'Delete' || k === 'Backspace') return go('delete');
      if (k === 'Escape') return opts.onKey('escape');
      if (mod && (k === 'a' || k === 'A')) return go('all');
      if (mod && (k === 'z' || k === 'Z')) return go(e.shiftKey ? 'redo' : 'undo');
      if (mod && (k === 'y' || k === 'Y')) return go('redo');
      if (mod && (k === 'd' || k === 'D')) return go('duplicate');
      if (mod && k === '1') return go('top');
      if (!mod && (k === 'f' || k === 'F')) return go('fit');
    });

    function resetHandle() { handleDir.set(0, 1); invalidate(); }
    // Whether a copy's middle is comfortably inside the picture (not at its edge or behind
    // the view buttons), so a copy that was just added is never left out of sight.
    function inView(copyId) {
      var c = copyById(copyId); if (!c) return true;
      camera.updateMatrixWorld();
      var p = new T.Vector3(c.x, c.y, MockPlate.derive(c).height / 2).project(camera);
      return Math.abs(p.x) < 0.78 && p.y < 0.82 && p.y > -0.62;
    }

    /* ------------------------------------------------------------ for scripted walks */
    // Page positions of things to point at: a copy's centre or its largest flat face facing
    // the camera, the rotation handle, the tip handle, the face markers, and a box side.
    function pagePx(v) { var r = canvas.getBoundingClientRect(), s = toPx(v); return { x: r.left + s.x, y: r.top + s.y }; }
    container.__screenOf = function (copyId, face) {
      var m = meshes[copyId]; if (!m) return null;
      m.updateMatrixWorld();
      var p = new T.Vector3();
      if (face) {
        var def = MockParts.byKey[copyById(copyId).partKey], best = null;
        def.faces.forEach(function (f) {
          if (!f.flat) return;
          var wc = f.centre.clone().applyMatrix4(m.matrixWorld), wn = f.n.clone().applyQuaternion(m.quaternion);
          var facing = wn.dot(camera.position.clone().sub(wc).normalize());
          if (facing <= 0.25 || wn.z < -0.99) return;               // not edge-on: easy to hit
          if (!best || f.area * facing > best.area) best = { area: f.area * facing, p: wc };
        });
        if (!best) return null;
        p.copy(best.p);
      } else { var c0 = copyById(copyId); p.set(c0.x, c0.y, MockPlate.derive(c0).height / 2); }
      return pagePx(p);
    };
    // what a press at a page position would take: { copy, face, flat } or null
    container.__hitAt = function (x, y) {
      setNdc({ clientX: x, clientY: y });
      var h = hitCopy(); if (!h) return null;
      var c = copyById(h.object.userData.copyId), def = MockParts.byKey[c.partKey], fi = def.triFace[h.faceIndex];
      return { copy: c.id, face: fi, flat: fi >= 0 && def.faces[fi].flat, normal: fi >= 0 ? def.faces[fi].n.clone().applyQuaternion(c.q).toArray().map(function (v) { return +v.toFixed(2); }) : null };
    };
    container.__camera = function () {
      var r = function (v) { return v.toArray().map(function (x) { return +x.toFixed(1); }); };
      return { pos: r(camera.position), target: r(controls.target), polar: +controls.getPolarAngle().toFixed(3), azimuth: +controls.getAzimuthalAngle().toFixed(3),
               dist: +camera.position.distanceTo(controls.target).toFixed(1) };
    };
    container.__handle = function () { return handle.visible ? pagePx(handle.position) : null; };
    container.__tip = function () { var r = canvas.getBoundingClientRect(); return tipAt ? { x: r.left + tipAt.x, y: r.top + tipAt.y } : null; };
    container.__dots = function () { var r = canvas.getBoundingClientRect(); return dots.map(function (d) { return { x: r.left + d.x, y: r.top + d.y, cand: d.cand }; }); };
    // a point on a visible box side that is not covered by the part, or null
    container.__boxSide = function () {
      if (!tumbler.visible) return null;
      var r = canvas.getBoundingClientRect();
      for (var gy = 0.1; gy < 0.95; gy += 0.04) for (var gx = 0.05; gx < 0.95; gx += 0.04) {
        ndc.set(gx * 2 - 1, -(gy * 2 - 1)); raycaster.setFromCamera(ndc, camera);
        if (hitCopy()) continue;
        var s = hitSide(); if (s >= 0 && s !== 5) return { x: r.left + gx * r.width, y: r.top + gy * r.height, side: s };
      }
      return null;
    };

    return { sync: sync, resetView: resetView, viewPlate: viewPlate, topView: topView, toggleTilt: toggleTilt, isTop: isTop,
             setScheme: setScheme, setLayOption: setLayOption, resize: resize, resetHandle: resetHandle, inView: inView,
             invalidate: invalidate, canvas: canvas, renderer: renderer };
  }

  window.Layout3D = { create: create, lights: lights, makePlate: makePlate };
})();
