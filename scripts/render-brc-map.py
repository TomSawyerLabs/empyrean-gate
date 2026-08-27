#!/usr/bin/env python3
"""Render the official 2026 Burning Man GIS data as a Gate-friendly map.

Usage: render-brc-map.py /path/to/innovate-GIS-data [output.png]

The source data is published by Burning Man Project under the terms in the
innovate-GIS-data repository. This renderer deliberately keeps only the shapes
that survive the Gate's 64-spoke / low-resolution media texture.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


SIZE = 1536
PADDING = 92
YEAR = "2026"
GOLDEN_SPIKE = (-119.207871, 40.783242)


def load(root: Path, name: str) -> list[dict]:
    path = root / YEAR / "GeoJSON" / name
    return json.loads(path.read_text())["features"]


def iter_points(geometry: dict):
    coordinates = geometry["coordinates"]
    kind = geometry["type"]
    if kind == "Point":
        yield coordinates
    elif kind == "LineString":
        yield from coordinates
    elif kind == "MultiLineString" or kind == "Polygon":
        for line in coordinates:
            yield from line
    elif kind == "MultiPolygon":
        for polygon in coordinates:
            for line in polygon:
                yield from line


def lines(geometry: dict):
    coordinates = geometry["coordinates"]
    kind = geometry["type"]
    if kind == "LineString":
        yield coordinates
    elif kind == "MultiLineString" or kind == "Polygon":
        yield from coordinates
    elif kind == "MultiPolygon":
        for polygon in coordinates:
            yield from polygon


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("pass the innovate-GIS-data checkout")
    root = Path(sys.argv[1])
    output = Path(sys.argv[2] if len(sys.argv) > 2 else "public/media/brc-2026-map.png")

    street_features = load(root, "street_lines.geojson")
    fence_features = load(root, "trash_fence.geojson")
    plaza_features = load(root, "plazas.geojson")
    landmark_features = load(root, "cpns.geojson")

    all_points = [point for feature in fence_features for point in iter_points(feature["geometry"])]
    center_lat = sum(point[1] for point in all_points) / len(all_points)
    lon_scale = math.cos(math.radians(center_lat))
    projected = [(point[0] * lon_scale, point[1]) for point in all_points]
    min_x = min(point[0] for point in projected)
    max_x = max(point[0] for point in projected)
    min_y = min(point[1] for point in projected)
    max_y = max(point[1] for point in projected)
    scale = min((SIZE - PADDING * 2) / (max_x - min_x), (SIZE - PADDING * 2) / (max_y - min_y))
    mid_x = (min_x + max_x) / 2
    mid_y = (min_y + max_y) / 2

    def xy(point):
        x = SIZE / 2 + (point[0] * lon_scale - mid_x) * scale
        y = SIZE / 2 - (point[1] - mid_y) * scale
        return (round(x, 2), round(y, 2))

    image = Image.new("RGBA", (SIZE, SIZE), (1, 3, 8, 255))
    glow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    crisp = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(crisp)

    # Dusty playa disc: enough warm depth to feel like the place, still nearly
    # black so the physical LEDs read as drawn lines instead of a solid wash.
    cx, cy = xy(GOLDEN_SPIKE)
    for radius in range(660, 20, -8):
        t = radius / 660
        alpha = round(2 + (1 - t) * 8)
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=(205, 126, 52, alpha))

    # Official trash fence and gate road perimeter.
    for feature in fence_features:
        for line in lines(feature["geometry"]):
            points = [xy(point) for point in line]
            glow_draw.line(points, fill=(255, 128, 52, 135), width=18, joint="curve")
            draw.line(points, fill=(255, 154, 72, 225), width=4, joint="curve")

    # The official street centerlines are more legible at tiny texture sizes
    # than the much heavier street-outline polygons.
    for feature in street_features:
        kind = feature.get("properties", {}).get("kind", "")
        color = (93, 228, 255, 238) if kind == "radial" else (69, 160, 223, 215)
        width = 5 if kind == "radial" else 4
        for line in lines(feature["geometry"]):
            points = [xy(point) for point in line]
            glow_draw.line(points, fill=(35, 165, 255, 90), width=14, joint="curve")
            draw.line(points, fill=color, width=width, joint="curve")

    # Civic plazas stay warm, visually distinct from the blue city grid.
    for feature in plaza_features:
        for line in lines(feature["geometry"]):
            points = [xy(point) for point in line]
            if len(points) > 2:
                draw.polygon(points, fill=(255, 174, 65, 90), outline=(255, 205, 111, 220), width=3)

    # Selected named landmarks only. Full labels become noise on the Gate, but
    # these points orient the map and create a constellation at display scale.
    important = ("The Man", "Temple", "Center Camp", "Airport", "Greeters")
    for feature in landmark_features:
        name = str(feature.get("properties", {}).get("NAME", ""))
        if any(label.lower() in name.lower() for label in important):
            x, y = xy(feature["geometry"]["coordinates"])
            glow_draw.ellipse((x - 18, y - 18, x + 18, y + 18), fill=(255, 211, 91, 150))
            draw.ellipse((x - 6, y - 6, x + 6, y + 6), fill=(255, 238, 174, 255))

    # A quiet compass pin at the Golden Spike / Man.
    glow_draw.ellipse((cx - 32, cy - 32, cx + 32, cy + 32), fill=(255, 227, 130, 180))
    draw.ellipse((cx - 10, cy - 10, cx + 10, cy + 10), fill=(255, 246, 210, 255))

    glow = glow.filter(ImageFilter.GaussianBlur(11))
    image = Image.alpha_composite(image, glow)
    image = Image.alpha_composite(image, crisp)
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, optimize=True)


if __name__ == "__main__":
    main()
