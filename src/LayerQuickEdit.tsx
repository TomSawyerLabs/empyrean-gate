// Quick layer edit: the parameters of one layer, over whatever tab you were on.
//
// Before this, changing anything but a layer's on/off state meant leaving Live
// for Settings — i.e. taking the array off the screen to nudge a hue. This is
// the same set of controls as Settings' LayerEditor (minus reorder and delete,
// which are structural, not performance), anchored to the layer you held.
//
// Opened by long-press or right-click; see `longPress.ts` for the gesture and
// `Live.tsx` / `Control.tsx` for the two surfaces that raise it.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useGate, useThrottled } from "./state";
import {
  LAYER_LABELS,
  PARAM_LABELS,
  type BlendMode,
  type LayerCfg,
  type LayerKind,
} from "./types";

const BLEND_MODES: BlendMode[] = ["add", "multiply", "screen", "alpha_over", "max"];

/** Below this the window has no room to anchor a popover; it becomes a sheet. */
const SHEET_WIDTH = 700;
const MARGIN = 8;

export interface QuickEditAnchor {
  index: number;
  x: number;
  y: number;
}

function QuickSlider({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="slider-row">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="slider-val">{value.toFixed(2)}</span>
    </label>
  );
}

export default function LayerQuickEdit({
  anchor,
  onClose,
  onOpenFullEditor,
}: {
  anchor: QuickEditAnchor;
  onClose: () => void;
  onOpenFullEditor?: () => void;
}) {
  const { client, config } = useGate();
  const layer = config?.layers[anchor.index];
  const cardRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);
  const sheet = typeof window !== "undefined" && window.innerWidth <= SHEET_WIDTH;

  const throttledUpdate = useThrottled(
    (l: LayerCfg) => client.updateLayer(anchor.index, l),
    100,
  );
  // Local mirror so sliders feel instant while updates stream out, and a drag
  // flag so an incoming config echo does not yank the thumb mid-gesture. Same
  // shape as Settings' LayerEditor, which is the surface this stands in for.
  const [local, setLocal] = useState<LayerCfg | undefined>(layer);
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current && layer) setLocal(layer);
  }, [layer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    // Capture, so this wins over the app's show-mode Escape handler.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Anchor to the gesture, then pull back inside the window. Measured rather
  // than guessed: the card's height depends on how many params the layer kind
  // names, so there is no constant to clamp against.
  useLayoutEffect(() => {
    if (sheet) return;
    const card = cardRef.current;
    if (!card) return;
    const { width, height } = card.getBoundingClientRect();
    const left = Math.min(
      Math.max(MARGIN, anchor.x - width / 2),
      window.innerWidth - width - MARGIN,
    );
    // Prefer below the finger; flip above when that would run off the bottom.
    const below = anchor.y + 14;
    const top = below + height + MARGIN <= window.innerHeight
      ? below
      : Math.max(MARGIN, anchor.y - height - 14);
    setPlaced({ left, top });
  }, [anchor.x, anchor.y, sheet, local?.kind]);

  if (!local) return null;

  const up = (patch: Partial<LayerCfg>) => {
    const next = { ...local, ...patch };
    setLocal(next);
    throttledUpdate(next);
  };

  const params = PARAM_LABELS[local.kind] ?? [];
  const sourceCount = Math.max(config?.audio.sources.length ?? 1, 1);
  // Only the params this kind actually names. A kind with none (Solid, Plasma)
  // shows no Pattern group at all rather than four sliders called "Param A".
  const patternRows: Array<{ label: string; key: keyof LayerCfg }> = (
    ["param_a", "param_b", "param_c", "param_d"] as const
  )
    .map((key, i) => ({ label: params[i] ?? "", key: key as keyof LayerCfg }))
    .filter((row) => row.label !== "");

  return (
    <div
      className="quick-edit-backdrop"
      onPointerDown={onClose}
      onContextMenu={(e) => {
        // A second right-click anywhere dismisses rather than raising the
        // browser menu the rest of the app is careful to suppress.
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={cardRef}
        className={`layer-quick-edit ${sheet ? "sheet" : "popover"}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Quick edit ${local.name || LAYER_LABELS[local.kind]}`}
        style={sheet || !placed ? undefined : { left: placed.left, top: placed.top }}
        onPointerDown={(e) => {
          e.stopPropagation();
          dragging.current = true;
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        onContextMenu={(e) => e.stopPropagation()}
      >
        <div className="quick-edit-head">
          <button
            className={`quick-edit-power ${local.enabled ? "on" : ""}`}
            aria-pressed={local.enabled}
            onClick={() => up({ enabled: !local.enabled })}
          >
            {local.enabled ? "On" : "Off"}
          </button>
          <div className="quick-edit-title">
            <strong>{local.name || LAYER_LABELS[local.kind]}</strong>
            <span>Layer {anchor.index + 1}</span>
          </div>
          <button aria-label="Close quick edit" className="quick-edit-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="quick-edit-body">
          <div className="quick-edit-group">
            <h3>Mix</h3>
            <QuickSlider label="Opacity" value={local.opacity} onChange={(v) => up({ opacity: v })} />
            <QuickSlider
              label="Brightness"
              value={local.brightness}
              max={2}
              onChange={(v) => up({ brightness: v })}
            />
            <label className="field-row">
              <span>Blend</span>
              <select value={local.blend} onChange={(e) => up({ blend: e.target.value as BlendMode })}>
                {BLEND_MODES.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="quick-edit-group">
            <h3>Motion</h3>
            <QuickSlider
              label="Speed"
              value={local.speed}
              min={-4}
              max={4}
              onChange={(v) => up({ speed: v })}
            />
            <QuickSlider
              label="Scale"
              value={local.scale}
              min={0.05}
              max={5}
              onChange={(v) => up({ scale: v })}
            />
            <QuickSlider label="Walk" value={local.walk_amount} onChange={(v) => up({ walk_amount: v })} />
          </div>

          <div className="quick-edit-group">
            <h3>Colour</h3>
            <QuickSlider label="Hue" value={local.hue} onChange={(v) => up({ hue: v })} />
            <QuickSlider label="Hue range" value={local.hue_range} onChange={(v) => up({ hue_range: v })} />
            <QuickSlider
              label="Saturation"
              value={local.saturation}
              onChange={(v) => up({ saturation: v })}
            />
          </div>

          <div className="quick-edit-group">
            <h3>Audio</h3>
            <QuickSlider
              label="Amount"
              value={local.audio_amount}
              onChange={(v) => up({ audio_amount: v })}
            />
            <QuickSlider label="Tilt (IMU)" value={local.tilt_amount} onChange={(v) => up({ tilt_amount: v })} />
            <label className="field-row">
              <span>Source</span>
              <select
                value={local.audio_source}
                onChange={(e) => up({ audio_source: Number(e.target.value) })}
              >
                {Array.from({ length: sourceCount }, (_, i) => (
                  <option key={i} value={i}>{config?.audio.sources[i]?.id ?? `src ${i}`}</option>
                ))}
              </select>
            </label>
          </div>

          {patternRows.length > 0 && (
            <div className="quick-edit-group">
              <h3>{LAYER_LABELS[local.kind]}</h3>
              {patternRows.map((row) => (
                <QuickSlider
                  key={row.key}
                  label={row.label}
                  value={local[row.key] as number}
                  onChange={(v) => up({ [row.key]: v } as Partial<LayerCfg>)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="quick-edit-foot">
          {/* Changing the kind swaps every param's meaning, so it is the one
              structural control here — an operator who reaches for it is not
              tweaking, they are replacing. Reorder and delete stay in Settings. */}
          <label className="field-row">
            <span>Kind</span>
            <select value={local.kind} onChange={(e) => up({ kind: e.target.value as LayerKind })}>
              {(Object.keys(LAYER_LABELS) as LayerKind[]).map((k) => (
                <option key={k} value={k}>{LAYER_LABELS[k]}</option>
              ))}
            </select>
          </label>
          <button
            className="ghost"
            onClick={() => {
              onOpenFullEditor?.();
              onClose();
            }}
          >
            Full editor →
          </button>
        </div>
      </div>
    </div>
  );
}
