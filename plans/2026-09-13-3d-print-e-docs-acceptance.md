# 3D Print Stage 1, Subfeature E: CI, Documentation and Acceptance Implementation Plan

> **Paths updated 2026-09-13:** the print path moved into the top-level `print/`
> package after this document was written. File paths and imports below were
> rewritten to match; the design and the task order are unchanged. See
> [3D_PRINTING.md](https://github.com/6238/PenguinCAM/blob/main/docs/3D_PRINTING.md) for the current layout.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document the print path for developers and deployers, record the answers to the spec's open facts, and prove the feature end to end in a real browser against the development server.

**Architecture:** Documentation only in Tasks 1 and 2 (CI was already updated in subfeature A). Task 3 is the Playwright acceptance run from spec section 11, driven with `playwright-cli` against the server started per the workspace `CLAUDE.md`, with screenshots kept in the scratchpad.

**Tech Stack:** Markdown (real links between docs, Mermaid for diagrams, no ASCII art), `playwright-cli`, the Flask dev server.

**Spec:** `docs/superpowers/specs/2026-09-13-3d-print-slicing-design.md`, sections 10 (facts), 11 (build notes and acceptance), 12 (documentation).

## Global Constraints

- Markdown cross-references between files in this repository are real links: `[3D_PRINTING.md](docs/3D_PRINTING.md)`, never bare code spans.
- Diagrams are ```` ```mermaid ```` fences, `flowchart TB`, no `%%{init}%%`, short node text.
- Facts to record, all established 2026-09-13 in the aarch64 agent container unless stated:
  - Debian 13 (trixie) package names for Orca's directly linked libraries are identical on amd64 and arm64 (resolved from the trixie `Contents-amd64` and `Contents-arm64` indexes): `libatk1.0-0t64 libc6 libcairo-gobject2 libcairo2 libdbus-1-3 libegl1 libexpat1 libfontconfig1 libgcc-s1 libgdk-pixbuf-2.0-0 libgl1 libglib2.0-0t64 libglu1-mesa libglx0 libgstreamer-plugins-base1.0-0 libgstreamer1.0-0 libgtk-3-0t64 libharfbuzz0b libice6 libjavascriptcoregtk-4.1-0 liblzma5 libmspack0t64 libopengl0 libpango-1.0-0 libpangocairo-1.0-0 libpangoft2-1.0-0 libsecret-1-0 libsm6 libsoup-3.0-0 libstdc++6 libwayland-client0 libwayland-egl1 libwayland-server0 libwebkit2gtk-4.1-0 libx11-6 libxext6 libxkbcommon0 zlib1g`. The Dockerfile's `ldd` check could not be run in the agent container (no Docker daemon); it runs on the first Railway build.
  - One slice of the sample part: peak resident memory 93 MB, 0.23 s wall clock, 117% CPU, on aarch64 (`/usr/bin/time -v`). An x86-64 measurement was not possible (no x86-64 machine reachable). The Railway plan's vCPU and memory allotment could not be read (no Railway token in the build environment). Pool size therefore stays at the spec default: `MAX_RUNNING = 1`, `MAX_QUEUED = 2` in `print/jobs.py`. Rule for revisiting: `min(vCPU, memory / peak resident of one slice)`, never below one.
  - macOS: `curl` downloads carry no quarantine attribute, and the install script clears `com.apple.quarantine` recursively on the copied app bundle anyway; the macOS command line ignores `XDG_CONFIG_HOME`, so `print/slicer.py` also passes `--datadir <scratch>/datadir` (an option of the 2.4.2 command line: "Load and store settings at the given directory"). A headless slice on Linux 2.4.2 wrote nothing into either directory. The macOS build was not executed in this session (no Mac in the loop); the macOS path of the install script is untested until the owner runs `make install` on the Mac.
  - Thumbnails: the archive produced headless contains no thumbnail images. Whether the team's Bambu printer and the Bambu apps accept a `.gcode.3mf` without thumbnails is unverified; the acceptance step for that is loading the produced file on the printer.
  - Vercel is unsupported from this stage on (no Orca binary in the serverless build, 60-second function limit); `app.py`, `vercel.json` stay untouched.
  - CI (`.github/workflows/integration.yaml`) installs Orca with `print/scripts/install-orca.sh` (unprivileged path on the runner) and runs `make test`.
- Commit each task on branch `feature/3d-print-stage1` with a message starting `print(e): `. Never touch `main`, never push. Never commit `tools/` or `.superpowers/`.
- Run `make test-quick` before each commit; `make test` at the end of Task 2.

---

### Task 1: `docs/3D_PRINTING.md` and `print/README.md` link

**Files:**
- Create: `docs/3D_PRINTING.md`
- Test: none (documentation); verify links resolve with the command in Step 2.

**Interfaces:**
- Consumes: the code as built (`print/scripts/install-orca.sh`, `print/scripts/flatten_orca_profiles.py`, `print/slicer.py`, `print/jobs.py`, `print/routes.py`, `print/static/print_wizard.js`, `print/static/print_viewer.js`).
- Produces: the developer guide other docs link to.

- [ ] **Step 1: Write the guide**

`docs/3D_PRINTING.md` with these sections, each written from the code (read the files; do not guess):

1. **What stage 1 does**: one fixed part, one fixed Bambu Lab profile set, Orca Slicer's command line, a separate wizard page. Link the spec: `[design spec](superpowers/specs/2026-09-13-3d-print-slicing-design.md)`.
2. **Architecture**: a `flowchart TB` Mermaid diagram: Setup radio → `/print` page → `/print/part`, `POST /print-job` → `print/jobs.py` pool → `print/slicer.py` → `tools/orca/orca-slicer` → `.gcode.3mf` → token manager → `/download/<token>` and `/drive/upload/<token>`; and `GET /print-job/<id>/events` from the page to the pool.
3. **Orca Slicer, the fixed location**: `tools/orca/orca-slicer`, never configurable; `print/scripts/install-orca.sh` holds the version (2.4.2) and checksums; platforms and assets; the Linux wrapper (no `AppRun`, `APPDIR`, `LC_ALL=C`, `LD_LIBRARY_PATH`); `tools/orca/VERSION`; the unprivileged `hostlibs` path and how it verifies packages; the Dockerfile's package list (from Global Constraints) and `ldd` check; glibc 2.38 requirement; `make install` and `make install-orca`.
4. **Profiles**: why exported profiles do not work (chains, defaults, `from: User` and return code -17), `print/scripts/flatten_orca_profiles.py` (algorithm, dropped keys, output format), the three source names, the regeneration command, the two guarding tests.
5. **Sample part**: `print/sample_part.stl`, `print/scripts/make_sample_part.py`, dimensions.
6. **`print/slicer.py`**: the command line verbatim from `build_command`, the XDG and `--datadir` isolation, success criteria, `SliceResult` fields and where each comes from (table), `SliceError`, `part_info()`.
7. **Job pool**: constants and their basis (from Global Constraints), states, ids, expiry, subscribers, the worker's scratch and cleanup.
8. **Routes**: table of the five routes with method, gate, rate limit, responses; the `return` validation and `verify=1` redirect; the SSE event format with one example block.
9. **Frontend**: the two layouts, `print_wizard.js` responsibilities (including the polling fallback), `print_viewer.js`, the two touches to the CNC wizard, `window.PenguinCAM` fields on the print page.
10. **macOS differences**: from Global Constraints (quarantine, `--datadir`, no `result.json` so warnings are empty, untested in this session).
11. **Testing**: `make test-quick` vs `make test`, the test files table from spec section 9 plus `print/tests/test_install_orca.py`, `print/tests/test_flatten_orca_profiles.py`, `print/tests/test_make_sample_part.py`, `print/tests/test_js_units.py` (node), `print/tests/test_wizard_page.py`; CI.
12. **Open items and later stages**: thumbnails unverified on the printer; Railway pool sizing pending measurement; macOS install untested; then the later stages list from spec section 2.

Keep sentences short. Every reference to another Markdown file is a link.

- [ ] **Step 2: Check the links and the Mermaid fence**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python - <<'EOF'
import re, pathlib
doc = pathlib.Path('docs/3D_PRINTING.md')
text = doc.read_text()
for m in re.finditer(r'\]\(([^)#]+)(#[^)]*)?\)', text):
    target = m.group(1)
    if target.startswith('http'): continue
    assert (doc.parent / target).exists(), f'broken link: {target}'
assert text.count('```mermaid') >= 1
print('links ok')
EOF`
Expected: `links ok`. Then render the diagram: `open docs/3D_PRINTING.md` opens it in the Mac browser if available; otherwise check the fence parses with `npx -y @mermaid-js/mermaid-cli -i /dev/stdin -o /tmp/out.svg` only if that tool is available (it is optional; report if not run).

- [ ] **Step 3: Quick suite and commit**

Run: `cd /repos/popcornpenguins/PenguinCAM && make test-quick`
Expected: pass. Commit `docs/3D_PRINTING.md` with message `print(e): developer guide for the print path`.

---

### Task 2: `CLAUDE.md`, `README.md`, `docs/DEPLOYMENT_GUIDE.md`

**Files:**
- Modify: `CLAUDE.md` (Development Commands, Development Rules, Documentation table, Architecture key files)
- Modify: `README.md` (the `## 2.0 (in progress)` section)
- Modify: `docs/DEPLOYMENT_GUIDE.md`

**Interfaces:**
- Consumes: `docs/3D_PRINTING.md` (Task 1).

- [ ] **Step 1: `CLAUDE.md`**

- In "Development Commands": after `make install`, add a comment that it also installs Orca Slicer into `tools/orca/` (pinned in `print/scripts/install-orca.sh`); replace the single `make test` bullet with both: `make test-quick` (unit, system and node tests, no slicer) and `make test` (everything plus the real Orca slice; the gate before a change is done).
- In "Development Rules": `make test` stays the gate; `make test-quick` is for iteration.
- In "Architecture": add the print path (`print/routes.py`, `print/jobs.py`, `print/slicer.py`, `print/templates/print_wizard.html`, `print/static/print_wizard.js`, `print/static/print_viewer.js`, `print/`) to the key files list, one line each.
- In the Documentation table add: `| [3D_PRINTING.md](docs/3D_PRINTING.md) | Changing the print wizard, the slicer wrapper, the job pool, or the Orca install |`. Convert the other rows' file names in that table to links too (`[Z_COORDINATE_SYSTEM.md](docs/Z_COORDINATE_SYSTEM.md)`, etc.); leave the row for `TOOL_COMPENSATION_GUIDE.md` as plain text with a note that the file does not exist yet.

- [ ] **Step 2: `README.md`**

In the `## 2.0 (in progress)` list add a bullet: `**3D Printing (stage 1):** a "3D Printing" mode on Setup opens a print wizard that slices a fixed sample part with Orca Slicer for the team's Bambu Lab printer, shows print time, filament and layers, and delivers a .gcode.3mf through the same Download / Drive button. See [docs/3D_PRINTING.md](docs/3D_PRINTING.md).` and in the "Key files" sentence add the print files. Add `make install` installs Orca Slicer, and `make test-quick` for iteration, near the existing `make test` mention. If the README mentions Vercel deployment, add one sentence that Vercel is unsupported from this stage (Railway, built from the Dockerfile, is the target).

- [ ] **Step 3: `docs/DEPLOYMENT_GUIDE.md`**

Add a section `## Orca Slicer and the Docker build` (before Troubleshooting) covering: Railway builds from the `Dockerfile` (its `CMD` is what production runs; the `Procfile` is kept in step); the build downloads Orca 2.4.2 with `print/scripts/install-orca.sh` into `tools/orca/` and installs the runtime packages listed in the Dockerfile; the `ldd` check fails the build if a library is missing; the base image pin `python:3.11-slim-trixie` and why; gunicorn `--worker-class gthread --threads 16` with one worker and why workers stay at one; the pool constants and the measured numbers and the rule (from Global Constraints), including that the Railway plan's allotment still has to be read from the Railway dashboard and the constant revisited; the deployment-wide 3-per-minute cap on `/print-job` behind the proxy; Vercel unsupported. Update the "Configure Build" step if it says Railway uses the Procfile: Railway uses the Dockerfile when one is present. Link `[3D_PRINTING.md](3D_PRINTING.md)`.

- [ ] **Step 4: Verify links, run the full suite, commit**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python - <<'EOF'
import re, pathlib
for name in ('CLAUDE.md', 'README.md', 'docs/DEPLOYMENT_GUIDE.md'):
    doc = pathlib.Path(name)
    for m in re.finditer(r'\]\(([^)#]+)(#[^)]*)?\)', doc.read_text()):
        t = m.group(1)
        if t.startswith(('http', 'mailto')): continue
        assert (doc.parent / t).exists(), f'{name}: broken link {t}'
print('links ok')
EOF
make test`
Expected: `links ok`; `make test` passes. Commit the three files with message `print(e): document the print stage, commands and deployment changes`.

---

### Task 3: Playwright acceptance against the real development server

**Files:**
- Create (scratchpad, not committed): screenshots under `/tmp/claude-1000/-repos-popcornpenguins/a71de3b1-8dec-4dbd-bc44-bd3526acf5df/scratchpad/acceptance/`; the server log at `/tmp/claude-1000/-repos-popcornpenguins/a71de3b1-8dec-4dbd-bc44-bd3526acf5df/scratchpad/server.log`.
- Modify: nothing unless a defect is found; a defect is fixed in the file that owns it, with a test, then the automated tests and the acceptance step rerun.

This task is run by the orchestrator's acceptance subagent; see the spec's section 11 for the nine steps and the workspace `CLAUDE.md` for starting the server (`EMBED_COOKIES=1 uv run python frc_cam_gui_app.py`, port 6238, background with output teed to the log, three verification checks). The subagent records, per step, pass or fail with evidence (the snapshot text or the screenshot path), and for the download step verifies the file is a zip containing `Metadata/plate_1.gcode` with Python's `zipfile`.

- [ ] **Step 1: Start the server and verify it** (per workspace `CLAUDE.md`).
- [ ] **Step 2: Steps 1 to 8 with `?source=upload`**, screenshots at steps 2, 4, 5.
- [ ] **Step 3: Step 9 with `?source=onshape&theme=dark`**, screenshots at steps 2, 4, 5 again.
- [ ] **Step 4: Report** pass/fail per step with paths.

---

## Self-review

- Spec section 12 coverage: CLAUDE.md (Task 2), README (Task 2), 3D_PRINTING.md (Task 1), DEPLOYMENT_GUIDE.md (Task 2). Section 10 facts recorded in 3D_PRINTING.md and DEPLOYMENT_GUIDE.md (Tasks 1, 2). Section 11 acceptance (Task 3). CI was done in subfeature A and is described in the docs.
- Placeholders: the documentation tasks describe content by section rather than reproducing final prose, which is intended: the writer reads the code as built.
