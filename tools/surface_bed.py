#!/usr/bin/env python3
"""Make G-code that surfaces (levels) the MDF bed between two machine X limits.

Jog the bit down to the surfacing height in Mach4, then run the program: it never
commands an absolute Z, so it cuts at whatever height the head is at.

    python3 surface_bed.py --tool 1.5in --xmin 2in --xmax 22in > surface.nc

Every length needs a unit: mm or in (or "). The X limits are machine coordinates and
may be negative. The program is written in inches (G20).

Toolpath:
  * Every XY move is in machine coordinates (G53 G0 / G53 G1). Y is always exactly 0 or
    25 (machine): each pass runs the bit's center from one to the other.
  * The bit's edge never leaves xmin..xmax: the passes run from xmax - radius down to
    xmin + radius, in equal steps of at most 80% of the bit diameter.
  * Start: lift 0.25" (incremental), rapid to (xmax - radius, Y0), plunge 0.25" back
    down to the jogged height.
  * Passes alternate +Y and -Y, stepping over in X at Y0 or Y25.
  * Edge cleanup: run along the Y edge the last pass ended on, from the low-X limit to
    the high-X limit; cross to the other Y edge (retracing the first pass); run that
    edge back to the low-X limit.
  * End: lift 0.25" (incremental), spindle off.
"""

import argparse
import math
import re
import sys

SPINDLE_RPM = 18000
FEED = 150.0          # IPM, all cutting moves
PLUNGE_FEED = 35.0    # IPM, the plunge back down to the jogged height (PenguinCAM plywood)
LIFT = 0.25           # inches, incremental lift before the rapid to the start and at the end
MAX_STEPOVER = 0.8    # largest step between passes, as a fraction of the bit diameter
Y_MIN = 0.0           # machine Y of one end of every pass
Y_MAX = 25.0          # machine Y of the other end

MM_PER_IN = 25.4
EPS = 1e-9


def parse_length(text):
    """'1.5in', '50mm', '-3.5in', '2"' -> inches. A bare number is an error."""
    m = re.fullmatch(r'\s*(-?\d*\.?\d+)\s*(mm|in|")\s*', text, re.IGNORECASE)
    if not m:
        raise ValueError(f'"{text}" needs a unit, e.g. 50mm or 2in')
    value = float(m.group(1))
    return value / MM_PER_IN if m.group(2).lower() == 'mm' else value


def fmt(v):
    """Four decimals, and never '-0.0000'."""
    return f'{round(v, 4) + 0.0:.4f}'


def both(inches):
    return f'{inches:.4f}" / {inches * MM_PER_IN:.2f} mm'


def pass_xs(tool, xmin, xmax):
    """Machine X of each pass, high to low. The two limit passes are rounded inward to
    four decimals so the printed program never puts the bit's edge outside the range."""
    r = tool / 2
    hi = math.floor((xmax - r) * 1e4 + 1e-6) / 1e4
    lo = math.ceil((xmin + r) * 1e4 - 1e-6) / 1e4
    if hi < lo:
        raise ValueError(f'the area from X{xmin:.4f}" to X{xmax:.4f}" is narrower than the '
                         f'{both(tool)} bit')
    span = hi - lo
    steps = math.ceil(span / (MAX_STEPOVER * tool) - EPS) if span > 0 else 0
    if steps == 0:
        return [hi]
    xs = [hi - span * i / steps for i in range(steps)] + [lo]
    return [round(x, 4) for x in xs]


def other_y(y):
    return Y_MAX if y == Y_MIN else Y_MIN


def generate(tool, xmin, xmax):
    """G-code lines. All arguments in inches; xmin and xmax are machine X."""
    if tool <= 0:
        raise ValueError('the bit diameter must be greater than zero')
    if xmin >= xmax:
        raise ValueError(f'xmin ({xmin:.4f}") must be less than xmax ({xmax:.4f}")')
    if xmax - xmin < tool - EPS:
        raise ValueError(f'the area from X{xmin:.4f}" to X{xmax:.4f}" is narrower than the '
                         f'{both(tool)} bit')
    xs = pass_xs(tool, xmin, xmax)
    step = xs[0] - xs[1] if len(xs) > 1 else 0.0
    hi, lo = xs[0], xs[-1]

    g = [
        '(Surface the bed - flat passes at the current Z height)',
        f'(Bit: {both(tool)})',
        f'(Area: machine X{fmt(xmin)} to X{fmt(xmax)}, bit edge stays inside)',
        f'(Bit center: X{fmt(hi)} to X{fmt(lo)}, Y{Y_MIN:g} to Y{Y_MAX:g} machine)',
        f'({len(xs)} passes, step {step:.4f}" = {step / tool * 100:.1f}% of the bit)',
        f'(Spindle {SPINDLE_RPM} RPM, feed {FEED:g} IPM)',
        '(** JOG Z TO THE SURFACING HEIGHT BEFORE STARTING **)',
        '(** FIRST TIME: RUN IT IN THE AIR WITH Z JOGGED WELL ABOVE THE BED **)',
        '',
        'G90 G94 G17 G40 G49',
        'G20  ; Inches',
        f'S{SPINDLE_RPM} M3  ; Spindle on',
        'G4 P2  ; Wait 2 seconds for spindle to reach speed',
        '',
        f'G91 G0 Z{fmt(LIFT)}  ; Lift above the surfacing height, incremental',
        'G90',
        f'G53 G0 X{fmt(hi)} Y{fmt(Y_MIN)}  ; Rapid to the first pass, machine coordinates',
        f'G91 G1 Z{fmt(-LIFT)} F{PLUNGE_FEED:g}  ; Plunge back to the surfacing height',
        'G90',
        '',
    ]

    y = Y_MIN
    for n, x in enumerate(xs, 1):
        if n > 1:
            g.append(f'G53 G1 X{fmt(x)}  ; Step over')
        y = other_y(y)
        feed = f' F{FEED:g}' if n == 1 else ''
        g.append(f'G53 G1 Y{fmt(y)}{feed}  ; Pass {n}/{len(xs)}')

    g.append('')
    g.append('(Edge cleanup)')
    if hi > lo:
        g.append(f'G53 G1 X{fmt(hi)}  ; Along the Y{y:g} edge')
    y = other_y(y)
    g.append(f'G53 G1 Y{fmt(y)}  ; Cross to the other edge, retracing the first pass')
    if hi > lo:
        g.append(f'G53 G1 X{fmt(lo)}  ; Along the Y{y:g} edge')

    g += [
        '',
        f'G91 G0 Z{fmt(LIFT)}  ; Lift, incremental',
        'G90',
        'M5  ; Spindle off',
        'M30',
    ]
    return g


def _join_negative_values(argv):
    """Let '--xmin -20in' work: argparse would read '-20in' as an option."""
    out = []
    it = iter(argv)
    for tok in it:
        if tok in ('--tool', '--xmin', '--xmax'):
            nxt = next(it, None)
            if nxt is not None and nxt.startswith('-'):
                out.append(f'{tok}={nxt}')
                continue
            out.append(tok)
            if nxt is not None:
                out.append(nxt)
        else:
            out.append(tok)
    return out


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    p = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    p.add_argument('--tool', required=True, help='surfacing bit diameter, e.g. 1.5in or 50mm')
    p.add_argument('--xmin', required=True, help='low X edge of the area, machine coordinates')
    p.add_argument('--xmax', required=True, help='high X edge of the area, machine coordinates')
    args = p.parse_args(_join_negative_values(argv))
    try:
        lines = generate(parse_length(args.tool), parse_length(args.xmin),
                         parse_length(args.xmax))
    except ValueError as e:
        print(f'error: {e}', file=sys.stderr)
        return 2
    print('\n'.join(lines))
    return 0


if __name__ == '__main__':
    sys.exit(main())
