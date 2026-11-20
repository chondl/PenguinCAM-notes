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
          ' mm tall; the printer prints up to ' + plate.height + ' mm. Press Lay on face, then click one of its large flat faces.' });
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
  function place(copy, others, plate, fine) {
    var d = derive(copy), step = fine || 4;
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
          if (polyDistance(me, oh[i].h) < plate.spacing + 0.5) ok = false;
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
        if (polyDistance(me, oh[i].h) < plate.spacing + 0.5) ok = false;
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

  window.MockPlate = { derive: derive, worldHull: worldHull, check: check, arrange: arrange, place: place, placeNear: placeNear,
                       centre: centre, yaw: yaw, bbox: bbox, inside: inside };
})();
