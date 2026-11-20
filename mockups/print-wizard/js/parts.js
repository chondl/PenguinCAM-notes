/* Penguin Slicer mockup: the mock document's parts, generated as three.js geometry in
 * millimetres (Z up, as Onshape exports). No STL files. Each part is built once, centred on
 * its bounding box, and analysed for flat faces (for Lay on face), volume and size. */
(function () {
  'use strict';
  var T = THREE;

  /* ------------------------------------------------------------ helpers */
  function circlePath(cx, cy, r, seg) {
    var p = new T.Path();
    p.absarc(cx, cy, r, 0, Math.PI * 2, true);
    return p;
  }
  function polyPath(points) {
    var p = new T.Path();
    points.forEach(function (pt, i) { if (i) p.lineTo(pt[0], pt[1]); else p.moveTo(pt[0], pt[1]); });
    p.closePath();
    return p;
  }
  function polyShape(points) {
    var s = new T.Shape();
    points.forEach(function (pt, i) { if (i) s.lineTo(pt[0], pt[1]); else s.moveTo(pt[0], pt[1]); });
    s.closePath();
    return s;
  }
  function hexPoints(cx, cy, acrossFlats, rot) {
    var r = acrossFlats / Math.sqrt(3), out = [];
    for (var i = 0; i < 6; i++) {
      var a = (rot || 0) + i * Math.PI / 3;
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return out;
  }
  function extrude(shape, depth, seg) {
    var g = new T.ExtrudeGeometry(shape, { depth: depth, bevelEnabled: false, curveSegments: seg || 24 });
    return g.index ? g.toNonIndexed() : g;
  }
  // local (x, y, z) -> world (z, x, y): a plate drawn in XY stands up facing +X.
  var STAND_X = new T.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);
  // local (x, y, z) -> world (x, z, y) mirrored to stay right-handed: plate faces +Y.
  var STAND_Y = new T.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);

  function merge(geoms) {
    var total = 0;
    geoms.forEach(function (g) { total += g.attributes.position.count; });
    var arr = new Float32Array(total * 3), off = 0;
    geoms.forEach(function (g) { arr.set(g.attributes.position.array, off); off += g.attributes.position.array.length; });
    var out = new T.BufferGeometry();
    out.setAttribute('position', new T.BufferAttribute(arr, 3));
    return out;
  }
  function finish(g) {
    g.computeBoundingBox();
    var c = new T.Vector3();
    g.boundingBox.getCenter(c);
    g.translate(-c.x, -c.y, -c.z);
    g.computeBoundingBox();
    g.computeVertexNormals();
    return g;
  }

  /* ------------------------------------------------------------ the parts */
  function lBracket() {
    var base = new T.Shape(); base.moveTo(0, 0); base.lineTo(60, 0); base.lineTo(60, 30); base.lineTo(0, 30); base.closePath();
    base.holes.push(circlePath(25, 15, 2.6)); base.holes.push(circlePath(48, 15, 2.6));
    var b = extrude(base, 5);
    var up = new T.Shape(); up.moveTo(0, 5); up.lineTo(30, 5); up.lineTo(30, 40); up.lineTo(0, 40); up.closePath();
    up.holes.push(circlePath(15, 26, 2.6));
    var u = extrude(up, 5); u.applyMatrix4(STAND_X);
    return finish(merge([b, u]));
  }

  function pulley() {
    var teeth = 24, rRoot = 17.0, depth = 1.9, pts = [], n = teeth * 8;
    for (var i = 0; i < n; i++) {
      var a = i / n * Math.PI * 2, ph = (i % 8) / 8;
      var bump = Math.max(0, Math.cos((ph - 0.5) * Math.PI * 1.6));
      var r = rRoot + depth * bump;
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    var hex = hexPoints(0, 0, 12.7, 0);
    var body = polyShape(pts); body.holes.push(polyPath(hex.slice().reverse()));
    var g1 = extrude(body, 15); g1.translate(0, 0, 1.5);
    function flange(z) {
      var s = new T.Shape(); s.absarc(0, 0, 22, 0, Math.PI * 2, false);
      s.holes.push(polyPath(hex.slice().reverse()));
      var g = extrude(s, 1.5, 48); g.translate(0, 0, z); return g;
    }
    return finish(merge([flange(0), g1, flange(16.5)]));
  }

  function cameraMount() {
    var base = new T.Shape(); base.moveTo(0, 0); base.lineTo(70, 0); base.lineTo(70, 40); base.lineTo(0, 40); base.closePath();
    base.holes.push(circlePath(12, 28, 2.6)); base.holes.push(circlePath(58, 28, 2.6));
    var b = extrude(base, 4);
    // the upright, in local XY: x along the mount's width, y up; extruded 4 mm toward +Y world
    var up = new T.Shape(); up.moveTo(0, 4); up.lineTo(70, 4); up.lineTo(70, 50); up.lineTo(0, 50); up.closePath();
    up.holes.push(polyPath([[22, 16], [22, 38], [48, 38], [48, 16]]));        // lens window
    [[10, 12], [60, 12], [10, 44], [60, 44]].forEach(function (h) { up.holes.push(circlePath(h[0], h[1], 1.6)); });
    var u = extrude(up, 4); u.applyMatrix4(STAND_Y); u.translate(0, 4, 0);
    function gusset(x) {
      var s = polyShape([[4, 4], [24, 4], [4, 24]]);       // local x -> world y, local y -> world z
      var g = extrude(s, 4); g.applyMatrix4(STAND_X); g.translate(x, 0, 0); return g;
    }
    return finish(merge([b, u, gusset(0), gusset(66)]));
  }

  function spacer() {
    var s = new T.Shape(); s.absarc(0, 0, 11, 0, Math.PI * 2, false);
    s.holes.push(polyPath(hexPoints(0, 0, 12.9, Math.PI / 6).reverse()));
    return finish(extrude(s, 25.4, 48));
  }

  function gusset() {
    var s = polyShape([[0, 0], [120, 0], [120, 28], [28, 100], [0, 100]]);
    [[8, 8], [20.7, 8], [33.4, 8], [46.1, 8], [58.8, 8], [71.5, 8], [84.2, 8], [96.9, 8], [112, 8], [112, 20],
     [8, 20.7], [8, 33.4], [8, 46.1], [8, 58.8], [8, 71.5], [8, 84.2], [8, 92], [20, 92]].forEach(function (h) {
      s.holes.push(circlePath(h[0], h[1], 2.6));
    });
    s.holes.push(polyPath([[22, 22], [22, 70], [70, 22]].reverse()));             // lightening cut
    return finish(extrude(s, 6.35));
  }

  // A long curved rib, modelled standing (as it sits on the robot): 353 mm tall as exported.
  function hoodRib() {
    var R = 300, r = 270, span = 72 * Math.PI / 180, a0 = Math.PI / 2 - span / 2, n = 40, pts = [];
    for (var i = 0; i <= n; i++) { var a = a0 + span * i / n; pts.push([R * Math.cos(a), R * Math.sin(a)]); }
    for (var j = n; j >= 0; j--) { var b = a0 + span * j / n; pts.push([r * Math.cos(b), r * Math.sin(b)]); }
    var s = polyShape(pts);
    [0.15, 0.38, 0.62, 0.85].forEach(function (f) {
      var a = a0 + span * f; s.holes.push(circlePath(285 * Math.cos(a), 285 * Math.sin(a), 4));
    });
    var g = extrude(s, 8);
    // the chord runs along local X; stand it up: local X -> world Z, local Y -> world Y, local Z -> world X
    g.applyMatrix4(new T.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1));
    return finish(g);
  }

  function hexShaft() {
    var s = polyShape(hexPoints(0, 0, 12.7, Math.PI / 6));
    var g = extrude(s, 200);
    g.applyMatrix4(STAND_X);        // the shaft's length along world X, lying down
    return finish(g);
  }

  /* ------------------------------------------------------------ analysis */
  // Group triangles into planar faces; a face is "flat" for Lay on face when it is on the
  // part's convex hull (nothing sticks out past it) and has a usable area.
  function analyse(g) {
    var p = g.attributes.position.array, nTri = p.length / 9;
    var faces = [], byKey = {}, triFace = new Int32Array(nTri), volume = 0;
    var a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), e1 = new T.Vector3(), e2 = new T.Vector3();
    for (var t = 0; t < nTri; t++) {
      a.fromArray(p, t * 9); b.fromArray(p, t * 9 + 3); c.fromArray(p, t * 9 + 6);
      volume += a.dot(new T.Vector3().crossVectors(b, c)) / 6;
      e1.subVectors(b, a); e2.subVectors(c, a);
      var n = new T.Vector3().crossVectors(e1, e2), area = n.length() / 2;
      if (area < 1e-9) { triFace[t] = -1; continue; }
      n.normalize();
      var d = n.dot(a);
      var key = Math.round(n.x * 500) + ',' + Math.round(n.y * 500) + ',' + Math.round(n.z * 500) + ',' + Math.round(d * 5);
      var fi = byKey[key];
      if (fi === undefined) { fi = byKey[key] = faces.length; faces.push({ n: n, d: d, area: 0, tris: [] }); }
      faces[fi].area += area; faces[fi].tris.push(t); triFace[t] = fi;
    }
    var nv = p.length / 3;
    faces.forEach(function (f) {
      var max = -Infinity;
      for (var i = 0; i < nv; i++) { var dd = f.n.x * p[i * 3] + f.n.y * p[i * 3 + 1] + f.n.z * p[i * 3 + 2]; if (dd > max) max = dd; }
      f.onHull = max <= f.d + 0.05;
      f.flat = f.onHull && f.area >= 25;
    });
    return { faces: faces, triFace: triFace, volume: Math.abs(volume), triangles: nTri };
  }

  var LIB = [
    { key: 'bracket', name: 'L Bracket', build: lBracket, color: 0x9fb4c8 },
    { key: 'pulley', name: 'HTD Pulley 24T', build: pulley, color: 0xb7a6d6 },
    { key: 'camera', name: 'Camera Mount', build: cameraMount, color: 0x9cc9b0 },
    { key: 'spacer', name: 'Hex Bore Spacer 1in', build: spacer, color: 0xd6c08f },
    { key: 'gusset', name: 'Gusset Plate', build: gusset, color: 0xc9a0a0 },
    { key: 'rib', name: 'Shooter Hood Rib', build: hoodRib, color: 0x8fc3d6 },
    { key: 'shaft', name: '1/2in Hex Shaft', build: hexShaft, color: 0xb0b0b0 }
  ];
  var byKey = {};
  LIB.forEach(function (def) {
    var g = def.build();
    var info = analyse(g);
    var bb = g.boundingBox, size = new T.Vector3(); bb.getSize(size);
    def.geometry = g;
    def.faces = info.faces; def.triFace = info.triFace;
    def.volume = info.volume; def.triangles = info.triangles;
    def.size = { x: +size.x.toFixed(1), y: +size.y.toFixed(1), z: +size.z.toFixed(1) };
    byKey[def.key] = def;
  });

  // The documents the mock Onshape tab can show.
  var PART_STUDIO = { name: 'Intake v3', tab: 'Part Studio 1', parts: ['bracket', 'pulley', 'camera', 'spacer', 'gusset', 'rib', 'shaft'] };
  var ASSEMBLY = {
    name: 'Intake v3', tab: 'Assembly 1',
    instances: [
      { key: 'bracket', count: 4 }, { key: 'pulley', count: 2 }, { key: 'camera', count: 1 },
      { key: 'spacer', count: 6 }, { key: 'gusset', count: 2 }, { key: 'rib', count: 2 }, { key: 'shaft', count: 2 }
    ],
    standardContent: [{ name: 'Socket Head Cap Screw #10-32 x 0.5', count: 16 }, { name: 'Flanged Bearing 1/2in Hex', count: 4 }]
  };

  window.MockParts = { LIB: LIB, byKey: byKey, PART_STUDIO: PART_STUDIO, ASSEMBLY: ASSEMBLY };
})();
