# DOOM, vendored

The pieces that make `empyrean-gate --doom-host` a DOOM. See `plans/doom.md`
for the design and `src/doom/` for the Rust on both sides of the pipe.

## `doomgeneric/`

[ozkl/doomgeneric](https://github.com/ozkl/doomgeneric) at commit
`e257a09527062bfb986b6e5e0780839b6cbd5b71` (2026-10-11); the release tarball
had SHA-256 `26f8f60daa6c6e4d3c01e5eac9fb700d592dede803d13ac848154ff356b2a2e7`.
Only the engine core is kept: the `.c` files from the upstream `Makefile`'s
`SRC_DOOM` list minus the X11 platform file, plus every header and the
upstream `LICENSE` (GPL-2.0). The platform-specific files (`doomgeneric_*.c`),
the sound backends and the build files are not vendored; the five `DG_*`
callbacks are implemented in Rust (`src/doom/host.rs`).

Compiled by `build.rs` with the `cc` crate when the `doom` Cargo feature is on
(default), with `CMAP256` (8-bit indexed frames + palette),
`DOOMGENERIC_RESX=320`, `DOOMGENERIC_RESY=200` (native, no upscale). Nothing
is modified upstream-side; `shim.c` here supplies what the host needs beyond
the DG_* contract.

Re-vendoring: download the tarball for the new commit, copy the same file set
(`grep '^SRC_DOOM' Makefile`, drop `doomgeneric_xlib.c`, add `*.h` and
`LICENSE`), update the commit and hash above.

## `doom1.wad`

The shareware DOOM 1.9 IWAD (Episode 1, Knee-Deep in the Dead), 4,196,020
bytes:

| | |
|---|---|
| MD5 | `f0cefca49926d00903cf57551d901abe` |
| SHA-256 | `1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771` |

Taken from Debian's `doom-wad-shareware_1.9.fixed.orig.tar.gz` (the non-free
archive). The MD5 is the canonical one for the 1.9 shareware release. It is
embedded in the binary (`include_bytes!`) and written to
`<config dir>/EmpyreanGate/doom/doom1.wad` on first start, SHA-256 checked, so
a show machine with no internet still has it. `src/doom/mod.rs` holds the
expected hash.

The shareware episode is freely redistributable as shareware; the full game's
IWADs are not and nothing here loads one.

## Licensing

doomgeneric and the Doom engine are GPL-2.0. The rest of this repository is
MIT. A release binary with the `doom` feature links both, so distributing it is
distributing a GPL-2 combined work — which the public MIT source satisfies, but
is worth knowing before bundling anything proprietary in. Build with
`--no-default-features --features shader-hot-reload` for a DOOM-free binary.
