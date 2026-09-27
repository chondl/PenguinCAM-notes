# 3D Print Stage 1, Subfeature A: Orca Install Implementation Plan

> **Paths updated 2026-09-13:** the print path moved into the top-level `print/`
> package after this document was written. File paths and imports below were
> rewritten to match; the design and the task order are unchanged. See
> [3D_PRINTING.md](https://github.com/6238/PenguinCAM/blob/main/docs/3D_PRINTING.md) for the current layout.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install Orca Slicer 2.4.2 at the fixed path `tools/orca/orca-slicer` on Linux x86-64, Linux aarch64 and macOS arm64, with root or without, from one idempotent script that the Makefile, the Dockerfile and CI all run.

**Architecture:** `print/scripts/install-orca.sh` is the only place the Orca version and checksums live. It picks the release asset from `uname`, verifies SHA-256, unpacks, writes a shell wrapper at `tools/orca/orca-slicer`, and on Linux without root fills `tools/orca/hostlibs/` from Ubuntu 24.04 `.deb` files until `ldd` is clean. `tools/orca/VERSION` records `<version> <arch>` so a stale or foreign install is replaced. The Makefile gains `install-orca`, `test-quick` and a `test` that runs the real slicer; the Dockerfile pins Debian 13 and installs Orca's runtime libraries.

**Tech Stack:** bash 3.2-compatible shell (macOS ships bash 3.2), `curl`, `sha256sum`/`shasum`, `dpkg-deb`, `ldd`, Python `unittest` for the script tests, Docker (`python:3.11-slim-trixie`), gunicorn `gthread`.

**Spec:** `docs/superpowers/specs/2026-09-13-3d-print-slicing-design.md`, sections 4 (changes to existing files), 5 (Orca as a core dependency), 9 (testing) and 10 (facts confirmed).

## Global Constraints

- Orca version is `2.4.2`; it appears only in `print/scripts/install-orca.sh` as `ORCA_VERSION`.
- Entry point is always `tools/orca/orca-slicer`, relative to the repository root. No environment variable, no `PATH` lookup, nothing configurable.
- Downloads come from `https://github.com/OrcaSlicer/OrcaSlicer/releases/download/v2.4.2/`.
- Verified SHA-256 checksums of the three assets (computed 2026-09-13 from downloads of the canonical release):
  - `OrcaSlicer_Linux_AppImage_Ubuntu2404_V2.4.2.AppImage` (x86-64): `d12fb8c8eac1aecd2dfb6377acd48f994f8fa439ed5292fa532dd82880f029fd`
  - `OrcaSlicer_Linux_AppImage_Ubuntu2404_aarch64_V2.4.2.AppImage`: `e1a07275a25f176626c55a5df39e91bc4476d8c28ee4a3192ff758e29dd5c3ba`
  - `OrcaSlicer_Mac_universal_V2.4.2.dmg`: `e15e7bb1b66214ec6e96b169b388004179c4f5f705effcdaf8c80d4992ee0366`
- The Linux wrapper never runs `AppRun`. It sets `APPDIR` and `LC_ALL=C`, puts `squashfs-root/lib/orca-runtime`, `squashfs-root/bin` and, when present, `tools/orca/hostlibs/usr/lib/<triplet>` and its `gstreamer-1.0` subdirectory on `LD_LIBRARY_PATH`, and execs `squashfs-root/bin/orca-slicer "$@"`.
- Docker base image is `python:3.11-slim-trixie`. gunicorn runs `--worker-class gthread --threads 16`, identical in `Dockerfile` and `Procfile`.
- `tools/` is ignored by git and by Docker.
- `make test-quick` must stay fast (no Orca run). `make test` = `test-quick` plus `uv run python -m unittest print.tests.orca_integration_test`.
- Commit each task on the branch `feature/3d-print-stage1` with a message starting `print(a): `. Never touch `main`, never push.
- Never print secrets. The agent container has no root, no sudo, no Docker daemon, and is Linux aarch64 with glibc 2.39.
- Debian 13 (trixie) package names were resolved on 2026-09-13 from the trixie `Contents-amd64` and `Contents-arm64` indexes for every library the binary links directly; they are identical on both architectures (list in Task 5).

---

### Task 1: Install script core (platform choice, idempotency, checksum, wrapper)

**Files:**
- Create: `print/scripts/install-orca.sh`
- Modify: `.gitignore` (append `tools/`)
- Create: `.dockerignore`
- Test: `print/tests/test_install_orca.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `print/scripts/install-orca.sh` (no arguments; exit 0 when `tools/orca/orca-slicer` is ready; exit 1 with a message on stderr otherwise). Writes `tools/orca/VERSION` containing `2.4.2 <arch>` where `<arch>` is `linux-x86_64`, `linux-aarch64` or `darwin-arm64`. Task 2 adds the unprivileged `hostlibs` path inside the function `bootstrap_hostlibs` that this task leaves as a stub that only runs the `ldd` check.

The tests copy the script into a temporary fake repository (`<tmp>/print/scripts/install-orca.sh`), so the script installs into `<tmp>/tools/orca` because it derives the repository root from its own location. Fake `uname` and `curl` executables on `PATH` drive the platform and the download. No network is touched by the tests.

- [ ] **Step 1: Write the failing tests**

```python
"""Tests for print/scripts/install-orca.sh. No network: uname and curl are faked on PATH."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]        # the repository root
SCRIPT = REPO / "print" / "scripts" / "install-orca.sh"


class InstallOrcaScriptTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="orca-install-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        (self.tmp / "scripts").mkdir()
        self.script = self.tmp / "scripts" / "install-orca.sh"
        shutil.copy(SCRIPT, self.script)
        self.script.chmod(0o755)
        self.fakebin = self.tmp / "fakebin"
        self.fakebin.mkdir()
        self.dest = self.tmp / "tools" / "orca"

    def fake(self, name, body):
        path = self.fakebin / name
        path.write_text("#!/usr/bin/env bash\n" + body)
        path.chmod(0o755)

    def fake_uname(self, system, machine):
        self.fake("uname", 'case "$1" in -m) echo %s;; *) echo %s;; esac\n' % (machine, system))

    def fake_curl_garbage(self):
        # Writes junk to whatever -o names and records that it was called.
        self.fake("curl", 'out=""; while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift;; esac; shift; done\n'
                          'echo called >> "%s"\n'
                          'mkdir -p "$(dirname "$out")"; echo garbage > "$out"\n' % (self.tmp / "curl-calls"))

    def run_script(self):
        env = dict(os.environ)
        env["PATH"] = f"{self.fakebin}:{env['PATH']}"
        return subprocess.run(["bash", str(self.script)], env=env,
                              capture_output=True, text=True, timeout=120)

    def test_refuses_unknown_platform_naming_both_values(self):
        self.fake_uname("FreeBSD", "amd64")
        self.fake_curl_garbage()
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("FreeBSD", result.stderr)
        self.assertIn("amd64", result.stderr)
        self.assertFalse((self.tmp / "curl-calls").exists(), "must not download")
        self.assertFalse((self.dest / "VERSION").exists())

    def test_exits_without_downloading_when_version_and_arch_match(self):
        self.fake_uname("Linux", "aarch64")
        self.fake_curl_garbage()
        self.dest.mkdir(parents=True)
        (self.dest / "VERSION").write_text("2.4.2 linux-aarch64\n")
        wrapper = self.dest / "orca-slicer"
        wrapper.write_text("#!/bin/sh\nexit 0\n")
        wrapper.chmod(0o755)
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.tmp / "curl-calls").exists(), "must not download")
        self.assertEqual((self.dest / "VERSION").read_text().strip(), "2.4.2 linux-aarch64")

    def test_replaces_install_from_another_architecture(self):
        self.fake_uname("Linux", "aarch64")
        self.fake_curl_garbage()
        self.dest.mkdir(parents=True)
        (self.dest / "VERSION").write_text("2.4.2 darwin-arm64\n")
        (self.dest / "orca-slicer").write_text("#!/bin/sh\nexit 0\n")
        result = self.run_script()
        # The fake download is garbage, so the run must fail at the checksum,
        # proving it tried to replace the foreign install rather than trusting it.
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue((self.tmp / "curl-calls").exists(), "must download")
        self.assertFalse((self.dest / "VERSION").exists(), "stale VERSION must be removed")

    def test_checksum_mismatch_deletes_download_and_fails(self):
        self.fake_uname("Linux", "x86_64")
        self.fake_curl_garbage()
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("checksum", result.stderr.lower())
        leftovers = list(self.dest.rglob("*.AppImage")) if self.dest.exists() else []
        self.assertEqual(leftovers, [], "corrupt download must be deleted")
        self.assertFalse((self.dest / "VERSION").exists())

    def test_downloads_the_asset_for_the_platform(self):
        self.fake_uname("Darwin", "arm64")
        self.fake("curl", 'while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift;; http*) echo "$1" >> "%s";; esac; shift; done\n'
                          'mkdir -p "$(dirname "$out")"; echo garbage > "$out"\n' % (self.tmp / "curl-urls"))
        self.run_script()
        urls = (self.tmp / "curl-urls").read_text()
        self.assertIn("https://github.com/OrcaSlicer/OrcaSlicer/releases/download/v2.4.2/OrcaSlicer_Mac_universal_V2.4.2.dmg", urls)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python -m unittest tests.test_install_orca -v`
Expected: every test errors because `print/scripts/install-orca.sh` does not exist (`shutil.copy` raises `FileNotFoundError`).

- [ ] **Step 3: Write the script**

Create `print/scripts/install-orca.sh` (mode 0755). Bash 3.2 compatible: no associative arrays, no `${var,,}`, no `readlink -f`, no `mapfile`.

```bash
#!/usr/bin/env bash
# Install Orca Slicer at the fixed path tools/orca/orca-slicer.
#
# The only place the Orca version and asset checksums live. Idempotent: exits 0
# without touching the network when tools/orca/VERSION already records this
# version for this platform. Supported platforms: Linux x86_64, Linux aarch64,
# macOS arm64. Refuses anything else.
#
# On Linux the AppImage is extracted (no FUSE needed) and, when the host lacks
# Orca's runtime libraries and this script is not running as root, the missing
# Ubuntu 24.04 packages are unpacked into tools/orca/hostlibs/. See
# docs/3D_PRINTING.md.
set -euo pipefail

ORCA_VERSION="2.4.2"
SHA_LINUX_X86_64="d12fb8c8eac1aecd2dfb6377acd48f994f8fa439ed5292fa532dd82880f029fd"
SHA_LINUX_AARCH64="e1a07275a25f176626c55a5df39e91bc4476d8c28ee4a3192ff758e29dd5c3ba"
SHA_MACOS="e15e7bb1b66214ec6e96b169b388004179c4f5f705effcdaf8c80d4992ee0366"
RELEASE_URL="https://github.com/OrcaSlicer/OrcaSlicer/releases/download/v${ORCA_VERSION}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/tools/orca"

die() { echo "install-orca: $*" >&2; exit 1; }

OS="$(uname -s)"
CPU="$(uname -m)"
case "$OS/$CPU" in
    Linux/x86_64)
        ASSET="OrcaSlicer_Linux_AppImage_Ubuntu2404_V${ORCA_VERSION}.AppImage"
        SHA="$SHA_LINUX_X86_64"; ARCH="linux-x86_64"
        TRIPLET="x86_64-linux-gnu"; UBUNTU_ARCH="amd64"
        MIRROR="http://archive.ubuntu.com/ubuntu" ;;
    Linux/aarch64)
        ASSET="OrcaSlicer_Linux_AppImage_Ubuntu2404_aarch64_V${ORCA_VERSION}.AppImage"
        SHA="$SHA_LINUX_AARCH64"; ARCH="linux-aarch64"
        TRIPLET="aarch64-linux-gnu"; UBUNTU_ARCH="arm64"
        MIRROR="http://ports.ubuntu.com/ubuntu-ports" ;;
    Darwin/arm64)
        ASSET="OrcaSlicer_Mac_universal_V${ORCA_VERSION}.dmg"
        SHA="$SHA_MACOS"; ARCH="darwin-arm64"
        TRIPLET=""; UBUNTU_ARCH=""; MIRROR="" ;;
    *)
        die "unsupported platform: uname -s='$OS' uname -m='$CPU' (need Linux/x86_64, Linux/aarch64 or Darwin/arm64)" ;;
esac
STAMP="$ORCA_VERSION $ARCH"

if [ -f "$DEST/VERSION" ] && [ "$(cat "$DEST/VERSION")" = "$STAMP" ] && [ -x "$DEST/orca-slicer" ]; then
    echo "install-orca: Orca Slicer $STAMP already installed at $DEST"
    exit 0
fi

sha256_of() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
    else shasum -a 256 "$1" | awk '{print $1}'; fi
}

# Anything at DEST is stale or foreign: start clean.
rm -rf "$DEST"
mkdir -p "$DEST/download"
DL="$DEST/download/$ASSET"
echo "install-orca: downloading $ASSET"
curl -fL --retry 3 --retry-delay 5 -o "$DL" "$RELEASE_URL/$ASSET" || { rm -rf "$DEST"; die "download of $ASSET failed"; }
ACTUAL="$(sha256_of "$DL")"
if [ "$ACTUAL" != "$SHA" ]; then
    rm -rf "$DEST"
    die "checksum mismatch for $ASSET: expected $SHA, got $ACTUAL; download deleted"
fi

write_wrapper_linux() {
    cat > "$DEST/orca-slicer" <<EOF
#!/usr/bin/env bash
# Generated by print/scripts/install-orca.sh. Runs Orca Slicer $ORCA_VERSION headless.
# Does not use the AppImage's AppRun launcher (it insists on ldconfig); sets what
# AppRun would set and execs the binary directly.
HERE="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
APP="\$HERE/squashfs-root"
export APPDIR="\$APP"
export LC_ALL=C
LIBS="\$APP/lib/orca-runtime:\$APP/bin"
HOST="\$HERE/hostlibs/usr/lib/$TRIPLET"
if [ -d "\$HOST" ]; then LIBS="\$LIBS:\$HOST:\$HOST/gstreamer-1.0"; fi
export LD_LIBRARY_PATH="\$LIBS\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}"
exec "\$APP/bin/orca-slicer" "\$@"
EOF
    chmod 0755 "$DEST/orca-slicer"
}

write_wrapper_macos() {
    cat > "$DEST/orca-slicer" <<EOF
#!/usr/bin/env bash
# Generated by print/scripts/install-orca.sh. Runs Orca Slicer $ORCA_VERSION headless.
HERE="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
exec "\$HERE/OrcaSlicer.app/Contents/MacOS/OrcaSlicer" "\$@"
EOF
    chmod 0755 "$DEST/orca-slicer"
}

# Library path the Linux wrapper uses, for ldd checks. Echoes the path.
linux_lib_path() {
    local app="$DEST/squashfs-root" host="$DEST/hostlibs/usr/lib/$TRIPLET"
    local libs="$app/lib/orca-runtime:$app/bin"
    if [ -d "$host" ]; then libs="$libs:$host:$host/gstreamer-1.0"; fi
    echo "$libs"
}

# Sonames ldd cannot resolve for the binary and for every host library, one per line.
missing_libs() {
    local host="$DEST/hostlibs/usr/lib/$TRIPLET" extra=""
    if [ -d "$host" ]; then extra="$(find "$host" -maxdepth 1 -name '*.so*' 2>/dev/null | tr '\n' ' ')"; fi
    # shellcheck disable=SC2086
    LD_LIBRARY_PATH="$(linux_lib_path)" ldd "$DEST/squashfs-root/bin/orca-slicer" $extra 2>/dev/null \
        | grep 'not found' | awk '{print $1}' | sort -u
}

# Task 2 replaces this stub with the unprivileged hostlibs bootstrap.
bootstrap_hostlibs() {
    return 0
}

case "$OS" in
    Linux)
        echo "install-orca: extracting AppImage"
        chmod +x "$DL"
        (cd "$DEST" && "$DL" --appimage-extract >/dev/null) || die "AppImage extraction failed"
        rm -rf "$DEST/download"
        write_wrapper_linux
        MISSING="$(missing_libs || true)"
        if [ -n "$MISSING" ]; then
            if [ "$(id -u)" = "0" ]; then
                die "runtime libraries missing (install the distro packages, see Dockerfile):"$'\n'"$MISSING"
            fi
            echo "install-orca: host lacks runtime libraries; unpacking Ubuntu 24.04 packages into $DEST/hostlibs"
            bootstrap_hostlibs
            MISSING="$(missing_libs || true)"
            [ -z "$MISSING" ] || die "runtime libraries still missing after bootstrap:"$'\n'"$MISSING"
        fi
        ;;
    Darwin)
        echo "install-orca: mounting disk image"
        MNT="$DEST/download/mnt"
        mkdir -p "$MNT"
        hdiutil attach -nobrowse -readonly -quiet -mountpoint "$MNT" "$DL" || die "hdiutil attach failed"
        cp -R "$MNT/OrcaSlicer.app" "$DEST/OrcaSlicer.app" || { hdiutil detach -quiet "$MNT"; die "copy of OrcaSlicer.app failed"; }
        hdiutil detach -quiet "$MNT"
        rm -rf "$DEST/download"
        # curl sets no quarantine attribute, but clear it in case the image was
        # ever opened by Finder, so Gatekeeper does not block the command line.
        if command -v xattr >/dev/null 2>&1; then xattr -dr com.apple.quarantine "$DEST/OrcaSlicer.app" 2>/dev/null || true; fi
        write_wrapper_macos
        ;;
esac

"$DEST/orca-slicer" --help >/dev/null 2>&1 || die "installed orca-slicer fails to run (glibc 2.38 or newer is required on Linux)"
echo "$STAMP" > "$DEST/VERSION"
echo "install-orca: Orca Slicer $STAMP installed at $DEST/orca-slicer"
```

Append to `.gitignore` under a new comment:

```
# Orca Slicer, installed by print/scripts/install-orca.sh (never committed)
tools/
```

Create `.dockerignore`:

```
tools/
.venv/
venv/
.git/
.worktrees/
__pycache__/
*.pyc
.env
*-creds.txt
google-creds.txt
onshape_config.json
PenguinCAM-config.yaml
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python -m unittest tests.test_install_orca -v`
Expected: 5 tests, `OK`. If `test_checksum_mismatch_deletes_download_and_fails` fails because `curl-calls` is missing, check that the fake `curl` handles `--retry 3` style flags (it must ignore unknown arguments, which the fake above does).

- [ ] **Step 5: Run the quick suite**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python -m unittest discover -s tests --buffer && uv run python -m unittest discover -s print/tests -t . --buffer && uv run python gcode_test.py --quiet`
Expected: all pass. Commit the task.

---

### Task 2: Unprivileged Linux path (hostlibs bootstrap) and a real install in this container

**Files:**
- Modify: `print/scripts/install-orca.sh` (replace the `bootstrap_hostlibs` stub)
- Create: `print/tests/orca_integration_test.py`

**Interfaces:**
- Consumes: `missing_libs`, `linux_lib_path`, `$DEST`, `$TRIPLET`, `$UBUNTU_ARCH`, `$MIRROR` from Task 1.
- Produces: a working `tools/orca/orca-slicer` in the agent container; `print/tests/orca_integration_test.py` with class `OrcaInstalledTest` (subfeature B adds slicing tests to this same file).

How the bootstrap works. Ubuntu publishes, per release, a `Contents-<arch>.gz` index mapping every file path to the package that ships it, and per component a `Packages.gz` index with each package's pool `Filename` and `SHA256`. The bootstrap downloads those indexes once into `tools/orca/index/`, then loops: list missing sonames, map each `usr/lib/<triplet>/<soname>` to a package (first non `-dev`, non `dbg` candidate), download the `.deb` from the pool, verify its SHA-256 against the index, extract it with `dpkg-deb -x` into `tools/orca/hostlibs/`, and repeat until `missing_libs` is empty or a round makes no progress. Twelve rounds is the cap. The release pocket (`noble`, not `noble-updates`) is used because its pool files never move.

- [ ] **Step 1: Write the failing integration test**

Create `print/tests/orca_integration_test.py`:

```python
"""Slow tests that run the real Orca Slicer binary. Not matched by discover's
test_*.py pattern; `make test` runs this module explicitly."""
import subprocess
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]        # the repository root
ORCA = REPO / "tools" / "orca" / "orca-slicer"


class OrcaInstalledTest(unittest.TestCase):
    def test_wrapper_exists_and_runs(self):
        self.assertTrue(ORCA.is_file(), f"{ORCA} missing: run `make install`")
        result = subprocess.run([str(ORCA), "--help"], capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr[-2000:])
        self.assertIn("--export-3mf", result.stdout)

    def test_version_stamp_matches_pinned_release(self):
        stamp = (REPO / "tools" / "orca" / "VERSION").read_text().split()
        self.assertEqual(stamp[0], "2.4.2")
        self.assertIn(stamp[1], {"linux-x86_64", "linux-aarch64", "darwin-arm64"})


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python -m unittest print.tests.orca_integration_test -v`
Expected: both tests fail (no `tools/orca`).

- [ ] **Step 3: Replace the `bootstrap_hostlibs` stub**

Replace the stub in `print/scripts/install-orca.sh` with:

```bash
# Unprivileged Linux path: fill tools/orca/hostlibs with the Ubuntu 24.04
# packages that ship the libraries ldd cannot find, verified against the
# archive's own SHA-256 index. Repeats until ldd is clean.
bootstrap_hostlibs() {
    command -v dpkg-deb >/dev/null 2>&1 || die "dpkg-deb is required to unpack runtime libraries without root"
    local idx="$DEST/index" hostlibs="$DEST/hostlibs" debs="$DEST/index/debs"
    mkdir -p "$idx" "$hostlibs" "$debs"
    echo "install-orca: fetching Ubuntu noble package indexes for $UBUNTU_ARCH"
    curl -fsSL --retry 3 -o "$idx/Contents.gz" "$MIRROR/dists/noble/Contents-$UBUNTU_ARCH.gz" || die "could not fetch Contents-$UBUNTU_ARCH.gz"
    # Only the library directory matters; keep those lines in a plain file for fast lookups.
    zcat "$idx/Contents.gz" | grep "^usr/lib/$TRIPLET/" > "$idx/libs.idx" || true
    : > "$idx/Packages"
    local comp
    for comp in main universe; do
        curl -fsSL --retry 3 -o "$idx/Packages-$comp.gz" "$MIRROR/dists/noble/$comp/binary-$UBUNTU_ARCH/Packages.gz" || die "could not fetch $comp Packages.gz"
        zcat "$idx/Packages-$comp.gz" >> "$idx/Packages"
        echo >> "$idx/Packages"
    done

    # Package that ships usr/lib/<triplet>/<soname>; empty when unknown.
    package_for_lib() {
        grep -m1 -E "^usr/lib/$TRIPLET/$1[[:space:]]" "$idx/libs.idx" \
            | awk '{print $NF}' | tr ',' '\n' | sed 's#.*/##' \
            | grep -vE -- '-dev$|dbg' | head -1
    }
    # "Filename SHA256" for a package from the Packages index; empty when unknown.
    pool_entry_for() {
        awk -v p="$1" 'BEGIN{RS=""; FS="\n"}
            $1=="Package: " p {f=""; s=""; for(i=1;i<=NF;i++){ if($i ~ /^Filename: /) f=substr($i,11); if($i ~ /^SHA256: /) s=substr($i,9) } print f, s; exit}' "$idx/Packages"
    }

    local round lib pkg entry file sha deb actual missing progressed
    for round in 1 2 3 4 5 6 7 8 9 10 11 12; do
        missing="$(missing_libs || true)"
        [ -n "$missing" ] || break
        echo "install-orca: round $round, $(printf '%s\n' "$missing" | grep -c .) libraries missing"
        progressed=0
        for lib in $missing; do
            pkg="$(package_for_lib "$lib")"
            [ -n "$pkg" ] || die "no Ubuntu noble package ships $lib for $UBUNTU_ARCH"
            [ -f "$debs/.$pkg" ] && continue   # already unpacked this round or earlier
            entry="$(pool_entry_for "$pkg")"
            file="${entry% *}"; sha="${entry#* }"
            [ -n "$file" ] && [ -n "$sha" ] || die "package $pkg (for $lib) not in the noble index"
            deb="$debs/$(basename "$file")"
            echo "install-orca:   $lib -> $pkg"
            curl -fsSL --retry 3 -o "$deb" "$MIRROR/$file" || die "download of $file failed"
            actual="$(sha256_of "$deb")"
            [ "$actual" = "$sha" ] || { rm -f "$deb"; die "checksum mismatch for $file"; }
            dpkg-deb -x "$deb" "$hostlibs" || die "dpkg-deb -x failed for $file"
            rm -f "$deb"
            : > "$debs/.$pkg"
            progressed=1
        done
        [ "$progressed" = 1 ] || die "no progress resolving libraries:"$'\n'"$missing"
    done
    rm -rf "$idx"
}
```

Note the `for lib in $missing` word split is intended: sonames contain no spaces. `progressed` only stays 0 when every missing library maps to a package already unpacked, which means the index lied; the script fails rather than loop.

- [ ] **Step 4: Run the real install in the agent container**

Run: `cd /repos/popcornpenguins/PenguinCAM && time print/scripts/install-orca.sh 2>&1 | tail -40`
Expected: downloads the aarch64 AppImage (135 MB), extracts, reports missing libraries, unpacks roughly 36 Ubuntu packages in two or three rounds, prints `installed at .../tools/orca/orca-slicer`, exits 0. Then `ls tools/orca` shows `VERSION hostlibs orca-slicer squashfs-root` and nothing else (no `index`, no `download`).

If the ldd loop dies with `no Ubuntu noble package ships <lib>`, check the `libs.idx` grep: the Contents file lists paths without a leading slash, separated from the package column by spaces. If the loop stalls on a library provided by a package already unpacked, the library is probably in a subdirectory (for example `gstreamer-1.0/`); the wrapper only adds the top-level directory and `gstreamer-1.0`, which matched the review's working set. Report what you find rather than widening `LD_LIBRARY_PATH` blindly.

- [ ] **Step 5: Run the integration test and the idempotency check**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python -m unittest print.tests.orca_integration_test -v && print/scripts/install-orca.sh`
Expected: 2 tests `OK`; the second script run prints `already installed` at once and exits 0.

- [ ] **Step 6: Run the quick suite**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python -m unittest discover -s tests --buffer && uv run python -m unittest discover -s print/tests -t . --buffer && uv run python gcode_test.py --quiet`
Expected: all pass. Commit the task.

---

### Task 3: Makefile targets

**Files:**
- Modify: `Makefile`

**Interfaces:**
- Consumes: `print/scripts/install-orca.sh` (Task 1), `print/tests/orca_integration_test.py` (Task 2).
- Produces: targets `install`, `install-orca`, `test`, `test-quick`. Every later subfeature runs `make test-quick` after each task and `make test` at its end.

- [ ] **Step 1: Write the new Makefile**

Replace `Makefile` with:

```make
.PHONY: install install-orca test test-quick

# Installs the Python environment and Orca Slicer (tools/orca, pinned in
# print/scripts/install-orca.sh). Orca is a core dependency: the server refuses to
# start without it.
install: install-orca
	@command -v uv >/dev/null 2>&1 || { echo "Installing uv..."; curl -LsSf https://astral.sh/uv/install.sh | sh; }
	@echo "Installing dependencies from requirements.txt..."
	uv pip install -r requirements.txt

install-orca:
	print/scripts/install-orca.sh

# Full run: everything in test-quick plus the real Orca slice. This is the
# gate before a change is done.
test: test-quick
	@echo ""
	@echo "Running Orca Slicer integration tests..."
	@uv run python -m unittest print.tests.orca_integration_test

# Everything except the slow slicer run; the tool for iteration.
test-quick:
	@echo "Running unit tests..."
	@uv run python -m unittest discover -s tests --buffer
	@echo ""
	@echo "Running print unit tests..."
	@uv run python -m unittest discover -s print/tests -t . --buffer
	@echo ""
	@echo "Running system tests..."
	@uv run python gcode_test.py --quiet
```

- [ ] **Step 2: Verify the targets**

Run: `cd /repos/popcornpenguins/PenguinCAM && make install-orca && make test-quick && make test`
Expected: `install-orca` prints `already installed`; `test-quick` passes without running Orca; `test` runs the quick suite and then the integration module, all `OK`. Commit the task.

---

### Task 4: Dockerfile, Procfile and CI install step

**Files:**
- Modify: `Dockerfile`
- Modify: `Procfile`
- Modify: `.github/workflows/integration.yaml`

**Interfaces:**
- Consumes: `print/scripts/install-orca.sh`, `make test`.
- Produces: an image that Railway builds; a CI workflow that installs Orca on the x86-64 runner and runs `make test`. Subfeature E revisits the workflow only if the test layout changes.

Package names below were resolved on 2026-09-13 from the Debian trixie `Contents-amd64` and `Contents-arm64` indexes for the 44 sonames `readelf -d` lists as `NEEDED` by `squashfs-root/bin/orca-slicer`; the names are identical on both architectures. `libexpat1`, `liblzma5`, `libmspack0t64` and `zlib1g` are bundled in the AppImage's `lib/orca-runtime` but are listed anyway so the `ldd` check holds even if the bundle changes.

- [ ] **Step 1: Write the Dockerfile**

Replace `Dockerfile` with:

```dockerfile
# Debian 13 (trixie, glibc 2.41): Orca Slicer's Ubuntu 24.04 AppImage needs
# glibc 2.38 or newer. Pinned so a future tag move cannot change the C library.
FROM python:3.11-slim-trixie

WORKDIR /app

# curl fetches the Orca release; the rest are the runtime libraries the Orca
# binary links against (resolved from the trixie package index, identical on
# amd64 and arm64). The AppImage bundles only a few private libraries.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl \
        libopengl0 libegl1 libgl1 libglx0 libglu1-mesa \
        libgtk-3-0t64 libgdk-pixbuf-2.0-0 libatk1.0-0t64 libcairo2 libcairo-gobject2 \
        libpango-1.0-0 libpangocairo-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libfontconfig1 \
        libglib2.0-0t64 libdbus-1-3 \
        libgstreamer1.0-0 libgstreamer-plugins-base1.0-0 \
        libwebkit2gtk-4.1-0 libjavascriptcoregtk-4.1-0 libsoup-3.0-0 libsecret-1-0 \
        libwayland-client0 libwayland-egl1 libwayland-server0 libxkbcommon0 \
        libx11-6 libxext6 libsm6 libice6 \
        libexpat1 liblzma5 libmspack0t64 zlib1g \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Orca Slicer at the fixed path tools/orca (the version is pinned in the script).
# Done before copying the app so code changes do not re-download 130 MB.
COPY print/scripts/install-orca.sh print/scripts/install-orca.sh
RUN print/scripts/install-orca.sh

# Copy application code (tools/ is in .dockerignore, so the install above stays)
COPY . .

# The build fails if the Orca binary has an unresolved library.
RUN ! (LD_LIBRARY_PATH=/app/tools/orca/squashfs-root/lib/orca-runtime:/app/tools/orca/squashfs-root/bin \
        ldd /app/tools/orca/squashfs-root/bin/orca-slicer | grep 'not found')

# Expose port (Railway sets PORT env var)
EXPOSE $PORT

# One worker (the job table, token map and limiter are per process), threaded
# so open event streams do not block other requests. Keep Procfile in step.
CMD gunicorn frc_cam_gui_app:app --bind 0.0.0.0:$PORT --worker-class gthread --threads 16
```

- [ ] **Step 2: Write the Procfile**

Replace `Procfile` with:

```
web: gunicorn frc_cam_gui_app:app --bind 0.0.0.0:$PORT --worker-class gthread --threads 16
```

- [ ] **Step 3: Update the CI workflow**

Replace `.github/workflows/integration.yaml` with:

```yaml
name: CAM Integration Tests

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main, develop ]

jobs:
  test-cam:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install uv
        uses: astral-sh/setup-uv@v5

      - name: Install dependencies
        run: uv pip install --system -r requirements.txt

      - name: Cache Orca Slicer
        uses: actions/cache@v4
        with:
          path: tools/orca
          key: orca-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('print/scripts/install-orca.sh') }}

      - name: Install Orca Slicer
        run: print/scripts/install-orca.sh

      - name: Run all tests (unit, system, Orca slice)
        run: make test
```

`uv pip install --system` puts the packages in the runner's Python so `uv run python` in the Makefile finds them without a project file. The runner is not root, so a missing library on the runner goes through the script's `hostlibs` path, which exercises the x86-64 unprivileged path in CI.

- [ ] **Step 4: Lint what can be checked here**

There is no Docker daemon in the agent container, so the image cannot be built here. Check instead:

Run: `cd /repos/popcornpenguins/PenguinCAM && bash -n print/scripts/install-orca.sh && grep -c 'gthread --threads 16' Dockerfile Procfile && uv run python -c "import yaml; yaml.safe_load(open('.github/workflows/integration.yaml')); print('workflow ok')"`
Expected: `1` for each of Dockerfile and Procfile, `workflow ok`.

- [ ] **Step 5: Run the full suite**

Run: `cd /repos/popcornpenguins/PenguinCAM && make test`
Expected: all pass including `print.tests.orca_integration_test`. Commit the task.

---

## Self-review

- Spec coverage: fixed path and no configurability (Task 1 wrapper, no env var); three platforms chosen from `uname` with refusal naming both values (Task 1); checksums per asset, delete on mismatch (Task 1); `--appimage-extract`, wrapper not via `AppRun` with `APPDIR`, `LC_ALL=C`, runtime and hostlibs on `LD_LIBRARY_PATH` (Task 1); macOS mount, copy, wrapper (Task 1); `VERSION` with version and architecture, foreign install replaced (Task 1, tested); idempotent (Task 1, tested); unprivileged hostlibs bootstrap with checksum verification and repeated `ldd` (Task 2); `make install` runs the script, `test-quick`, `test` (Task 3); Dockerfile pin, `curl`, runtime libraries, install step, `ldd` check, gunicorn threads, Procfile in step (Task 4); `.gitignore` and `.dockerignore` (Task 1); CI installs Orca and runs `make test` (Task 4). The macOS Gatekeeper and configuration questions in spec section 10 are recorded in the documentation subfeature (E) from the facts in the orchestrator's notes.
- Placeholders: none; every step carries its code.
- Names: `bootstrap_hostlibs`, `missing_libs`, `linux_lib_path`, `sha256_of`, `die` are consistent between Tasks 1 and 2; `OrcaInstalledTest` in `print/tests/orca_integration_test.py` is the class subfeature B extends.
