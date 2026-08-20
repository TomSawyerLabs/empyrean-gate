#!/usr/bin/env bash
set -euo pipefail

# Fetch one archived show recording without keeping a second repository checkout
# or accidentally adding a large Git LFS object to Empyrean Gate.
default_clip="1ad2a100-64d4-4aeb-8fbd-deeb10b1410b"
clip_id="${1:-$default_clip}"
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_dir="$root_dir/demo-data/uprising"
if [[ "$clip_id" == "$default_clip" ]]; then
  output_name="Warm Windstorm.eg.data"
else
  output_name="$clip_id.eg.data"
fi
output_file="$output_dir/$output_name"
partial_file="$output_file.part"

if ! command -v gh >/dev/null 2>&1 || ! gh auth status >/dev/null 2>&1; then
  echo "An authenticated GitHub CLI is required: gh auth login" >&2
  exit 1
fi

if [[ -s "$output_file" ]]; then
  echo "$output_file"
  exit 0
fi

mkdir -p "$output_dir"
trap 'rm -f "$partial_file"' EXIT

# GitHub's contents API returns a short-lived authenticated media URL that
# resolves the LFS pointer without cloning the multi-gigabyte data repository.
media_url="$(gh api "repos/allibell/Uprising-Data/contents/media/$clip_id.eg.data" --jq '.download_url')"
curl --fail --location --progress-bar "$media_url" --output "$partial_file"

frame_bytes=$((64 * 378 * 3))
file_bytes="$(stat -f %z "$partial_file" 2>/dev/null || stat -c %s "$partial_file")"
if (( file_bytes % frame_bytes != 0 )); then
  echo "Downloaded file is not an exact Uprising frame sequence." >&2
  exit 1
fi

mv "$partial_file" "$output_file"

frames=$((file_bytes / frame_bytes))
echo "Fetched $frames frames ($(awk "BEGIN { printf \"%.1f\", $file_bytes / 1048576 }") MB):"
echo "$output_file"
