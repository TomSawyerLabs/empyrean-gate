"""Rebuild the app icons with a transparent background.

The originals were rendered onto the app's own dark backdrop (#0a0818) and
flattened, so every icon was an opaque square. Windows draws that square
verbatim — in the taskbar, in alt-tab, in the window corner, on a pinned
shortcut — which is the "black square background everywhere".

The artwork is additive light on a flat backdrop, so the backdrop can be undone
exactly rather than guessed at: subtract it, and what remains IS the light.
Alpha comes from that residual's strength, and the colour is un-premultiplied so
the ring composites correctly on a light taskbar as well as a dark one.

    python scripts/rebuild-icons.py

Regenerates every PNG plus icon.ico from icons/source-icon.png (a copy of the
original flattened 512px artwork, kept so this is repeatable).
"""

from pathlib import Path

from PIL import Image

ICONS = Path(__file__).resolve().parent.parent / "src-tauri" / "icons"
SOURCE = ICONS / "source-icon.png"
# The flat backdrop the artwork was rendered onto; sampled from a corner pixel.
BACKDROP = (10, 8, 24)
PNG_SIZES = {
    "32x32.png": 32,
    "64x64.png": 64,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 512,
}
# Windows picks the closest of these per context; 256 is what the taskbar and
# alt-tab use on a high-DPI display.
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def unflatten(image: Image.Image) -> Image.Image:
    """Turn `light on a known backdrop` back into `light with alpha`."""
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    width, height = rgba.size
    for y in range(height):
        for x in range(width):
            r, g, b, _ = pixels[x, y]
            # How far above the backdrop this pixel is, per channel.
            dr = max(0, r - BACKDROP[0])
            dg = max(0, g - BACKDROP[1])
            db = max(0, b - BACKDROP[2])
            alpha = max(dr, dg, db)
            if alpha == 0:
                pixels[x, y] = (0, 0, 0, 0)
                continue
            # Un-premultiply: store the light's own colour, with its strength in
            # alpha. Without this the ring would darken as it fades out.
            scale = 255 / alpha
            pixels[x, y] = (
                min(255, round(dr * scale)),
                min(255, round(dg * scale)),
                min(255, round(db * scale)),
                alpha,
            )
    return rgba


def resized(master: Image.Image, size: int) -> Image.Image:
    """Downsample in premultiplied space, or thin bright spokes bleed a halo
    into the transparent pixels around them."""
    premultiplied = Image.new("RGBA", master.size)
    src = master.load()
    dst = premultiplied.load()
    for y in range(master.size[1]):
        for x in range(master.size[0]):
            r, g, b, a = src[x, y]
            f = a / 255
            dst[x, y] = (round(r * f), round(g * f), round(b * f), a)

    small = premultiplied.resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size))
    sp = small.load()
    op = out.load()
    for y in range(size):
        for x in range(size):
            r, g, b, a = sp[x, y]
            if a == 0:
                op[x, y] = (0, 0, 0, 0)
                continue
            f = 255 / a
            op[x, y] = (
                min(255, round(r * f)),
                min(255, round(g * f)),
                min(255, round(b * f)),
                a,
            )
    return out


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(
            f"missing {SOURCE}; it should hold the original flattened artwork"
        )
    master = unflatten(Image.open(SOURCE))

    for name, size in PNG_SIZES.items():
        out = master if size == master.size[0] else resized(master, size)
        out.save(ICONS / name, "PNG")
        print(f"{name}: {size}x{size} transparent")

    frames = [resized(master, size) for size in ICO_SIZES]
    frames[-1].save(ICONS / "icon.ico", format="ICO", sizes=[(s, s) for s in ICO_SIZES])
    print(f"icon.ico: {', '.join(str(s) for s in ICO_SIZES)}")


if __name__ == "__main__":
    main()
