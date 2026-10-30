"""Run helix_hole.py examples through PenguinCAM's gcode_sim heightmap simulator, and
PenguinCAM's own hole toolpath for the same hole beside each one.

Needs a PenguinCAM checkout (for gcode_sim, numpy and the post-processor). Run from it:
  cd /repos/popcornpenguins/PenguinCAM
  uv run python ../PenguinCAM-notes/tools/simulate_helix_hole.py <outdir>

Writes each program (.nc) and a heightmap render (.png) to <outdir> and prints, per
example: floor Z, cut diameter against the target, any uncut core in the middle, the
estimated cycle time, and the floor after each layer.

gcode_sim starts its tracked position at X0 Y0 Z0, so a program's opening `G0 Z<safe>` at
XY0 looks like a plunge from Z0 and cuts a phantom hole at the origin. This script drops
that first move before stamping.
"""
import contextlib
import io
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.getcwd())
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gcode_sim  # noqa: E402
from frc_cam_postprocessor import FRCPostProcessor  # noqa: E402
import helix_hole  # noqa: E402

OUT = sys.argv[1]
MM = 1 / 25.4
RES = 0.002


def simulate(text, tool, top, grid=None):
    moves = gcode_sim.parse_moves(text)
    if moves and moves[0][1:4] == (0.0, 0.0, 0.0):
        moves = moves[1:]  # phantom plunge from the simulator's initial Z0
    r = tool / 2
    if grid is None:
        grid = gcode_sim._make_grid(moves, r, RES)
    z = np.full((grid['ny'], grid['nx']), np.float32(top), dtype=np.float32)
    mask = gcode_sim._disc_mask(r / RES)
    mr = mask.shape[0] // 2
    for _, x0, y0, z0, x1, y1, z1 in moves:
        n = max(1, int(math.ceil(math.hypot(x1 - x0, y1 - y0) / (RES * 0.5))))
        for k in range(n + 1):
            t = k / n
            zt = z0 + (z1 - z0) * t
            if zt >= top:
                continue
            ci = int(round((y0 + (y1 - y0) * t - grid['miny']) / RES))
            cj = int(round((x0 + (x1 - x0) * t - grid['minx']) / RES))
            gcode_sim._stamp(z, mask, mr, ci, cj, np.float32(zt))
    return gcode_sim.Heightmap(grid, top, tool, 'inch', z), grid


def measure(hm, hole):
    g = hm.grid
    xs = g['minx'] + np.arange(g['nx']) * RES
    ys = g['miny'] + np.arange(g['ny']) * RES
    X, Y = np.meshgrid(xs, ys)
    R = np.hypot(X, Y)
    z = hm.z
    floor = float(z.min())
    cut = z < hm.material_top - 1e-6
    at_floor = z <= floor + 0.001
    inside = R <= hole / 2 - 2 * RES
    left = inside & ~at_floor
    core_r = float(R[left].max()) if left.any() else 0.0
    core_h = float(z[left].max() - floor) if left.any() else 0.0
    return {
        'floor': floor,
        'cut_dia': 2 * float(R[cut].max()) if cut.any() else 0.0,
        'floor_dia': 2 * math.sqrt(at_floor.sum() * RES * RES / math.pi),
        'core_r': core_r, 'core_h': core_h,
    }


def cycle(text):
    pp = FRCPostProcessor(1.0, 0.157)
    with contextlib.redirect_stdout(io.StringIO()):
        return pp._estimate_cycle_time(text.splitlines())['total']


def penguincam(tool, hole, height):
    pp = FRCPostProcessor(height, tool)
    with contextlib.redirect_stdout(io.StringIO()):
        pp.apply_material_preset('plywood')
        pp.circles = [{'center': (0.0, 0.0), 'diameter': hole}]
        pp.polylines = [[(-3, -3), (3, -3), (3, 3), (-3, 3), (-3, -3)]]
        pp.identify_perimeter_and_pockets()
        pp.classify_holes()
        result = pp.generate_gcode()
    lines = result.gcode.splitlines()
    start = next(i for i, l in enumerate(lines) if l.startswith('(Hole ') or l.startswith('(Peck drill'))
    end = next(i for i in range(start, len(lines)) if 'Retract' in lines[i])
    head = next(i for i, l in enumerate(lines) if l.startswith('G0 X0 Y0')) + 1
    return '\n'.join(lines[:head] + lines[start:end + 1])


def fmt_row(label, m, hole, secs):
    core = (f'core r {m["core_r"]:.4f}" stands {m["core_h"]:.3f}"' if m['core_h'] > 0.001
            else 'no core')
    return (f'  {label:11s} floor Z{m["floor"]:+.4f}  cut dia {m["cut_dia"]:.4f}" '
            f'(target {hole:.4f}", {m["cut_dia"] - hole:+.4f})  {core}  cycle {secs:5.1f} s')


EXAMPLES = [
    ('A', 'Layered widening, 4 layers', '4mm', '0.5in', '2in'),
    ('B', '12 mm hole, 6 mm end mill', '6mm', '12mm', '2in'),
    ('B2', 'Single helix, no widening', '6mm', '9mm', '2in'),
    ('C', 'Half-inch hole, 6 mm end mill', '6mm', '0.5in', '2in'),
    ('D', 'Multi-turn spiral, uneven last layer', '4mm', '1in', '1.3in'),
    ('E', 'Big hole, 1/4" end mill, 2 layers', '0.25in', '2in', '0.75in'),
    ('F', 'Smallest hole for the end mill', '4mm', '4.8mm', '0.5in'),
    ('G', 'Shallow hole, one layer', '6mm', '1in', '0.4in'),
    ('H', 'Same as A in other units', '0.1575in', '12.7mm', '50.8mm'),
]

for key, title, t, h, d in EXAMPLES:
    tool, hole, height = (helix_hole.parse_length(v) for v in (t, h, d))
    mine = '\n'.join(helix_hole.generate(tool, hole, height))
    open(f'{OUT}/{key}_helix_hole.nc', 'w').write(mine)
    hm, grid = simulate(mine, tool, height)
    gcode_sim.render_heightmap_png(hm, f'{OUT}/{key}_helix_hole.png')
    print(f'=== {key}: {title}  (--tool {t} --hole {h} --height {d})')
    print(fmt_row('helix_hole', measure(hm, hole), hole, cycle(mine)))

    # Layer by layer: simulate the program up to the end of each layer.
    lines = mine.splitlines()
    starts = [i for i, l in enumerate(lines) if l.startswith('(===== Layer')]
    if len(starts) > 1:
        for n, s in enumerate(starts[1:] + [len(lines)], 1):
            pm, _ = simulate('\n'.join(lines[:s]), tool, height, grid)
            mm = measure(pm, hole)
            print(f'    after layer {n}: floor Z{mm["floor"]:.4f}, floor dia {mm["floor_dia"]:.4f}"')

    pc = penguincam(tool, hole, height)
    open(f'{OUT}/{key}_penguincam.nc', 'w').write(pc)
    pm, _ = simulate(pc, tool, height, grid)
    print(fmt_row('PenguinCAM', measure(pm, hole), hole, cycle(pc)))
    print()

print('=== I: hole too small for the end mill  (--tool 4mm --hole 4.5mm --height 1in)')
print('  exit code', helix_hole.main(['--tool', '4mm', '--hole', '4.5mm', '--height', '1in']))
