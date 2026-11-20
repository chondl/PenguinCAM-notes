/* Penguin Slicer mockup: where a copy sits on the plate and the placement rules.
 * A copy is {id, partKey, q (THREE.Quaternion, its whole orientation), x, y (footprint centre, mm)}.
 * derive() caches what the orientation implies: the footprint hull, the height, and the offset
 * from the part's own centre to the footprint centre. Rules follow print/plate.py:
 * 5 mm between copies, 3 mm inside the plate edge, the printer's height. */
(function () {
  'use strict';
  var T = THREE;
  var EPS = 0.01;

  function hull(points) {           // Andrew's monotone chain; points [[x,y],...]
    var p = points.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    if (p.length < 3) return p;
    function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lower = [], upper = [];
    for (var i = 0; i < p.length; i++) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p[i]) <= 0) lower.pop();
      lower.push(p[i]);
    }
    for (var j = p.length - 1; j >= 0; j--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p[j]) <= 0) upper.pop();
      upper.push(p[j]);
    }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }

  function derive(copy) {
    var key = copy.q.x.toFixed(5) + ',' + copy.q.y.toFixed(5) + ',' + copy.q.z.toFixed(5) + ',' + copy.q.w.toFixed(5);
    if (copy.d && copy.d.key === key) return copy.d;
    var def = MockParts.byKey[copy.partKey];
    var p = def.geometry.attributes.position.array, v = new T.Vector3(), pts = [];
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    var seen = {};
    for (var i = 0; i < p.length; i += 3) {
      v.set(p[i], p[i + 1], p[i + 2]).applyQuaternion(copy.q);
      if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
      if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
      var k = Math.round(v.x * 20) + ':' + Math.round(v.y * 20);
      if (!seen[k]) { seen[k] = 1; pts.push([v.x, v.y]); }
    }
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    var full = hull(pts), h = full;
    if (full.length > 40) {                                  // thin out: a 0.2 mm error at most for these parts
      var k = Math.ceil(full.length / 40); h = full.filter(function (pt, i) { return i % k === 0; });
    }
    h = h.map(function (pt) { return [pt[0] - cx, pt[1] - cy]; });
    copy.d = { key: key, hull: h, w: maxX - minX, l: maxY - minY, height: maxZ - minZ, offset: [cx, cy, minZ] };
    return copy.d;
  }

  function worldHull(copy) {
    var d = derive(copy);
    return d.hull.map(function (pt) { return [pt[0] + copy.x, pt[1] + copy.y]; });
  }

  function segDist(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    var t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
    var qx = a[0] + t * dx - p[0], qy = a[1] + t * dy - p[1];
    return Math.sqrt(qx * qx + qy * qy);
  }
  function inside(p, poly) {
    var c = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
  function polyDistance(A, B) {
    if (inside(A[0], B) || inside(B[0], A)) return 0;
    var best = Infinity, i, j;
    for (i = 0; i < A.length; i++) for (j = 0; j < B.length; j++) {
      var d = segDist(A[i], B[j], B[(j + 1) % B.length]); if (d < best) best = d;
    }
    for (i = 0; i < B.length; i++) for (j = 0; j < A.length; j++) {
      var e = segDist(B[i], A[j], A[(j + 1) % A.length]); if (e < best) best = e;
    }
    // crossing edges with no vertex inside: treat as touching
    if (best > 0) {
      for (i = 0; i < A.length; i++) for (j = 0; j < B.length; j++) {
        if (segsCross(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length])) return 0;
      }
    }
    return best;
  }
  function segsCross(a, b, c, d) {
    function o(p, q, r) { return Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])); }
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  }
  function bbox(poly) {
    var b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    poly.forEach(function (p) { b.minX = Math.min(b.minX, p[0]); b.maxX = Math.max(b.maxX, p[0]); b.minY = Math.min(b.minY, p[1]); b.maxY = Math.max(b.maxY, p[1]); });
    return b;
  }

  // The problems on the plate, each with the copies it names and a plain sentence.
  function check(copies, plate, labelOf) {
    var problems = [];
    var hulls = copies.map(worldHull);
    copies.forEach(function (c, i) {
      var b = bbox(hulls[i]), edges = [];
      if (b.minX < plate.margin - EPS) edges.push('left');
      if (b.maxX > plate.x - plate.margin + EPS) edges.push('right');
      if (b.minY < plate.margin - EPS) edges.push('front');
      if (b.maxY > plate.y - plate.margin + EPS) edges.push('back');
      var off = edges.length > 0;
      var outside = b.minX > plate.x || b.maxX < 0 || b.minY > plate.y || b.maxY < 0;
      if (off) {
        problems.push({ rule: 'off_plate', copies: [c.id], message: outside
          ? labelOf(c) + ' is off the plate. Drag it onto the plate, or press Arrange.'
          : labelOf(c) + ' is not fully on the plate: it crosses the ' + edges.join(' and ') + ' edge' +
            (edges.length > 1 ? 's' : '') + '. Drag it inward, or press Arrange.' });
      }
      var d = derive(c);
      if (d.height > plate.height + EPS) {
        problems.push({ rule: 'too_tall', copies: [c.id], message: labelOf(c) + ' stands ' + Math.round(d.height) +
          ' mm tall; the printer prints up to ' + plate.height + ' mm. Lay it down another way, or press Auto-orient.' });
      }
    });
    for (var i = 0; i < copies.length; i++) {
      for (var j = i + 1; j < copies.length; j++) {
        var bi = bbox(hulls[i]), bj = bbox(hulls[j]);
        if (bi.maxX + plate.spacing < bj.minX || bj.maxX + plate.spacing < bi.minX ||
            bi.maxY + plate.spacing < bj.minY || bj.maxY + plate.spacing < bi.minY) continue;
        var dist = polyDistance(hulls[i], hulls[j]);
        if (dist < plate.spacing - EPS) {
          problems.push({ rule: 'too_close', copies: [copies[i].id, copies[j].id], message: dist === 0
            ? labelOf(copies[i]) + ' and ' + labelOf(copies[j]) + ' overlap. Drag one away, or press Arrange.'
            : labelOf(copies[i]) + ' and ' + labelOf(copies[j]) + ' are ' + dist.toFixed(1) + ' mm apart; copies need ' +
              plate.spacing + ' mm between them. Drag one away, or press Arrange.' });
        }
      }
    }
    return problems;
  }

  function yaw(copy, deg) {
    var r = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), deg * Math.PI / 180);
    copy.q = r.multiply(copy.q);
    copy.d = null;
  }

  // Shelf packing, largest first. A copy too long for the plate is tried turned 90 and 45
  // degrees. Copies that still do not fit wait beside the plate. Returns the number parked.
  function arrange(copies, plate) {
    var usableX = plate.x - 2 * plate.margin, usableY = plate.y - 2 * plate.margin;
    copies.forEach(function (c) {
      var d = derive(c);
      if (d.w <= usableX && d.l <= usableY) return;
      var tries = [90, 45, 90];
      for (var t = 0; t < tries.length; t++) {
        yaw(c, tries[t]); d = derive(c);
        if (d.w <= usableX && d.l <= usableY) return;
      }
    });
    // largest footprint first, each at the first free spot scanning from the front-left corner
    function area(c) { var h = derive(c).hull, a = 0; for (var i = 0, j = h.length - 1; i < h.length; j = i++) a += (h[j][0] + h[i][0]) * (h[j][1] - h[i][1]); return Math.abs(a / 2); }
    var order = copies.slice().sort(function (a, b) { return area(b) - area(a); });
    var placed = [], parked = 0, sideY = 0;
    order.forEach(function (c) {
      if (place(c, placed, plate)) { placed.push(c); return; }
      var turns = [90, 45, 90, 90], q0 = c.q.clone();         // try it turned, with a finer scan
      for (var t = 0; t < turns.length; t++) {
        yaw(c, turns[t]);
        if (place(c, placed, plate, 2)) { placed.push(c); return; }
      }
      c.q = q0; c.d = null;
      var d = derive(c);
      c.x = plate.x + plate.spacing * 4 + d.w / 2; c.y = sideY + d.l / 2; sideY += d.l + plate.spacing; parked++;
    });
    // Slide the packed group to the middle of the plate, where Orca puts it and where the
    // bed heats most evenly.
    if (placed.length) {
      var g = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
      placed.forEach(function (c) {
        var b = bbox(worldHull(c));
        g.minX = Math.min(g.minX, b.minX); g.maxX = Math.max(g.maxX, b.maxX); g.minY = Math.min(g.minY, b.minY); g.maxY = Math.max(g.maxY, b.maxY);
      });
      var dx = plate.x / 2 - (g.minX + g.maxX) / 2, dy = plate.y / 2 - (g.minY + g.maxY) / 2;
      placed.forEach(function (c) { c.x += dx; c.y += dy; });
    }
    return parked;
  }

  // A free place for one new copy among the others, scanning the plate; beside it if none.
  // A quick "cannot fit": the copy's outline is larger than the plate area the others leave.
  function noRoom(copy, others, plate) {
    var free = (plate.x - 2 * plate.margin) * (plate.y - 2 * plate.margin);
    others.forEach(function (o) { free -= hullArea(derive(o).hull); });
    return hullArea(derive(copy).hull) > free;
  }
  function place(copy, others, plate, fine) {
    var d = derive(copy), step = fine || 4;
    if (noRoom(copy, others, plate)) { copy.x = plate.x + plate.spacing * 4 + d.w / 2; copy.y = d.l / 2; return false; }
    var oh = others.map(function (o) { var h = worldHull(o); return { h: h, b: bbox(h) }; });
    for (var y = plate.margin + d.l / 2; y <= plate.y - plate.margin - d.l / 2 + EPS; y += step) {
      for (var x = plate.margin + d.w / 2; x <= plate.x - plate.margin - d.w / 2 + EPS; x += step) {
        copy.x = x; copy.y = y;
        var me = null, ok = true;
        for (var i = 0; i < oh.length && ok; i++) {
          var b = oh[i].b;
          if (x - d.w / 2 > b.maxX + plate.spacing || x + d.w / 2 < b.minX - plate.spacing ||
              y - d.l / 2 > b.maxY + plate.spacing || y + d.l / 2 < b.minY - plate.spacing) continue;
          me = me || worldHull(copy);
          if (closer(me, oh[i].h, plate.spacing + 0.5)) ok = false;
        }
        if (ok) return true;
      }
    }
    copy.x = plate.x + plate.spacing * 4 + d.w / 2; copy.y = d.l / 2;
    return false;
  }

  // The free place nearest to a wanted point (tx, ty): where the copy already stands, the
  // copy it was duplicated from, or the middle of the group. Keeps a new or laid-down copy
  // beside the others instead of sending it to the front-left corner. False if none is free;
  // the copy is then left where it was.
  function placeNear(copy, others, plate, tx, ty, fine) {
    var d = derive(copy), step = fine || 4, keepX = copy.x, keepY = copy.y;
    var oh = others.map(function (o) { var h = worldHull(o); return { h: h, b: bbox(h) }; });
    var x0 = plate.margin + d.w / 2, x1 = plate.x - plate.margin - d.w / 2 + EPS;
    var y0 = plate.margin + d.l / 2, y1 = plate.y - plate.margin - d.l / 2 + EPS;
    var spots = [];
    // the wanted point itself first (clamped onto the plate), then the grid, nearest first
    if (x1 >= x0 && y1 >= y0) spots.push([Math.min(Math.max(tx, x0), x1), Math.min(Math.max(ty, y0), y1), -1]);
    for (var y = y0; y <= y1; y += step) for (var x = x0; x <= x1; x += step) spots.push([x, y, (x - tx) * (x - tx) + (y - ty) * (y - ty)]);
    spots.sort(function (a, b) { return a[2] - b[2]; });
    for (var s = 0; s < spots.length; s++) {
      copy.x = spots[s][0]; copy.y = spots[s][1];
      var me = null, ok = true;
      for (var i = 0; i < oh.length && ok; i++) {
        var b = oh[i].b;
        if (copy.x - d.w / 2 > b.maxX + plate.spacing || copy.x + d.w / 2 < b.minX - plate.spacing ||
            copy.y - d.l / 2 > b.maxY + plate.spacing || copy.y + d.l / 2 < b.minY - plate.spacing) continue;
        me = me || worldHull(copy);
        if (closer(me, oh[i].h, plate.spacing + 0.5)) ok = false;
      }
      if (ok) return true;
    }
    copy.x = keepX; copy.y = keepY;
    return false;
  }

  // The middle of a group of copies on the plate; the plate's middle when there are none.
  function centre(copies, plate) {
    if (!copies.length) return [plate.x / 2, plate.y / 2];
    var g = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    copies.forEach(function (c) {
      var b = bbox(worldHull(c));
      g.minX = Math.min(g.minX, b.minX); g.maxX = Math.max(g.maxX, b.maxX); g.minY = Math.min(g.minY, b.minY); g.maxY = Math.max(g.maxY, b.maxY);
    });
    return [(g.minX + g.maxX) / 2, (g.minY + g.maxY) / 2];
  }

  /* ------------------------------------------------------------ the pile arrange */
  // Research 2026-11-19, section C: largest first; each copy tried at the angle that gives its
  // outline the smallest rectangle and at a quarter, half and three-quarter turn from it (45
  // degrees more only if none of those fits); every free spot on a 5 mm grid scored by how
  // small and square the pile stays and how near the plate's middle it is, then refined at
  // 1 mm; the pile is centred at the end. Copies that fit nowhere wait beside the plate.
  function hullArea(h) { var a = 0; for (var i = 0, j = h.length - 1; i < h.length; j = i++) a += (h[j][0] + h[i][0]) * (h[j][1] - h[i][1]); return Math.abs(a / 2); }
  function minRectAngle(h) {
    var best = 0, bestA = Infinity;
    for (var i = 0; i < h.length; i++) {
      var a = h[i], b = h[(i + 1) % h.length], th = Math.atan2(b[1] - a[1], b[0] - a[0]);
      var c = Math.cos(-th), s = Math.sin(-th), x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (var k = 0; k < h.length; k++) {
        var x = h[k][0] * c - h[k][1] * s, y = h[k][0] * s + h[k][1] * c;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      var A = (x1 - x0) * (y1 - y0); if (A < bestA - 1e-6) { bestA = A; best = -th; }
    }
    return best * 180 / Math.PI;
  }
  // true when two outlines are closer than lim (stops at the first pair of edges that is)
  function closer(A, B, lim) {
    if (inside(A[0], B) || inside(B[0], A)) return true;
    var i, j, ba = bbox(A), bb = bbox(B);
    // only a vertex within lim of the other outline's box can be within lim of that outline
    function near(P, b) { return P.filter(function (p) { return p[0] > b.minX - lim && p[0] < b.maxX + lim && p[1] > b.minY - lim && p[1] < b.maxY + lim; }); }
    var An = near(A, bb), Bn = near(B, ba);
    for (i = 0; i < An.length; i++) for (j = 0; j < B.length; j++) if (segDist(An[i], B[j], B[(j + 1) % B.length]) < lim) return true;
    for (i = 0; i < Bn.length; i++) for (j = 0; j < A.length; j++) if (segDist(Bn[i], A[j], A[(j + 1) % A.length]) < lim) return true;
    // edges that cross: only edges that reach into the other outline's box can
    function edgesIn(P, b) {
      var out = [];
      for (var k = 0; k < P.length; k++) {
        var p = P[k], q = P[(k + 1) % P.length];
        if (Math.max(p[0], q[0]) >= b.minX && Math.min(p[0], q[0]) <= b.maxX && Math.max(p[1], q[1]) >= b.minY && Math.min(p[1], q[1]) <= b.maxY) out.push([p, q]);
      }
      return out;
    }
    var Ae = edgesIn(A, bb), Be = edgesIn(B, ba);
    for (i = 0; i < Ae.length; i++) for (j = 0; j < Be.length; j++) if (segsCross(Ae[i][0], Ae[i][1], Be[j][0], Be[j][1])) return true;
    return false;
  }
  function pile(copies, plate) {
    var order = copies.slice().sort(function (a, b) { return hullArea(derive(b).hull) - hullArea(derive(a).hull); });
    var placed = [], pb = null, parked = 0, sideY = 0, lim = plate.spacing + 0.5;
    var mx = plate.x / 2, my = plate.y / 2;
    function scoreAt(w0, x, y, d) {
      var minX = x - d.w / 2, maxX = x + d.w / 2, minY = y - d.l / 2, maxY = y + d.l / 2;
      if (pb) { minX = Math.min(minX, pb.minX); maxX = Math.max(maxX, pb.maxX); minY = Math.min(minY, pb.minY); maxY = Math.max(maxY, pb.maxY); }
      var w = maxX - minX, l = maxY - minY;
      return Math.sqrt(w * l) + 0.2 * Math.sqrt((x - mx) * (x - mx) + (y - my) * (y - my)) + 0.3 * Math.max(w, l);
    }
    function freeAt(d, x, y) {
      var me = null;
      for (var i = 0; i < placed.length; i++) {
        var b = placed[i].b;
        if (x - d.w / 2 > b.maxX + plate.spacing || x + d.w / 2 < b.minX - plate.spacing ||
            y - d.l / 2 > b.maxY + plate.spacing || y + d.l / 2 < b.minY - plate.spacing) continue;
        me = me || d.hull.map(function (pt) { return [pt[0] + x, pt[1] + y]; });
        if (closer(me, placed[i].h, lim)) return false;
      }
      return true;
    }
    order.forEach(function (c) {
      var q0 = c.q.clone(); c.d = null;
      var base = minRectAngle(derive(c).hull), angles = [0, 90, 180, 270, 45, 135], best = null;
      var full = noRoom(c, placed.map(function (p) { return p.c; }), plate);
      for (var ai = 0; ai < angles.length && !full; ai++) {
        if (ai >= 4 && best) break;
        c.q = q0.clone(); yaw(c, base + angles[ai]); var d = derive(c);
        var x0 = plate.margin + d.w / 2, x1 = plate.x - plate.margin - d.w / 2 + EPS, y0 = plate.margin + d.l / 2, y1 = plate.y - plate.margin - d.l / 2 + EPS;
        // score every spot first (cheap), then test spots best first: the first free one wins
        var spots = [];
        for (var y = y0; y <= y1; y += 5) for (var x = x0; x <= x1; x += 5) spots.push([scoreAt(0, x, y, d), x, y]);
        spots.sort(function (a, b) { return a[0] - b[0]; });
        for (var si = 0; si < spots.length; si++) {
          if (best && spots[si][0] >= best.s) break;
          if (!freeAt(d, spots[si][1], spots[si][2])) continue;
          best = { s: spots[si][0], x: spots[si][1], y: spots[si][2], q: c.q.clone(), d: d, x0: x0, x1: x1, y0: y0, y1: y1 };
          break;
        }
      }
      if (!best) {
        c.q = q0; c.d = null; var dp = derive(c);
        c.x = plate.x + plate.spacing * 4 + dp.w / 2; c.y = sideY + dp.l / 2; sideY += dp.l + plate.spacing; parked++;
        return;
      }
      c.q = best.q; c.d = null; var dd = derive(c), bx = best.x, by = best.y;
      for (var dy = -5; dy <= 5; dy++) for (var dx = -5; dx <= 5; dx++) {
        var xx = bx + dx, yy = by + dy;
        if (xx < best.x0 || xx > best.x1 || yy < best.y0 || yy > best.y1 || !freeAt(dd, xx, yy)) continue;
        var s2 = scoreAt(0, xx, yy, dd);
        if (s2 < best.s) { best.s = s2; best.x = xx; best.y = yy; }
      }
      c.x = best.x; c.y = best.y;
      var h = worldHull(c), b = bbox(h);
      placed.push({ c: c, h: h, b: b });
      pb = pb ? { minX: Math.min(pb.minX, b.minX), maxX: Math.max(pb.maxX, b.maxX), minY: Math.min(pb.minY, b.minY), maxY: Math.max(pb.maxY, b.maxY) } : b;
    });
    if (pb) {
      var cdx = mx - (pb.minX + pb.maxX) / 2, cdy = my - (pb.minY + pb.maxY) / 2;
      placed.forEach(function (p) { p.c.x += cdx; p.c.y += cdy; });
    }
    return parked;
  }

  // Arrange as the research recommends: run the shelf packer above and the pile, keep the
  // result that leaves fewer copies beside the plate, the smaller pile breaking a tie.
  // Returns { parked, placed, turned, used: 'pile' | 'shelf', ms }.
  function bestArrange(copies, plate) {
    var t0 = performance.now();
    function snap() { return copies.map(function (c) { return { c: c, x: c.x, y: c.y, q: c.q.clone() }; }); }
    function restore(s) { s.forEach(function (b) { b.c.x = b.x; b.c.y = b.y; b.c.q = b.q.clone(); b.c.d = null; }); }
    function pileArea() {
      var on = copies.filter(function (c) { return c.x < plate.x + plate.spacing; });
      if (!on.length) return 0;
      var g = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
      on.forEach(function (c) { var b = bbox(worldHull(c)); g.minX = Math.min(g.minX, b.minX); g.maxX = Math.max(g.maxX, b.maxX); g.minY = Math.min(g.minY, b.minY); g.maxY = Math.max(g.maxY, b.maxY); });
      return (g.maxX - g.minX) * (g.maxY - g.minY);
    }
    var start = snap();
    var pa = arrange(copies, plate), A = snap(), aArea = pileArea();
    restore(start);
    var pp = pile(copies, plate), pArea = pileArea(), used = 'pile';
    if (pa < pp || (pa === pp && aArea < pArea)) { restore(A); used = 'shelf'; }
    var parked = used === 'pile' ? pp : pa, turned = 0;
    start.forEach(function (s) { if (s.q.angleTo(s.c.q) > 0.02) turned++; });
    return { parked: parked, placed: copies.length - parked, turned: turned, used: used, ms: Math.round(performance.now() - t0) };
  }

  window.MockPlate = { derive: derive, worldHull: worldHull, check: check, arrange: arrange, bestArrange: bestArrange, place: place, placeNear: placeNear,
                       centre: centre, yaw: yaw, bbox: bbox, inside: inside };
})();
