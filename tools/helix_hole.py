#!/usr/bin/env python3
"""Make G-code that mills one round hole in wood with a flat end mill.

The hole is centered on XY0 of G54 and its bottom is exactly Z0, so the top of the stock
is at Z = --height. Zero the machine that way before running the program.

    python3 helix_hole.py --tool 4mm --hole 0.5in --height 2in > hole.nc

Every length needs a unit: mm or in (or "). The program is written in inches (G20).

Strategy (taken from PenguinCAM's helical + spiral hole, frc_cam_postprocessor.py, with
its plywood preset from team_config.py):
  * Helix down at 20 degrees on a radius of 0.75 x the end mill radius (PenguinCAM's
    pocket entry, helix_radius_multiplier), or the finishing radius if that is smaller.
    A helix no wider than the end mill's radius cuts through the center; PenguinCAM's
    hole entry uses one stepover (1.3 x the radius), which leaves an uncut core.
  * If the helix alone makes the hole, it goes straight to Z0 in one helix.
  * Otherwise the hole is cut in layers 1/2" deep from the top (the last layer takes the
    remainder down to Z0): helix down to the layer floor, spiral out to the finishing
    radius, cut the finishing circle, then a spring pass.
  * Every cut runs counter-clockwise (G3), which is climb milling inside a hole.
"""

import argparse
import math
import re
import sys

# PenguinCAM plywood preset, with faster helix and spiral feeds for wood.
SPINDLE_RPM = 18000
HELIX_FEED = 75.0           # IPM, helix down and the flat circle at the helix radius
SPIRAL_FEED = 100.0         # IPM, spiral out, finishing circle and spring pass
APPROACH_FEED = 50.0        # IPM, Z feed from the clearance plane down to the ramp start
RAMP_ANGLE = 20.0           # degrees
RAMP_START_CLEARANCE = 0.15  # inches above the stock top where the helix starts
CLEARANCE = 0.5             # inches above the stock top for rapid moves
STEPOVER = 0.65             # radial stepover as a fraction of the end mill diameter
HELIX_RADIUS_FRACTION = 0.75  # helix radius as a fraction of the end mill radius
MIN_HOLE_MULTIPLIER = 1.2   # smallest hole the helix can make, x end mill diameter
LAYER_DEPTH = 0.5           # inches per layer when the hole has to be widened

MM_PER_IN = 25.4
EPS = 1e-6


def parse_length(text):
    """'4mm', '0.5in', '2 in', '.5"' -> inches. A bare number is an error."""
    m = re.fullmatch(r'\s*(\d*\.?\d+)\s*(mm|in|")\s*', text, re.IGNORECASE)
    if not m:
        raise ValueError(f'"{text}" needs a unit, e.g. 4mm or 0.5in')
    value = float(m.group(1))
    if value <= 0:
        raise ValueError(f'"{text}" must be greater than zero')
    return value / MM_PER_IN if m.group(2).lower() == 'mm' else value


def fmt(v):
    """Four decimals, and never '-0.0000'."""
    return f'{round(v, 4) + 0.0:.4f}'


def both(inches):
    return f'{inches:.4f}" / {inches * MM_PER_IN:.2f} mm'


def helix(radius, z_from, z_to):
    """Full CCW turns at `radius` from z_from down to z_to, no steeper than RAMP_ANGLE."""
    pitch = 2 * math.pi * radius * math.tan(math.radians(RAMP_ANGLE))
    turns = max(1, math.ceil((z_from - z_to) / pitch - EPS))
    lines = [f'(Helix: {turns} turn{"s" if turns > 1 else ""} at r={fmt(radius)}, Z{fmt(z_from)} to Z{fmt(z_to)})']
    for i in range(1, turns + 1):
        z = z_from - (z_from - z_to) * i / turns
        lines.append(f'G3 X{fmt(radius)} Y0 I{fmt(-radius)} J0 Z{fmt(z)} F{HELIX_FEED:g}')
    return lines


def circle(radius, feed, comment):
    return f'G3 X{fmt(radius)} Y0 I{fmt(-radius)} J0 F{feed:g}  ; {comment}'


def spiral_out(r_from, r_to, stepover):
    """Archimedean spiral from (r_from, 0) to (r_to, 0) in whole CCW turns, moving out at
    most one stepover per turn, as 10-degree line segments."""
    turns = math.ceil((r_to - r_from) / stepover - EPS)
    steps = turns * 36
    lines = [f'(Spiral out: {turns} turn{"s" if turns > 1 else ""} from r={fmt(r_from)} to r={fmt(r_to)})']
    for i in range(1, steps + 1):
        a = 2 * math.pi * i / steps * turns
        r = r_from + (r_to - r_from) * i / steps
        lines.append(f'G1 X{fmt(r * math.cos(a))} Y{fmt(r * math.sin(a))} F{SPIRAL_FEED:g}')
    return lines


def layer_floors(height):
    """Z of each layer floor: every LAYER_DEPTH down from the top, then Z0."""
    floors = []
    k = 1
    while height - k * LAYER_DEPTH > EPS:
        floors.append(round(height - k * LAYER_DEPTH, 6))
        k += 1
    return floors + [0.0]


def generate(tool, hole, height):
    """G-code lines for the hole. All arguments in inches."""
    min_hole = tool * MIN_HOLE_MULTIPLIER
    if hole < min_hole - EPS:
        raise ValueError(
            f'a {hole * MM_PER_IN:.2f} mm hole is too small for a {tool * MM_PER_IN:.2f} mm '
            f'end mill: the helix needs a hole of at least {MIN_HOLE_MULTIPLIER} x the end '
            f'mill, {min_hole * MM_PER_IN:.2f} mm ({min_hole:.4f}"). Use a smaller end mill.')

    stepover = STEPOVER * tool
    finish_r = hole / 2 - tool / 2
    helix_r = min(HELIX_RADIUS_FRACTION * tool / 2, finish_r)
    expand = finish_r > helix_r + EPS
    safe_z = height + CLEARANCE
    ramp_start = height + RAMP_START_CLEARANCE

    g = [
        '(Helix hole - one round hole with a flat end mill, wood)',
        f'(Tool: {both(tool)} flat end mill)',
        f'(Hole: {both(hole)} diameter, {both(height)} deep)',
        f'(Center at X0 Y0, bottom at Z0, stock top at Z{fmt(height)})',
        f'(End mill must reach at least {fmt(ramp_start)}" below the collet nut)',
        f'(Helix: {RAMP_ANGLE:g} deg at r={fmt(helix_r)}, finishing radius {fmt(finish_r)})',
        ('(Widened in layers ' + f'{LAYER_DEPTH:g}" deep)' if expand
         else '(Helix makes the full hole - no widening)'),
        '(** VERIFY Z-ZERO AT THE HOLE BOTTOM AND XY-ZERO AT THE HOLE CENTER **)',
        '',
        'G90 G94 G91.1 G40 G49 G17',
        'G20  ; Inches',
        'G90  ; Absolute positioning mode',
        f'S{SPINDLE_RPM} M3  ; Spindle on',
        'G4 P2  ; Wait 2 seconds for spindle to reach speed',
        'G54  ; Use work coordinate system 1',
        f'G0 Z{fmt(safe_z)}  ; Safe Z clearance',
        f'G0 X{fmt(helix_r)} Y0  ; Rapid to helix start',
        f'G1 Z{fmt(ramp_start)} F{APPROACH_FEED:g}  ; Approach to ramp start height',
        '',
    ]

    if not expand:
        g += helix(helix_r, ramp_start, 0.0)
        g.append(circle(finish_r, SPIRAL_FEED, 'Flat circle at Z0 to clean the floor'))
        g.append(circle(finish_r, SPIRAL_FEED, 'Spring pass'))
    else:
        z = ramp_start
        floors = layer_floors(height)
        for n, floor in enumerate(floors, 1):
            g.append(f'(===== Layer {n}/{len(floors)}: floor Z{fmt(floor)} =====)')
            g += helix(helix_r, z, floor)
            g.append(circle(helix_r, HELIX_FEED, 'Flat circle at the helix radius'))
            g += spiral_out(helix_r, finish_r, stepover)
            g.append(circle(finish_r, SPIRAL_FEED, 'Finishing circle'))
            g.append(circle(finish_r, SPIRAL_FEED, 'Spring pass'))
            if floor > 0:
                g.append(f'G1 X{fmt(helix_r)} Y0 F{SPIRAL_FEED:g}  ; Back to the helix radius')
            g.append('')
            z = floor

    g += [
        '',
        f'G0 Z{fmt(safe_z)}  ; Retract to safe Z',
        'M5  ; Spindle off',
        'M30',
    ]
    return g


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    p.add_argument('--tool', required=True, help='end mill diameter, e.g. 4mm or 0.25in')
    p.add_argument('--hole', required=True, help='hole diameter, e.g. 12mm or 0.5in')
    p.add_argument('--height', required=True, help='hole depth from Z0 up, e.g. 2in')
    args = p.parse_args(argv)
    try:
        lines = generate(parse_length(args.tool), parse_length(args.hole),
                         parse_length(args.height))
    except ValueError as e:
        print(f'error: {e}', file=sys.stderr)
        return 2
    print('\n'.join(lines))
    return 0


if __name__ == '__main__':
    sys.exit(main())
