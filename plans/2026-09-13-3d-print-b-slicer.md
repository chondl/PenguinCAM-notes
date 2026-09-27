# 3D Print Stage 1, Subfeature B: Profiles, Sample Part and Slicer Wrapper Implementation Plan

> **Paths updated 2026-09-13:** the print path moved into the top-level `print/`
> package after this document was written. File paths and imports below were
> rewritten to match; the design and the task order are unchanged. See
> [3D_PRINTING.md](https://github.com/6238/PenguinCAM/blob/main/docs/3D_PRINTING.md) for the current layout.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the three flattened Orca profiles and the fixed sample part, and a Flask-free Python module `print/slicer.py` that slices an STL with the installed Orca and returns a summary, all guarded by fast mocked tests plus a real-slice integration test.

**Architecture:** `print/scripts/flatten_orca_profiles.py` resolves Orca's `inherits` chains from the profile tree inside the installed build and writes self-contained JSON into `print/profiles/`. `print/slicer.py` computes the fixed binary path from its own location, refuses to import without it, builds the Orca command line, isolates Orca's configuration writes under the output directory, and reads the summary from the `.gcode.3mf` archive and `result.json`. `part_info()` reads the STL bounding box and the profile names and bed size. Nothing here imports Flask.

**Tech Stack:** Python 3.11 stdlib only (`json`, `struct`, `zipfile`, `subprocess`, `re`, `pathlib`, `dataclasses`), `unittest`.

**Spec:** `docs/superpowers/specs/2026-09-13-3d-print-slicing-design.md`, sections 5 (Profiles), 6 (`print/slicer.py`), 8 (error handling) and 9 (testing).

## Global Constraints

- Orca is at `tools/orca/orca-slicer` relative to the repository root, computed from `print/slicer.py`'s own file location. No environment variable, no `PATH` lookup.
- `print/slicer.py` raises `RuntimeError` at import when the binary is missing; the message names `make install`.
- Profiles live at `print/profiles/printer.json`, `filament.json`, `process.json`. Source profile names: printer `Bambu Lab X1 Carbon 0.4 nozzle`, filament `Bambu PLA Basic @BBL X1C`, process `0.20mm Standard @BBL X1C`, from the `BBL` vendor tree inside the installed Orca (`tools/orca/squashfs-root/resources/profiles/BBL/` on Linux, `tools/orca/OrcaSlicer.app/Contents/Resources/profiles/BBL/` on macOS).
- Flattening = follow `inherits` to the root, merge child over parent, set `from` to `system` and `inherits` to `""`, drop `instantiation` and `setting_id` (the review's verified working set had exactly this shape), write JSON with sorted keys, indent 4, `ensure_ascii=False`, trailing newline.
- Sample part: `print/sample_part.stl`, binary STL, millimetres, an L bracket with footprint 40 x 30 mm and height 12 mm (no axis over 60 mm).
- Orca command line (exactly this, paths absolute):
  `tools/orca/orca-slicer --datadir <output_dir>/datadir --load-settings "<printer.json>;<process.json>" --load-filaments "<filament.json>" --arrange 1 --slice 0 --export-3mf <stem>.gcode.3mf --outputdir <output_dir> <stl_path>`
  with environment `XDG_CONFIG_HOME=<output_dir>/xdg-config`, `XDG_RUNTIME_DIR=<output_dir>/xdg-runtime` (both created first, `xdg-runtime` mode 0700), `LC_ALL=C`. `output_dir` is created before the run (Orca exits 156 when `--outputdir` is missing). Success = exit code 0 and the archive exists; stderr text is never used to judge success.
- Summary sources: `Metadata/slice_info.config` gives `prediction` (seconds), `weight` (grams), `<filament ... used_m="…">`; `Metadata/plate_1.gcode` header line `; total layer number: N`; `result.json` beside the archive gives `sliced_plates[*].warning_message` (macOS does not write it: then warnings is `[]`). A missing field is `None`, not an error.
- `SliceError(message, details)`: `message` one sentence for the student, `details` the last twenty lines of Orca's combined output (or the archive listing when the G-code entry is missing).
- Timeout default 120 s. Timeout message: "The slicer took too long on this part."
- Tests: `print/tests/test_slicer.py` runs no Orca (fake `subprocess.run`); `print/tests/orca_integration_test.py` (class `OrcaInstalledTest` exists from subfeature A) gains the real slice and the profile-regeneration check.
- Commit each task on branch `feature/3d-print-stage1` with a message starting `print(b): `. Never touch `main`, never push. Never commit `tools/` or `.superpowers/`.
- Run `uv run python -m unittest discover -s tests --buffer && uv run python -m unittest discover -s print/tests -t . --buffer && uv run python gcode_test.py --quiet` (that is `make test-quick`) before each commit; run `make test` at the end of Task 4.
- Test fixtures live in `print/tests/fixtures/` (`.gitignore` negates both test trees).

---

### Task 1: Profile flattening script and the checked-in profiles

**Files:**
- Create: `print/scripts/flatten_orca_profiles.py`
- Create: `print/profiles/printer.json`, `print/profiles/filament.json`, `print/profiles/process.json` (generated by the script)
- Create: `print/README.md`
- Test: `print/tests/test_flatten_orca_profiles.py`

**Interfaces:**
- Consumes: the installed Orca at `tools/orca/` (subfeature A).
- Produces: `flatten_profile(profile_dir: Path, subdir: str, name: str) -> dict` and `write_profiles(profile_dir: Path, out_dir: Path) -> None` in `print/scripts/flatten_orca_profiles.py`; `bbl_profile_dir() -> Path`; the three JSON files. Task 3's integration test calls `write_profiles(bbl_profile_dir(), tmp)` and compares to `print/profiles/`.

- [ ] **Step 1: Write the failing tests**

`print/tests/test_flatten_orca_profiles.py`:

```python
"""Tests for print/scripts/flatten_orca_profiles.py against a tiny fake profile tree."""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]        # the repository root
sys.path.insert(0, str(REPO / "print" / "scripts"))

from flatten_orca_profiles import flatten_profile, write_profiles, PROFILE_SOURCES  # noqa: E402


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))


class FlattenProfileTest(unittest.TestCase):
    def setUp(self):
        self.tree = Path(tempfile.mkdtemp(prefix="orca-profiles-"))
        self.addCleanup(shutil.rmtree, self.tree, ignore_errors=True)
        _write(self.tree / "machine" / "fdm_machine_common.json",
               {"name": "fdm_machine_common", "type": "machine", "instantiation": "false",
                "printable_height": "100", "gcode_flavor": "marlin", "printable_area": ["0x0", "100x0", "100x100", "0x100"]})
        _write(self.tree / "machine" / "Family.json",
               {"name": "Family", "type": "machine", "inherits": "fdm_machine_common", "instantiation": "false",
                "printable_height": "250", "setting_id": "GM000"})
        _write(self.tree / "machine" / "Leaf 0.4 nozzle.json",
               {"name": "Leaf 0.4 nozzle", "type": "machine", "inherits": "Family", "from": "system",
                "instantiation": "true", "setting_id": "GM001", "nozzle_diameter": ["0.4"]})

    def test_child_keys_win_over_parent_keys(self):
        flat = flatten_profile(self.tree, "machine", "Leaf 0.4 nozzle")
        self.assertEqual(flat["printable_height"], "250")   # Family over common
        self.assertEqual(flat["gcode_flavor"], "marlin")     # inherited from the root
        self.assertEqual(flat["nozzle_diameter"], ["0.4"])   # leaf
        self.assertEqual(flat["name"], "Leaf 0.4 nozzle")

    def test_result_is_self_contained_system_profile(self):
        flat = flatten_profile(self.tree, "machine", "Leaf 0.4 nozzle")
        self.assertEqual(flat["inherits"], "")
        self.assertEqual(flat["from"], "system")
        self.assertNotIn("instantiation", flat)
        self.assertNotIn("setting_id", flat)

    def test_missing_profile_raises_with_its_name(self):
        with self.assertRaises(FileNotFoundError) as ctx:
            flatten_profile(self.tree, "machine", "No Such Printer")
        self.assertIn("No Such Printer", str(ctx.exception))

    def test_write_profiles_writes_sorted_indented_json(self):
        _write(self.tree / "filament" / "F.json", {"name": "F", "type": "filament", "filament_density": ["1.26"]})
        _write(self.tree / "process" / "P.json", {"name": "P", "type": "process", "layer_height": "0.2"})
        out = self.tree / "out"
        sources = {"printer": ("machine", "Leaf 0.4 nozzle"), "filament": ("filament", "F"), "process": ("process", "P")}
        write_profiles(self.tree, out, sources)
        text = (out / "printer.json").read_text()
        self.assertTrue(text.endswith("}\n"))
        self.assertEqual(json.loads(text), flatten_profile(self.tree, "machine", "Leaf 0.4 nozzle"))
        self.assertEqual(list(json.loads(text).keys()), sorted(json.loads(text).keys()))
        self.assertIn('"layer_height": "0.2"', (out / "process.json").read_text())

    def test_default_sources_are_the_x1c_set(self):
        self.assertEqual(PROFILE_SOURCES["printer"], ("machine", "Bambu Lab X1 Carbon 0.4 nozzle"))
        self.assertEqual(PROFILE_SOURCES["filament"], ("filament", "Bambu PLA Basic @BBL X1C"))
        self.assertEqual(PROFILE_SOURCES["process"], ("process", "0.20mm Standard @BBL X1C"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python -m unittest tests.test_flatten_orca_profiles -v`
Expected: `ModuleNotFoundError: No module named 'flatten_orca_profiles'`.

- [ ] **Step 3: Write the script**

`print/scripts/flatten_orca_profiles.py` (mode 0755):

```python
#!/usr/bin/env python3
"""Flatten Orca Slicer profile inheritance chains into self-contained JSON.

Orca's vendor profiles are chains: a Bambu printer profile inherits from a
family profile, which inherits from a base, and each file holds only the keys
it overrides. The command line does not resolve those chains: it loads exactly
the keys in the files it is given and fills the rest with built-in defaults,
silently. The desktop app's export does not help either: it writes the user
preset's differences plus its parent's name. So the profiles PenguinCAM ships
in print/profiles/ are produced by this script from the tree inside the
installed Orca build, and an integration test fails when they drift.

Usage (from the repository root, after `make install`):

    uv run python print/scripts/flatten_orca_profiles.py

Options:
    --profile-dir DIR   Orca's BBL vendor tree (default: inside tools/orca)
    --out DIR           Output directory (default: print/profiles)
"""
import argparse
import json
import sys
from pathlib import Path

PKG = Path(__file__).resolve().parent.parent     # the print/ directory
REPO = PKG.parent

# Output file stem -> (subdirectory of the vendor tree, profile name).
PROFILE_SOURCES = {
    "printer": ("machine", "Bambu Lab X1 Carbon 0.4 nozzle"),
    "filament": ("filament", "Bambu PLA Basic @BBL X1C"),
    "process": ("process", "0.20mm Standard @BBL X1C"),
}

# Keys that only mean something inside Orca's own preset database.
DROP_KEYS = ("instantiation", "setting_id")


def bbl_profile_dir():
    """The BBL vendor tree inside the installed Orca, Linux or macOS layout."""
    linux = REPO / "tools" / "orca" / "squashfs-root" / "resources" / "profiles" / "BBL"
    macos = REPO / "tools" / "orca" / "OrcaSlicer.app" / "Contents" / "Resources" / "profiles" / "BBL"
    for candidate in (linux, macos):
        if candidate.is_dir():
            return candidate
    raise FileNotFoundError(f"no Orca profile tree at {linux} or {macos}; run `make install`")


def _load(profile_dir, subdir, name):
    path = Path(profile_dir) / subdir / f"{name}.json"
    if not path.is_file():
        raise FileNotFoundError(f"profile '{name}' not found at {path}")
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def flatten_profile(profile_dir, subdir, name):
    """Resolve `name` in `profile_dir/subdir` into one dict, child keys over parent keys."""
    chain = []
    current = name
    seen = set()
    while current:
        if current in seen:
            raise ValueError(f"inheritance loop at '{current}' under {subdir}")
        seen.add(current)
        data = _load(profile_dir, subdir, current)
        chain.append(data)
        current = data.get("inherits", "")
    merged = {}
    for data in reversed(chain):
        merged.update(data)
    merged["inherits"] = ""
    merged["from"] = "system"
    for key in DROP_KEYS:
        merged.pop(key, None)
    return merged


def write_profiles(profile_dir, out_dir, sources=PROFILE_SOURCES):
    """Write one flattened JSON per entry of `sources` into `out_dir`."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    for stem, (subdir, name) in sources.items():
        flat = flatten_profile(profile_dir, subdir, name)
        text = json.dumps(flat, indent=4, ensure_ascii=False, sort_keys=True) + "\n"
        (out_dir / f"{stem}.json").write_text(text, encoding="utf-8")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--profile-dir", type=Path, default=None)
    parser.add_argument("--out", type=Path, default=PKG / "profiles")
    args = parser.parse_args(argv)
    profile_dir = args.profile_dir or bbl_profile_dir()
    write_profiles(profile_dir, args.out)
    for stem, (subdir, name) in PROFILE_SOURCES.items():
        print(f"{stem}.json <- {subdir}/{name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python -m unittest tests.test_flatten_orca_profiles -v`
Expected: 5 tests `OK`.

- [ ] **Step 5: Generate the checked-in profiles and write the README**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python print/scripts/flatten_orca_profiles.py && ls -la print/profiles && python3 -c "import json; [print(f, json.load(open('print/profiles/'+f+'.json'))['name']) for f in ('printer','filament','process')]"`
Expected: three files; names `Bambu Lab X1 Carbon 0.4 nozzle`, `Bambu PLA Basic @BBL X1C`, `0.20mm Standard @BBL X1C`. Check `printer.json` has `"printable_area": ["0x0", "256x0", "256x256", "0x256"]` and `"printable_height": "250"`, `filament.json` has `"filament_density": ["1.26"]`, `process.json` has `"layer_height": "0.2"`.

Create `print/README.md`:

```markdown
# Fixed print assets (stage 1)

Stage 1 of 3D printing slices one fixed part with one fixed Bambu Lab profile
set. Later stages export the part from Onshape and take profiles from team
configuration; see [3D_PRINTING.md](../docs/3D_PRINTING.md).

## `sample_part.stl`

An L bracket, 40 x 30 x 12 mm, binary STL in millimetres, generated by
`print/scripts/make_sample_part.py`. It stands in for the Onshape export.

## `profiles/`

Three self-contained Orca Slicer profiles, flattened from the `BBL` vendor
tree inside the installed Orca build (version pinned in
`print/scripts/install-orca.sh`):

| File | Source profile |
|------|----------------|
| `printer.json` | `machine/Bambu Lab X1 Carbon 0.4 nozzle` |
| `filament.json` | `filament/Bambu PLA Basic @BBL X1C` |
| `process.json` | `process/0.20mm Standard @BBL X1C` |

Orca's command line does not resolve `inherits`, and the desktop app's export
writes only a preset's differences from its parent, so neither can produce
these files. Regenerate them after an Orca upgrade with:

    uv run python print/scripts/flatten_orca_profiles.py

`print/tests/orca_integration_test.py` fails when the checked-in files differ from
what the script produces from the installed Orca.
```

- [ ] **Step 6: Run the quick suite and commit**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python -m unittest discover -s tests --buffer && uv run python -m unittest discover -s print/tests -t . --buffer && uv run python gcode_test.py --quiet`
Expected: all pass. Commit `print/scripts/flatten_orca_profiles.py`, `print/profiles/*.json`, `print/README.md`, `print/tests/test_flatten_orca_profiles.py` with message `print(b): flatten Orca profiles for the X1 Carbon set`.

---

### Task 2: Sample part generator and STL

**Files:**
- Create: `print/scripts/make_sample_part.py`
- Create: `print/sample_part.stl` (generated)
- Test: `print/tests/test_make_sample_part.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `print/sample_part.stl`; `write_l_bracket(path: Path) -> int` (returns triangle count, 20); `stl_triangles(data: bytes) -> list[tuple[tuple[float,float,float], ...]]` in `print/scripts/make_sample_part.py` is NOT shared with `print/slicer.py` (Task 3 has its own reader, because `print/slicer.py` must not import from `print/scripts/`).

> **Correction (2026-09-13, during execution):** the two-rectangle cap split in Step 3 below is not watertight (T-junctions at `(10,10)` and `(0,10)` leave unmatched edges). The implementation triangulates each cap as a four-triangle fan from the reflex vertex `(10,10)` to the other hexagon vertices; the closed-mesh test in Step 1 is what caught it. `stl_triangles` in the Interfaces line was never used and was dropped.

The part is the L polygon `(0,0) (40,0) (40,10) (10,10) (10,30) (0,30)` extruded from z=0 to z=12, in millimetres. Top and bottom are each two rectangles (four triangles), the six side walls two triangles each: 20 triangles, one closed manifold shell, outward normals.

- [ ] **Step 1: Write the failing test**

`print/tests/test_make_sample_part.py`:

```python
"""The fixed sample part is a small, closed, binary STL in millimetres."""
import struct
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]        # the repository root
sys.path.insert(0, str(REPO / "print" / "scripts"))

from make_sample_part import write_l_bracket  # noqa: E402


def read_binary_stl(data):
    count = struct.unpack("<I", data[80:84])[0]
    tris = []
    for i in range(count):
        rec = struct.unpack("<12fH", data[84 + i * 50: 84 + (i + 1) * 50])
        tris.append((rec[3:6], rec[6:9], rec[9:12]))
    return tris


class SamplePartTest(unittest.TestCase):
    def test_generator_writes_twenty_triangle_l_bracket(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "part.stl"
            self.assertEqual(write_l_bracket(path), 20)
            data = path.read_bytes()
        self.assertEqual(len(data), 84 + 20 * 50)
        tris = read_binary_stl(data)
        xs = [v[0] for t in tris for v in t]
        ys = [v[1] for t in tris for v in t]
        zs = [v[2] for t in tris for v in t]
        self.assertEqual((min(xs), max(xs)), (0.0, 40.0))
        self.assertEqual((min(ys), max(ys)), (0.0, 30.0))
        self.assertEqual((min(zs), max(zs)), (0.0, 12.0))

    def test_mesh_is_closed(self):
        # Every directed edge must be matched by its reverse exactly once.
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "part.stl"
            write_l_bracket(path)
            tris = read_binary_stl(path.read_bytes())
        edges = {}
        for a, b, c in tris:
            for u, v in ((a, b), (b, c), (c, a)):
                edges[(u, v)] = edges.get((u, v), 0) + 1
        for (u, v), n in edges.items():
            self.assertEqual(n, 1, f"edge {u}->{v} used {n} times")
            self.assertEqual(edges.get((v, u), 0), 1, f"edge {u}->{v} has no twin")

    def test_checked_in_stl_matches_generator(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "part.stl"
            write_l_bracket(path)
            fresh = path.read_bytes()
        self.assertEqual((REPO / "print" / "sample_part.stl").read_bytes(), fresh)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python -m unittest tests.test_make_sample_part -v`
Expected: `ModuleNotFoundError: No module named 'make_sample_part'`.

- [ ] **Step 3: Write the generator**

`print/scripts/make_sample_part.py` (mode 0755):

```python
#!/usr/bin/env python3
"""Write print/sample_part.stl: an L bracket 40 x 30 x 12 mm as a binary STL.

The polygon (0,0) (40,0) (40,10) (10,10) (10,30) (0,30) is extruded 12 mm in
Z. Twenty triangles, one closed shell, outward normals, counter-clockwise
winding seen from outside. Deterministic: the checked-in file must equal the
output byte for byte (print/tests/test_make_sample_part.py).
"""
import struct
import sys
from pathlib import Path

PKG = Path(__file__).resolve().parent.parent     # the print/ directory
OUTPUT = PKG / "sample_part.stl"

FOOTPRINT = [(0.0, 0.0), (40.0, 0.0), (40.0, 10.0), (10.0, 10.0), (10.0, 30.0), (0.0, 30.0)]
HEIGHT = 12.0
# The L split into two rectangles (each as two triangles), counter-clockwise.
CAPS = [
    [(0.0, 0.0), (40.0, 0.0), (40.0, 10.0), (0.0, 10.0)],
    [(0.0, 10.0), (10.0, 10.0), (10.0, 30.0), (0.0, 30.0)],
]


def _normal(a, b, c):
    ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
    nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
    length = (nx * nx + ny * ny + nz * nz) ** 0.5 or 1.0
    return (nx / length, ny / length, nz / length)


def l_bracket_triangles():
    tris = []
    for quad in CAPS:
        (x0, y0), (x1, y1), (x2, y2), (x3, y3) = quad
        top = [(x0, y0, HEIGHT), (x1, y1, HEIGHT), (x2, y2, HEIGHT), (x3, y3, HEIGHT)]
        bottom = [(x0, y0, 0.0), (x3, y3, 0.0), (x2, y2, 0.0), (x1, y1, 0.0)]  # reversed: faces -Z
        for face in (top, bottom):
            tris.append((face[0], face[1], face[2]))
            tris.append((face[0], face[2], face[3]))
    n = len(FOOTPRINT)
    for i in range(n):
        (xa, ya), (xb, yb) = FOOTPRINT[i], FOOTPRINT[(i + 1) % n]
        a0, b0 = (xa, ya, 0.0), (xb, yb, 0.0)
        a1, b1 = (xa, ya, HEIGHT), (xb, yb, HEIGHT)
        tris.append((a0, b0, b1))
        tris.append((a0, b1, a1))
    return tris


def write_l_bracket(path):
    tris = l_bracket_triangles()
    header = b"PenguinCAM sample part: L bracket 40x30x12 mm".ljust(80, b"\0")
    body = [header, struct.pack("<I", len(tris))]
    for a, b, c in tris:
        body.append(struct.pack("<12fH", *_normal(a, b, c), *a, *b, *c, 0))
    Path(path).write_bytes(b"".join(body))
    return len(tris)


if __name__ == "__main__":
    count = write_l_bracket(OUTPUT)
    print(f"wrote {OUTPUT} ({count} triangles)")
    sys.exit(0)
```

The cap triangulation of the shared edge between the two rectangles (`(0,10)-(10,10)`) is an internal edge on the top and bottom faces: both rectangles use it with opposite direction, so the closed-mesh test holds.

- [ ] **Step 4: Generate the STL and run the tests**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python print/scripts/make_sample_part.py && uv run python -m unittest tests.test_make_sample_part -v`
Expected: `wrote .../print/sample_part.stl (20 triangles)`; 3 tests `OK`. If `test_mesh_is_closed` fails, the winding of `bottom` or a side wall is wrong; the T-junction at `(10,10)` on the outline is a real vertex of both cap rectangles and of the side walls, so no edge splitting is needed.

- [ ] **Step 5: Run the quick suite and commit**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python -m unittest discover -s tests --buffer && uv run python -m unittest discover -s print/tests -t . --buffer && uv run python gcode_test.py --quiet`
Expected: all pass. Commit `print/scripts/make_sample_part.py`, `print/sample_part.stl`, `print/tests/test_make_sample_part.py` with message `print(b): add the fixed sample part`.

---

### Task 3: `print/slicer.py` with mocked tests

**Files:**
- Create: `print/slicer.py`
- Create: `print/tests/fixtures/slice_info.config`, `print/tests/fixtures/plate_1_header.gcode`, `print/tests/fixtures/result.json`
- Test: `print/tests/test_slicer.py`

**Interfaces:**
- Consumes: `print/profiles/*.json` (Task 1), `print/sample_part.stl` (Task 2), `tools/orca/orca-slicer` (subfeature A).
- Produces, in `print/slicer.py`:
  - `ORCA_BIN: Path`, `PROFILE_DIR: Path`, `SAMPLE_STL: Path`, `DEFAULT_TIMEOUT_S = 120`
  - `class SliceError(Exception)` with attributes `message: str`, `details: str`
  - `@dataclass class SliceResult`: `output_path: Path`, `print_time_s: float | None`, `filament_m: float | None`, `filament_g: float | None`, `layer_count: int | None`, `warnings: list[str]`; method `summary() -> dict` returning `{"print_time_s", "filament_m", "filament_g", "layer_count", "warnings"}`
  - `slice_stl(stl_path, output_dir, timeout_s=DEFAULT_TIMEOUT_S) -> SliceResult`
  - `part_info(stl_path=SAMPLE_STL) -> dict` with shape `{"part": {"name": "sample_part", "file": "sample_part.stl", "size_mm": {"x": 40.0, "y": 30.0, "z": 12.0}, "triangles": 20}, "printer": {"name": str, "bed_mm": {"x": 256.0, "y": 256.0}, "height_mm": 250.0}, "filament": {"name": str}, "process": {"name": str, "layer_height_mm": 0.2}}`
  - `stl_bounds(data: bytes) -> tuple[tuple[float,float,float], tuple[float,float,float], int]` (min corner, max corner, triangle count), binary or ASCII
  - `read_summary(archive_path, output_dir) -> dict` (the parsing, exposed for tests)
  - `build_command(stl_path, output_dir) -> list[str]`
  Subfeature C's `print/jobs.py` calls `slice_stl` and `SliceResult.summary()`, and `print/routes.py` calls `part_info()` and streams `SAMPLE_STL`.

Fixtures come from the adversarial review's real headless slice, preserved at `/tmp/claude-1000/orca-review-artifacts/test/outA/`: copy `result.json` verbatim; extract `Metadata/slice_info.config` from `box.gcode.3mf` with `unzip -p`; take the first 11 lines of `plate_1.gcode` (through `; HEADER_BLOCK_END`) as `plate_1_header.gcode`. Expected values in those fixtures: `prediction` 790, `weight` 3.31, `used_m` 1.09, `total layer number` 50, `warning_message` "".

- [ ] **Step 1: Create the fixtures**

Run:
```bash
cd /repos/popcornpenguins/PenguinCAM && mkdir -p print/tests/fixtures \
 && cp /tmp/claude-1000/orca-review-artifacts/test/outA/result.json print/tests/fixtures/result.json \
 && unzip -p /tmp/claude-1000/orca-review-artifacts/test/outA/box.gcode.3mf Metadata/slice_info.config > print/tests/fixtures/slice_info.config \
 && head -11 /tmp/claude-1000/orca-review-artifacts/test/outA/plate_1.gcode > print/tests/fixtures/plate_1_header.gcode \
 && grep -c 'total layer number: 50' print/tests/fixtures/plate_1_header.gcode && grep -c 'key="prediction" value="790"' print/tests/fixtures/slice_info.config
```
Expected: `1` and `1`.

- [ ] **Step 2: Write the failing tests**

`print/tests/test_slicer.py`:

```python
"""Fast tests for print/slicer.py. Orca is never run: subprocess.run is replaced."""
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parents[2]        # the repository root
sys.path.insert(0, str(REPO))
FIXTURES = Path(__file__).resolve().parent / "fixtures"

from print import slicer as print_slicer  # noqa: E402
from print.slicer import SliceError, build_command, part_info, read_summary, slice_stl, stl_bounds  # noqa: E402


def make_archive(path, gcode_header=True, slice_info=True):
    with zipfile.ZipFile(path, "w") as zf:
        if gcode_header:
            zf.writestr("Metadata/plate_1.gcode", (FIXTURES / "plate_1_header.gcode").read_text())
        if slice_info:
            zf.writestr("Metadata/slice_info.config", (FIXTURES / "slice_info.config").read_text())
        zf.writestr("[Content_Types].xml", "<Types/>")


def fake_run_factory(returncode=0, write_archive=True, write_result_json=True, stdout="log line\n", raise_timeout=False):
    """Return a stand-in for subprocess.run that behaves like Orca's exit."""
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append((cmd, kwargs))
        if raise_timeout:
            raise subprocess.TimeoutExpired(cmd, kwargs.get("timeout"))
        outdir = Path(cmd[cmd.index("--outputdir") + 1])
        name = cmd[cmd.index("--export-3mf") + 1]
        if write_archive:
            make_archive(outdir / name)
        if write_result_json:
            shutil.copy(FIXTURES / "result.json", outdir / "result.json")
        return subprocess.CompletedProcess(cmd, returncode, stdout=stdout, stderr="")

    fake_run.calls = calls
    return fake_run


class CommandTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="print-slicer-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.out = self.tmp / "out"

    def test_command_uses_fixed_binary_profiles_and_flags(self):
        cmd = build_command(print_slicer.SAMPLE_STL, self.out)
        self.assertEqual(Path(cmd[0]), print_slicer.ORCA_BIN)
        self.assertTrue(str(print_slicer.ORCA_BIN).endswith("tools/orca/orca-slicer"))
        self.assertIn("--load-settings", cmd)
        settings = cmd[cmd.index("--load-settings") + 1]
        self.assertEqual(settings, f"{print_slicer.PROFILE_DIR / 'printer.json'};{print_slicer.PROFILE_DIR / 'process.json'}")
        self.assertEqual(cmd[cmd.index("--load-filaments") + 1], str(print_slicer.PROFILE_DIR / "filament.json"))
        self.assertEqual(cmd[cmd.index("--arrange") + 1], "1")
        self.assertEqual(cmd[cmd.index("--slice") + 1], "0")
        self.assertEqual(cmd[cmd.index("--export-3mf") + 1], "sample_part.gcode.3mf")
        self.assertEqual(cmd[cmd.index("--outputdir") + 1], str(self.out))
        self.assertEqual(cmd[cmd.index("--datadir") + 1], str(self.out / "datadir"))
        self.assertEqual(cmd[-1], str(print_slicer.SAMPLE_STL))

    def test_slice_creates_output_dir_and_isolated_xdg_environment(self):
        fake = fake_run_factory()
        with mock.patch.object(print_slicer.subprocess, "run", fake):
            result = slice_stl(print_slicer.SAMPLE_STL, self.out)
        self.assertTrue(self.out.is_dir())
        cmd, kwargs = fake.calls[0]
        env = kwargs["env"]
        self.assertEqual(env["XDG_CONFIG_HOME"], str(self.out / "xdg-config"))
        self.assertEqual(env["XDG_RUNTIME_DIR"], str(self.out / "xdg-runtime"))
        self.assertEqual(env["LC_ALL"], "C")
        self.assertTrue((self.out / "xdg-runtime").is_dir())
        self.assertEqual(oct((self.out / "xdg-runtime").stat().st_mode & 0o777), "0o700")
        self.assertEqual(kwargs["timeout"], 120)
        self.assertEqual(result.output_path, self.out / "sample_part.gcode.3mf")

    def test_summary_from_archive_and_result_json(self):
        fake = fake_run_factory()
        with mock.patch.object(print_slicer.subprocess, "run", fake):
            result = slice_stl(print_slicer.SAMPLE_STL, self.out)
        self.assertEqual(result.print_time_s, 790.0)
        self.assertEqual(result.filament_g, 3.31)
        self.assertEqual(result.filament_m, 1.09)
        self.assertEqual(result.layer_count, 50)
        self.assertEqual(result.warnings, [])
        self.assertEqual(result.summary(), {"print_time_s": 790.0, "filament_m": 1.09, "filament_g": 3.31,
                                            "layer_count": 50, "warnings": []})

    def test_warnings_come_from_result_json(self):
        fake = fake_run_factory(write_result_json=False)
        with mock.patch.object(print_slicer.subprocess, "run", fake):
            result = slice_stl(print_slicer.SAMPLE_STL, self.out)
        self.assertEqual(result.warnings, [])   # macOS writes no result.json
        self.out.mkdir(exist_ok=True)
        make_archive(self.out / "x.gcode.3mf")
        data = json.loads((FIXTURES / "result.json").read_text())
        data["sliced_plates"][0]["warning_message"] = "Object is out of the bed"
        (self.out / "result.json").write_text(json.dumps(data))
        summary = read_summary(self.out / "x.gcode.3mf", self.out)
        self.assertEqual(summary["warnings"], ["Object is out of the bed"])

    def test_nonzero_exit_raises_with_last_twenty_lines(self):
        stdout = "".join(f"line {i}\n" for i in range(30))
        fake = fake_run_factory(returncode=255, write_archive=False, stdout=stdout)
        with mock.patch.object(print_slicer.subprocess, "run", fake):
            with self.assertRaises(SliceError) as ctx:
                slice_stl(print_slicer.SAMPLE_STL, self.out)
        self.assertNotIn("line 9\n", ctx.exception.details + "\n")
        self.assertIn("line 10", ctx.exception.details)
        self.assertIn("line 29", ctx.exception.details)
        self.assertEqual(len(ctx.exception.details.splitlines()), 20)
        self.assertTrue(ctx.exception.message.endswith("."))
        self.assertNotIn("line 29", ctx.exception.message)

    def test_timeout_raises_student_message(self):
        fake = fake_run_factory(raise_timeout=True)
        with mock.patch.object(print_slicer.subprocess, "run", fake):
            with self.assertRaises(SliceError) as ctx:
                slice_stl(print_slicer.SAMPLE_STL, self.out, timeout_s=7)
        self.assertEqual(ctx.exception.message, "The slicer took too long on this part.")
        self.assertEqual(fake.calls[0][1]["timeout"], 7)

    def test_missing_archive_after_exit_zero_raises(self):
        fake = fake_run_factory(returncode=0, write_archive=False)
        with mock.patch.object(print_slicer.subprocess, "run", fake):
            with self.assertRaises(SliceError) as ctx:
                slice_stl(print_slicer.SAMPLE_STL, self.out)
        self.assertIn("no output", ctx.exception.message.lower())

    def test_archive_without_gcode_entry_names_contents(self):
        self.out.mkdir()
        make_archive(self.out / "p.gcode.3mf", gcode_header=False)
        with self.assertRaises(SliceError) as ctx:
            read_summary(self.out / "p.gcode.3mf", self.out)
        self.assertIn("Metadata/slice_info.config", ctx.exception.details)
        self.assertIn("[Content_Types].xml", ctx.exception.details)

    def test_missing_summary_fields_are_none(self):
        self.out.mkdir()
        make_archive(self.out / "p.gcode.3mf", slice_info=False)
        summary = read_summary(self.out / "p.gcode.3mf", self.out)
        self.assertIsNone(summary["print_time_s"])
        self.assertIsNone(summary["filament_g"])
        self.assertIsNone(summary["filament_m"])
        self.assertEqual(summary["layer_count"], 50)


class PartInfoTest(unittest.TestCase):
    def test_bounds_of_binary_stl(self):
        tri = struct.pack("<12fH", 0, 0, 1, 0, 0, 0, 3, 0, 0, 0, 5, 0, 0)
        tri2 = struct.pack("<12fH", 0, 0, 1, -1, 0, 2, 3, 0, 0, 0, 5, 0, 0)
        data = b"\0" * 80 + struct.pack("<I", 2) + tri + tri2
        lo, hi, count = stl_bounds(data)
        self.assertEqual((lo, hi, count), ((-1.0, 0.0, 0.0), (3.0, 5.0, 2.0), 2))

    def test_bounds_of_ascii_stl(self):
        text = ("solid t\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 10 0 0\n"
                "   vertex 0 20 5\n  endloop\n endfacet\nendsolid t\n")
        lo, hi, count = stl_bounds(text.encode())
        self.assertEqual((lo, hi, count), ((0.0, 0.0, 0.0), (10.0, 20.0, 5.0), 1))

    def test_part_info_reads_sample_part_and_profiles(self):
        info = part_info()
        self.assertEqual(info["part"]["name"], "sample_part")
        self.assertEqual(info["part"]["file"], "sample_part.stl")
        self.assertEqual(info["part"]["size_mm"], {"x": 40.0, "y": 30.0, "z": 12.0})
        self.assertEqual(info["part"]["triangles"], 20)
        self.assertEqual(info["printer"]["name"], "Bambu Lab X1 Carbon 0.4 nozzle")
        self.assertEqual(info["printer"]["bed_mm"], {"x": 256.0, "y": 256.0})
        self.assertEqual(info["printer"]["height_mm"], 250.0)
        self.assertEqual(info["filament"]["name"], "Bambu PLA Basic @BBL X1C")
        self.assertEqual(info["process"]["name"], "0.20mm Standard @BBL X1C")
        self.assertEqual(info["process"]["layer_height_mm"], 0.2)


class ProfileFilesTest(unittest.TestCase):
    REQUIRED = {
        "printer.json": ("name", "printable_area", "printable_height"),
        "filament.json": ("name", "filament_density", "compatible_printers"),
        "process.json": ("name", "layer_height", "compatible_printers"),
    }

    def test_profiles_are_flat_and_carry_required_keys(self):
        for fname, keys in self.REQUIRED.items():
            data = json.loads((print_slicer.PROFILE_DIR / fname).read_text())
            self.assertEqual(data.get("inherits"), "", fname)
            self.assertEqual(data.get("from"), "system", fname)
            for key in keys:
                self.assertIn(key, data, f"{fname} lacks {key}")

    def test_process_and_filament_are_compatible_with_the_printer(self):
        printer = json.loads((print_slicer.PROFILE_DIR / "printer.json").read_text())["name"]
        for fname in ("filament.json", "process.json"):
            data = json.loads((print_slicer.PROFILE_DIR / fname).read_text())
            self.assertIn(printer, data["compatible_printers"], fname)


class ImportGuardTest(unittest.TestCase):
    def test_import_fails_without_binary(self):
        with mock.patch.object(Path, "is_file", return_value=False):
            with self.assertRaises(RuntimeError) as ctx:
                print_slicer._require_binary()
        self.assertIn("make install", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python -m unittest tests.test_print_slicer -v`
Expected: `ModuleNotFoundError: No module named 'print_slicer'`.

- [ ] **Step 4: Write `print/slicer.py`**

```python
"""Run Orca Slicer's command line on an STL and read back a slice summary.

Flask-free. Orca lives at the fixed path tools/orca/orca-slicer (installed by
print/scripts/install-orca.sh); there is no environment variable and no PATH lookup.
The profiles are the fixed set in print/profiles/. See docs/3D_PRINTING.md.
"""
import json
import os
import re
import struct
import subprocess
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

PKG = Path(__file__).resolve().parent      # the print/ directory
REPO = PKG.parent
ORCA_BIN = REPO / "tools" / "orca" / "orca-slicer"
PROFILE_DIR = PKG / "profiles"
SAMPLE_STL = PKG / "sample_part.stl"
DEFAULT_TIMEOUT_S = 120
ARCHIVE_SUFFIX = ".gcode.3mf"
GCODE_ENTRY = "Metadata/plate_1.gcode"
SLICE_INFO_ENTRY = "Metadata/slice_info.config"
DETAIL_LINES = 20


def _require_binary():
    if not ORCA_BIN.is_file():
        raise RuntimeError(f"Orca Slicer is missing at {ORCA_BIN}; run `make install`")


_require_binary()


class SliceError(Exception):
    """A slice that produced no usable archive.

    `message` is one sentence fit for the student; `details` is the last
    twenty lines of Orca's output (or the archive listing) for the server log.
    """

    def __init__(self, message, details=""):
        super().__init__(message)
        self.message = message
        self.details = details


@dataclass
class SliceResult:
    output_path: Path
    print_time_s: float | None
    filament_m: float | None
    filament_g: float | None
    layer_count: int | None
    warnings: list = field(default_factory=list)

    def summary(self):
        return {"print_time_s": self.print_time_s, "filament_m": self.filament_m,
                "filament_g": self.filament_g, "layer_count": self.layer_count,
                "warnings": list(self.warnings)}


def build_command(stl_path, output_dir):
    stl_path = Path(stl_path)
    output_dir = Path(output_dir)
    archive_name = stl_path.stem + ARCHIVE_SUFFIX
    return [
        str(ORCA_BIN),
        "--datadir", str(output_dir / "datadir"),
        "--load-settings", f"{PROFILE_DIR / 'printer.json'};{PROFILE_DIR / 'process.json'}",
        "--load-filaments", str(PROFILE_DIR / "filament.json"),
        "--arrange", "1",
        "--slice", "0",
        "--export-3mf", archive_name,
        "--outputdir", str(output_dir),
        str(stl_path),
    ]


def _tail(text, n=DETAIL_LINES):
    return "\n".join(text.splitlines()[-n:])


def slice_stl(stl_path, output_dir, timeout_s=DEFAULT_TIMEOUT_S):
    """Slice `stl_path` into `output_dir/<stem>.gcode.3mf` and return a SliceResult."""
    stl_path = Path(stl_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    config_home = output_dir / "xdg-config"
    runtime_dir = output_dir / "xdg-runtime"
    config_home.mkdir(exist_ok=True)
    runtime_dir.mkdir(exist_ok=True)
    os.chmod(runtime_dir, 0o700)
    env = dict(os.environ)
    env.update({"XDG_CONFIG_HOME": str(config_home), "XDG_RUNTIME_DIR": str(runtime_dir), "LC_ALL": "C"})
    cmd = build_command(stl_path, output_dir)
    try:
        proc = subprocess.run(cmd, env=env, cwd=str(output_dir), capture_output=True, text=True,
                              timeout=timeout_s, stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired as exc:
        raise SliceError("The slicer took too long on this part.",
                         _tail((exc.stdout or b"").decode(errors="replace") if isinstance(exc.stdout, bytes) else (exc.stdout or "")))
    output = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode != 0:
        raise SliceError("The slicer could not process this part.",
                         f"exit code {proc.returncode}\n" + _tail(output))
    archive = output_dir / (stl_path.stem + ARCHIVE_SUFFIX)
    if not archive.is_file():
        raise SliceError("The slicer produced no output file.", _tail(output))
    summary = read_summary(archive, output_dir)
    return SliceResult(output_path=archive, **summary)


def _float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def read_summary(archive_path, output_dir):
    """Read print time, filament and layer count from the archive and result.json."""
    with zipfile.ZipFile(archive_path) as zf:
        names = zf.namelist()
        if GCODE_ENTRY not in names:
            raise SliceError("The slicer output is missing its G-code.",
                             "archive entries:\n" + "\n".join(names))
        gcode_head = zf.read(GCODE_ENTRY)[:4096].decode("utf-8", errors="replace")
        info = zf.read(SLICE_INFO_ENTRY).decode("utf-8", errors="replace") if SLICE_INFO_ENTRY in names else ""

    def meta(key):
        m = re.search(r'<metadata key="%s" value="([^"]*)"' % re.escape(key), info)
        return _float(m.group(1)) if m else None

    used_m = None
    m = re.search(r'<filament [^>]*used_m="([^"]*)"', info)
    if m:
        used_m = _float(m.group(1))
    layers = None
    m = re.search(r"^; total layer number: (\d+)", gcode_head, re.M)
    if m:
        layers = int(m.group(1))

    warnings = []
    result_json = Path(output_dir) / "result.json"
    if result_json.is_file():
        try:
            data = json.loads(result_json.read_text(encoding="utf-8"))
            for plate in data.get("sliced_plates", []):
                text = (plate.get("warning_message") or "").strip()
                if text:
                    warnings.append(text)
        except (ValueError, OSError):
            pass

    return {"print_time_s": meta("prediction"), "filament_g": meta("weight"),
            "filament_m": used_m, "layer_count": layers, "warnings": warnings}


def stl_bounds(data):
    """Return (min_corner, max_corner, triangle_count) of a binary or ASCII STL."""
    is_binary = len(data) >= 84 and len(data) == 84 + 50 * struct.unpack("<I", data[80:84])[0] \
        and not data[:5].lower().startswith(b"solid")
    if not is_binary and len(data) >= 84 and len(data) == 84 + 50 * struct.unpack("<I", data[80:84])[0]:
        is_binary = True   # a binary file whose header happens to start with "solid"
    vertices = []
    if is_binary:
        count = struct.unpack("<I", data[80:84])[0]
        for i in range(count):
            rec = struct.unpack("<12fH", data[84 + i * 50: 84 + (i + 1) * 50])
            vertices.extend((rec[3:6], rec[6:9], rec[9:12]))
    else:
        text = data.decode("utf-8", errors="replace")
        for m in re.finditer(r"vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)", text):
            vertices.append(tuple(float(v) for v in m.groups()))
        count = len(vertices) // 3
    if not vertices:
        raise ValueError("STL has no triangles")
    lo = tuple(min(v[i] for v in vertices) for i in range(3))
    hi = tuple(max(v[i] for v in vertices) for i in range(3))
    return lo, hi, count


def _load_profile(name):
    with open(PROFILE_DIR / name, encoding="utf-8") as fh:
        return json.load(fh)


def _bed_size(printer):
    corners = []
    for corner in printer.get("printable_area", []):
        x, y = corner.lower().split("x")
        corners.append((float(x), float(y)))
    if not corners:
        return {"x": None, "y": None}
    return {"x": max(c[0] for c in corners) - min(c[0] for c in corners),
            "y": max(c[1] for c in corners) - min(c[1] for c in corners)}


def part_info(stl_path=SAMPLE_STL):
    """Names and numbers the print wizard shows before slicing."""
    stl_path = Path(stl_path)
    lo, hi, count = stl_bounds(stl_path.read_bytes())
    printer = _load_profile("printer.json")
    filament = _load_profile("filament.json")
    process = _load_profile("process.json")
    return {
        "part": {"name": stl_path.stem, "file": stl_path.name,
                 "size_mm": {"x": round(hi[0] - lo[0], 3), "y": round(hi[1] - lo[1], 3), "z": round(hi[2] - lo[2], 3)},
                 "triangles": count},
        "printer": {"name": printer.get("name"), "bed_mm": _bed_size(printer),
                    "height_mm": _float(printer.get("printable_height"))},
        "filament": {"name": filament.get("name")},
        "process": {"name": process.get("name"), "layer_height_mm": _float(process.get("layer_height"))},
    }
```

Simplify the `is_binary` detection if you can express it more clearly; the behaviour to keep is: a file whose length equals `84 + 50 * count` is binary, otherwise it is parsed as ASCII.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python -m unittest tests.test_print_slicer -v`
Expected: 15 tests `OK`. The `ImportGuardTest` patches `Path.is_file` only inside the call to `_require_binary`, so the module import at the top still works.

- [ ] **Step 6: Run the quick suite and commit**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python -m unittest discover -s tests --buffer && uv run python -m unittest discover -s print/tests -t . --buffer && uv run python gcode_test.py --quiet`
Expected: all pass. Commit `print/slicer.py`, `print/tests/test_slicer.py`, `print/tests/fixtures/*` with message `print(b): add print_slicer wrapper around Orca's command line`.

---

### Task 4: Real-slice integration test and profile drift check

**Files:**
- Modify: `print/tests/orca_integration_test.py` (append two classes)

**Interfaces:**
- Consumes: `print_slicer.slice_stl`, `print_slicer.SAMPLE_STL`, `scripts/flatten_orca_profiles.write_profiles`, `bbl_profile_dir`, `PROFILE_SOURCES`.
- Produces: nothing new; `make test` now exercises the real slicer.

- [ ] **Step 1: Append the tests**

Append to `print/tests/orca_integration_test.py` (keep the existing `OrcaInstalledTest` and its imports; add the imports below at the top if missing):

```python
import filecmp
import shutil
import sys
import tempfile
import time
import zipfile

sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "print" / "scripts"))

from print.slicer import SAMPLE_STL, PROFILE_DIR, slice_stl  # noqa: E402
from flatten_orca_profiles import bbl_profile_dir, write_profiles  # noqa: E402


class RealSliceTest(unittest.TestCase):
    """Slices the fixed sample part with the pinned Orca. Slow by design."""

    def test_sample_part_slices_to_a_valid_archive(self):
        out = Path(tempfile.mkdtemp(prefix="orca-slice-"))
        self.addCleanup(shutil.rmtree, out, ignore_errors=True)
        started = time.monotonic()
        result = slice_stl(SAMPLE_STL, out)
        elapsed = time.monotonic() - started
        print(f"\n[orca] sliced {SAMPLE_STL.name} in {elapsed:.1f} s")
        self.assertEqual(result.output_path, out / "sample_part.gcode.3mf")
        self.assertTrue(zipfile.is_zipfile(result.output_path))
        with zipfile.ZipFile(result.output_path) as zf:
            names = zf.namelist()
        self.assertIn("Metadata/plate_1.gcode", names)
        self.assertIn("Metadata/slice_info.config", names)
        self.assertGreater(result.print_time_s, 0)
        self.assertGreater(result.filament_g, 0)
        self.assertGreater(result.filament_m, 0)
        self.assertGreater(result.layer_count, 0)
        self.assertEqual(result.layer_count, 60)   # 12 mm at 0.2 mm layers
        self.assertEqual(result.warnings, [])


class ProfileDriftTest(unittest.TestCase):
    """The checked-in profiles must equal what the flattening script produces
    from the installed Orca, so an Orca upgrade forces a regeneration."""

    def test_checked_in_profiles_match_installed_orca(self):
        out = Path(tempfile.mkdtemp(prefix="orca-profiles-"))
        self.addCleanup(shutil.rmtree, out, ignore_errors=True)
        write_profiles(bbl_profile_dir(), out)
        for name in ("printer.json", "filament.json", "process.json"):
            self.assertTrue(filecmp.cmp(out / name, PROFILE_DIR / name, shallow=False),
                            f"{name} differs from the installed Orca's profile tree; "
                            f"run `uv run python print/scripts/flatten_orca_profiles.py`")
```

- [ ] **Step 2: Run the integration module**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python -m unittest print.tests.orca_integration_test -v`
Expected: 4 tests `OK`, with a printed `[orca] sliced sample_part.stl in N s` line. If the layer count is not 60, print the actual value in the report and change the assertion to the observed value only if the G-code header's `; total layer number` agrees and `; max_z_height: 12.00` is present (Orca may add or drop a layer at the top depending on the first layer height); explain in the report.

- [ ] **Step 3: Run the full suite and commit**

Run: `cd /repos/popcornpenguins/PenguinCAM && make test`
Expected: quick suite, system tests and the integration module all pass. Commit `print/tests/orca_integration_test.py` with message `print(b): slice the sample part for real in make test`.

---

## Self-review

- Spec coverage: flattening script following `inherits`, `from: system`, empty `inherits` (Task 1); `print/README.md` with source names and the command (Task 1); sample STL binary, mm, under 60 mm (Task 2); `slice_stl` signature, output naming, output dir creation, command line, XDG isolation, success = exit code + archive, `SliceResult` fields, `SliceError` message and details (Task 3); summary sources and `None` for missing fields (Task 3); warnings from `result.json`, empty on macOS (Task 3); `part_info()` with parsed bed size (Task 3); import-time binary check naming `make install` (Task 3); unit test for profile keys and empty `inherits` (Task 3); integration test slicing the sample and the regeneration check, logging wall-clock (Task 4). `--datadir` is an addition confirmed against the 2.4.2 command line (`--datadir` "Load and store settings at the given directory"); it settles spec section 10 item 3 for macOS, where `XDG_CONFIG_HOME` is ignored.
- Placeholders: none.
- Names: `flatten_profile`, `write_profiles`, `bbl_profile_dir`, `PROFILE_SOURCES` (Task 1) match Task 4's imports; `slice_stl`, `SAMPLE_STL`, `PROFILE_DIR`, `read_summary`, `build_command`, `stl_bounds`, `part_info`, `_require_binary` (Task 3) match the tests.
