"""Tests for surface_bed.py. Run: python3 -m unittest tools/test_surface_bed.py"""

import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import surface_bed  # noqa: E402

MM = 1 / 25.4


def words(line):
    code = re.sub(r'\(.*?\)', '', line.split(';')[0]).strip()
    return code, dict(re.findall(r'([A-Z])(-?[\d.]+)', code))


def walk(lines):
    """Follow the program. Return the XY moves as dicts (start, end, rapid?, feed) and the
    Z moves as (incremental?, value, rapid?, feed). Machine XY starts unknown (None)."""
    x = y = None
    incremental = False
    feed = None
    xy_moves, z_moves = [], []
    for raw in lines:
        code, w = words(raw)
        if not code:
            continue
        gs = re.findall(r'G(\d+(?:\.\d+)?)', code)
        if '91' in gs:
            incremental = True
        if '90' in gs:
            incremental = False
        if 'F' in w:
            feed = float(w['F'])
        motion = [g for g in gs if g in ('0', '1')]
        if 'Z' in w:
            z_moves.append({'incremental': incremental, 'z': float(w['Z']),
                            'rapid': motion == ['0'], 'feed': feed, 'g53': '53' in gs})
        if 'X' in w or 'Y' in w:
            nx = float(w['X']) if 'X' in w else x
            ny = float(w['Y']) if 'Y' in w else y
            xy_moves.append({'start': (x, y), 'end': (nx, ny), 'rapid': motion == ['0'],
                             'feed': feed, 'g53': '53' in gs, 'motion': motion,
                             'incremental': incremental})
            x, y = nx, ny
    return xy_moves, z_moves


class Case:
    tool = xmin = xmax = None

    def setUp(self):
        self.lines = surface_bed.generate(self.tool, self.xmin, self.xmax)
        self.xy, self.z = walk(self.lines)
        self.r = self.tool / 2
        self.cut = self.xy[1:]  # everything after the rapid to the start corner
        self.passes = [m for m in self.cut if m['start'][0] == m['end'][0]
                       and abs(m['end'][1] - m['start'][1]) == surface_bed.Y_MAX]

    def pass_xs(self):
        xs = []
        for m in self.passes:
            if not xs or xs[-1] != m['end'][0]:
                xs.append(m['end'][0])
        return xs

    def main_xs(self):
        """Pass X positions before the edge cleanup (which retraces the first pass)."""
        xs = self.pass_xs()
        return xs[:xs.index(min(xs)) + 1]

    def test_bit_edge_never_leaves_x_range(self):
        for m in self.xy:
            for x, _ in (m['start'], m['end']):
                if x is None:
                    continue
                self.assertGreaterEqual(x - self.r, self.xmin, m)
                self.assertLessEqual(x + self.r, self.xmax, m)

    def test_first_and_last_pass_at_the_limits(self):
        # At the limit, or up to 0.0001" inside it (the script rounds the limit passes inward).
        xs = self.main_xs()
        self.assertTrue(0 <= (self.xmax - self.r) - xs[0] < 1e-4, xs[0])
        self.assertTrue(0 <= xs[-1] - (self.xmin + self.r) < 1e-4, xs[-1])
        self.assertEqual(self.xy[0]['end'], (xs[0], 0.0))

    def test_passes_high_to_low_with_equal_steps_at_most_80_percent(self):
        # The passes before the edge cleanup: the cleanup retraces the first pass.
        main = self.main_xs()
        steps = [a - b for a, b in zip(main, main[1:])]
        self.assertTrue(steps)
        for s in steps:
            self.assertGreater(s, 0)
            self.assertLessEqual(s, surface_bed.MAX_STEPOVER * self.tool + 1e-4)
            self.assertAlmostEqual(s, steps[0], places=3)

    def test_y_only_ever_0_or_25(self):
        for m in self.xy:
            self.assertIn(m['end'][1], (0.0, 25.0))

    def test_every_xy_move_is_g53_absolute(self):
        for m in self.xy:
            self.assertTrue(m['g53'], m)
            self.assertFalse(m['incremental'], m)
            self.assertEqual(len(m['motion']), 1, m)

    def test_cutting_feed(self):
        for m in self.cut:
            self.assertFalse(m['rapid'])
            self.assertEqual(m['feed'], surface_bed.FEED)

    def test_z_only_lift_plunge_lift(self):
        self.assertEqual([(m['incremental'], m['z'], m['rapid']) for m in self.z],
                         [(True, surface_bed.LIFT, True), (True, -surface_bed.LIFT, False),
                          (True, surface_bed.LIFT, True)])
        self.assertEqual(self.z[1]['feed'], surface_bed.PLUNGE_FEED)
        # All cutting happens between the plunge and the final lift: net Z zero.
        plunge = next(i for i, l in enumerate(self.lines) if re.search(r'\bZ-', l))
        lift = max(i for i, l in enumerate(self.lines) if f'Z{surface_bed.LIFT:.4f}' in l)
        first_cut = next(i for i, l in enumerate(self.lines) if l.startswith('G53 G1'))
        last_cut = max(i for i, l in enumerate(self.lines) if l.startswith('G53 G1'))
        self.assertLess(plunge, first_cut)
        self.assertGreater(lift, last_cut)

    def test_edge_cleanup_covers_both_edges(self):
        main = self.main_xs()
        lo, hi = main[-1], main[0]
        edges = [m for m in self.cut if m['start'][1] == m['end'][1]
                 and {round(m['start'][0], 4), round(m['end'][0], 4)} == {round(lo, 4), round(hi, 4)}]
        self.assertEqual(sorted(m['end'][1] for m in edges), [0.0, 25.0])
        self.assertIs(self.cut[-1], edges[-1])

    def test_setup(self):
        text = '\n'.join(self.lines)
        self.assertIn('S18000 M3', text)
        self.assertIn('G20', text)
        self.assertLess(text.index('G40'), text.index('G53'))
        self.assertTrue(text.rstrip().endswith('M30'))
        self.assertLess(text.index('M5'), text.index('M30'))


class Example(Case, unittest.TestCase):
    tool, xmin, xmax = 1.5, 2.0, 22.0

    def test_pass_count(self):
        self.assertEqual(len(self.main_xs()), 17)


class Metric(Case, unittest.TestCase):
    tool, xmin, xmax = 50 * MM, 100 * MM, 610 * MM


class NegativeMachineX(Case, unittest.TestCase):
    tool, xmin, xmax = 1.0, -20.0, -3.3


class ExactMultiple(Case, unittest.TestCase):
    # Span 6 - 1 = 5" with a 1" bit: steps of exactly 0.8" don't fit 5 evenly, 7 steps of 0.7143".
    tool, xmin, xmax = 1.0, 0.0, 6.0


class OnePass(Case, unittest.TestCase):
    # Area exactly one bit wide: a single pass, no step-over.
    tool, xmin, xmax = 1.0, 5.0, 6.0

    def test_passes_high_to_low_with_equal_steps_at_most_80_percent(self):
        self.assertEqual(self.pass_xs(), [5.5])

    def test_edge_cleanup_covers_both_edges(self):
        # No length to run along the edges: the cleanup is the retrace of the one pass.
        self.assertEqual(len(self.passes), 2)
        self.assertIs(self.cut[-1], self.passes[-1])


class Rejections(unittest.TestCase):
    def test_area_narrower_than_bit(self):
        with self.assertRaises(ValueError):
            surface_bed.generate(1.0, 5.0, 5.9)

    def test_xmin_above_xmax(self):
        with self.assertRaises(ValueError):
            surface_bed.generate(1.0, 10.0, 2.0)

    def test_parse(self):
        self.assertAlmostEqual(surface_bed.parse_length('50mm'), 50 * MM)
        self.assertAlmostEqual(surface_bed.parse_length('-3.5in'), -3.5)
        with self.assertRaises(ValueError):
            surface_bed.parse_length('22')

    def test_main_reports_error(self):
        self.assertEqual(surface_bed.main(['--tool', '1in', '--xmin', '2', '--xmax', '22in']), 2)
        self.assertEqual(surface_bed.main(['--tool', '-1in', '--xmin', '2in', '--xmax', '22in']), 2)

    def test_main_accepts_negative_x_as_separate_word(self):
        import contextlib
        import io
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(surface_bed.main(['--tool', '1in', '--xmin', '-20in', '--xmax', '-3in']), 0)
        self.assertIn('G53 G0 X-3.5000 Y0', out.getvalue())


if __name__ == '__main__':
    unittest.main()
