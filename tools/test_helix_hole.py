"""Tests for helix_hole.py. Run: python3 -m unittest tools/test_helix_hole.py"""

import math
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import helix_hole  # noqa: E402

MM = 1 / 25.4
EPS = 1e-3


def simulate(lines):
    """Walk the G-code and return the cutting moves as dicts with start/end XYZ, the
    move kind (G0/G1/G3), the feed, and (for arcs) the arc center and radius."""
    x = y = z = None
    feed = None
    moves = []
    for raw in lines:
        line = re.sub(r'\(.*?\)', '', raw.split(';')[0]).strip()
        if not line:
            continue
        words = dict(re.findall(r'([A-Z])(-?[\d.]+)', line))
        g = words.get('G')
        if g not in ('0', '1', '3'):
            continue
        if 'F' in words:
            feed = float(words['F'])
        nx = float(words['X']) if 'X' in words else x
        ny = float(words['Y']) if 'Y' in words else y
        nz = float(words['Z']) if 'Z' in words else z
        move = {'g': g, 'start': (x, y, z), 'end': (nx, ny, nz), 'feed': feed}
        if g == '3':
            cx, cy = x + float(words['I']), y + float(words['J'])
            move['center'] = (cx, cy)
            move['radius'] = math.hypot(x - cx, y - cy)
        moves.append(move)
        x, y, z = nx, ny, nz
    return moves


def radius_of(move):
    if move['g'] == '3':
        return move['radius']
    return math.hypot(move['end'][0], move['end'][1])


class ParseLengthTest(unittest.TestCase):
    def test_units(self):
        self.assertAlmostEqual(helix_hole.parse_length('4mm'), 4 * MM)
        self.assertAlmostEqual(helix_hole.parse_length('0.5in'), 0.5)
        self.assertAlmostEqual(helix_hole.parse_length('2 in'), 2.0)
        self.assertAlmostEqual(helix_hole.parse_length('12MM'), 12 * MM)
        self.assertAlmostEqual(helix_hole.parse_length('.5"'), 0.5)

    def test_bare_number_rejected(self):
        with self.assertRaises(ValueError):
            helix_hole.parse_length('4')

    def test_nonpositive_rejected(self):
        with self.assertRaises(ValueError):
            helix_hole.parse_length('0mm')


class GeometryCase:
    """Shared checks; subclasses set tool, hole, height (inches)."""
    tool = hole = height = None

    def setUp(self):
        self.lines = helix_hole.generate(self.tool, self.hole, self.height)
        self.moves = simulate(self.lines)
        self.cuts = [m for m in self.moves if m['g'] in ('1', '3')]
        self.finish_r = self.hole / 2 - self.tool / 2
        self.helix_r = min(helix_hole.HELIX_RADIUS_FRACTION * self.tool / 2, self.finish_r)

    def test_bottom_exactly_z0(self):
        zs = [m['end'][2] for m in self.moves]
        self.assertAlmostEqual(min(zs), 0.0, places=6)
        self.assertGreaterEqual(min(zs), 0.0)

    def test_arcs_centered_on_origin(self):
        for m in self.cuts:
            if m['g'] == '3':
                self.assertAlmostEqual(m['center'][0], 0.0, places=4)
                self.assertAlmostEqual(m['center'][1], 0.0, places=4)

    def test_never_exceeds_finish_radius(self):
        biggest = max(radius_of(m) for m in self.cuts)
        self.assertAlmostEqual(biggest, self.finish_r, places=3)

    def test_helix_angle_at_most_20_degrees(self):
        for m in self.cuts:
            dz = m['start'][2] - m['end'][2]
            if m['g'] == '3' and dz > 0:
                self.assertLessEqual(dz / (2 * math.pi * m['radius']),
                                     math.tan(math.radians(helix_hole.RAMP_ANGLE)) + 1e-4)
                self.assertEqual(m['feed'], helix_hole.HELIX_FEED)

    def test_helix_cuts_through_the_center(self):
        # A helix wider than the end mill's radius leaves an uncut core in the middle.
        helices = [m for m in self.cuts if m['g'] == '3' and m['start'][2] - m['end'][2] > 0]
        self.assertTrue(helices)
        for m in helices:
            self.assertLess(m['radius'], self.tool / 2)

    def test_no_straight_plunge_into_stock(self):
        for m in self.cuts:
            dz = m['start'][2] - m['end'][2]
            if m['g'] == '1' and dz > 0:
                # Only the approach in the air above the stock may move straight down.
                self.assertGreaterEqual(m['end'][2], self.height - EPS)

    def test_spindle_and_program_end(self):
        text = '\n'.join(self.lines)
        self.assertIn('S18000 M3', text)
        self.assertIn('G20', text)
        self.assertIn('G54', text)
        self.assertIn('M5', text)
        self.assertTrue(text.rstrip().endswith('M30'))


class ExpandedDeepHole(GeometryCase, unittest.TestCase):
    tool, hole, height = 4 * MM, 0.5, 2.0

    def test_needs_expansion(self):
        self.assertGreater(self.finish_r, self.helix_r + EPS)

    def test_widened_in_layers_no_deeper_than_half_inch(self):
        wide_z = sorted({round(m['end'][2], 6) for m in self.cuts
                         if radius_of(m) > self.helix_r + EPS}, reverse=True)
        self.assertEqual(wide_z, [1.5, 1.0, 0.5, 0.0])

    def test_spiral_feed(self):
        for m in self.cuts:
            if radius_of(m) > self.helix_r + EPS:
                self.assertEqual(m['feed'], helix_hole.SPIRAL_FEED)


class HalfInchHoleSixMillimeterTool(GeometryCase, unittest.TestCase):
    # Was a single helix with a 1.3 x radius helix, which left a core; now widened in layers.
    tool, hole, height = 6 * MM, 0.5, 2.0

    def test_needs_expansion(self):
        self.assertGreater(self.finish_r, self.helix_r + EPS)


class UnevenDepth(GeometryCase, unittest.TestCase):
    tool, hole, height = 6 * MM, 1.0, 1.3

    def test_last_layer_is_the_remainder(self):
        wide_z = sorted({round(m['end'][2], 6) for m in self.cuts
                         if radius_of(m) > self.helix_r + EPS}, reverse=True)
        self.assertEqual(wide_z, [0.8, 0.3, 0.0])


class NoExpansion(GeometryCase, unittest.TestCase):
    # 9 mm hole, 6 mm end mill: finish radius 1.5 mm < 0.75 x 3 mm, so the helix is the hole.
    tool, hole, height = 6 * MM, 9 * MM, 2.0

    def test_single_helix_to_bottom(self):
        self.assertAlmostEqual(self.helix_r, self.finish_r)
        descending = [m for m in self.cuts if m['start'][2] - m['end'][2] > 0 and m['g'] == '3']
        # One continuous helix: every descending arc follows the previous with no flat moves between.
        first = self.cuts.index(descending[0])
        last = self.cuts.index(descending[-1])
        self.assertEqual(last - first + 1, len(descending))
        self.assertAlmostEqual(descending[-1]['end'][2], 0.0, places=6)


class Rejections(unittest.TestCase):
    def test_hole_too_small_for_helix(self):
        with self.assertRaises(ValueError) as ctx:
            helix_hole.generate(4 * MM, 4.5 * MM, 1.0)
        self.assertIn('4.80 mm', str(ctx.exception))

    def test_main_reports_error(self):
        self.assertEqual(helix_hole.main(['--tool', '4', '--hole', '0.5in', '--height', '2in']), 2)


if __name__ == '__main__':
    unittest.main()
