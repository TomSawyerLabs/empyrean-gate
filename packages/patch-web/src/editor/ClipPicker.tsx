// A Clip node's loop: choose a video or an animated image, which becomes a
// sprite sheet stored in the patch (see clip.ts); preview, grid, remove.

import { useState } from "react";
import { CLIP_GRIDS, fileToClip } from "./clip";
import type { PatchDoc, PatchNode, PatchNodeType } from "../types";

export function ClipPicker({
  node,
  def,
  canEdit,
  onChange,
}: {
  node: PatchNode;
  def: PatchNodeType;
  canEdit: boolean;
  onChange: (mutate: (d: PatchDoc) => void) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const gridDef = def.params.find((p) => p.name === "grid");
  const gridIndex = Math.round(node.params.grid ?? gridDef?.default ?? 0);
  const frames = Math.round(node.params.frames ?? 0);
  const grid = CLIP_GRIDS[gridIndex] ?? CLIP_GRIDS[0];

  const load = (file: File, gridIdx: number) => {
    setError(null);
    setBusy(true);
    fileToClip(file, gridIdx)
      .then((sheet) =>
        onChange((d) => {
          const n = d.nodes.find((x) => x.id === node.id);
          if (!n) return;
          n.media = sheet.media;
          n.params.frames = sheet.frames;
          n.params.grid = gridIdx;
        }),
      )
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="patch-image patch-clip">
      <span className="patch-param-head">Clip</span>
      {node.media ? (
        <>
          <img className="patch-image-preview" src={node.media} alt="This clip's frames" />
          <p className="hint">
            {frames} frame{frames === 1 ? "" : "s"} in a {grid}×{grid} sheet.
          </p>
        </>
      ) : (
        <p className="hint">No clip yet.</p>
      )}
      {canEdit && (
        <div className="patch-param-row">
          <label className="patch-image-choose">
            <input
              type="file"
              accept="video/*,image/gif,image/webp,image/apng,image/png,image/jpeg"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) load(file, gridIndex);
              }}
            />
            {busy ? "Reading…" : node.media ? "Replace…" : "Choose video or GIF…"}
          </label>
          {node.media && (
            <button
              type="button"
              onClick={() =>
                onChange((d) => {
                  const n = d.nodes.find((x) => x.id === node.id);
                  if (n) delete n.media;
                })
              }
            >
              Remove
            </button>
          )}
        </div>
      )}
      <p className="hint">
        Frames are sampled evenly from the file into one 256×256 sheet, so the patch stays
        self-contained. Pick the sheet layout under Sheet first; fewer, larger frames or more,
        smaller ones.
      </p>
      {error && <p className="patch-status error">{error}</p>}
    </div>
  );
}
