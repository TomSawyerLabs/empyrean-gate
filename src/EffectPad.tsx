import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { EffectCfg } from "./types";

const ROTATE_DIRECTION_KEY = "empyrean-gate.rotate-direction";
const ROTATE_DIRECTION_EVENT = "empyrean-gate:rotate-direction";

type Trigger = (effect: Partial<EffectCfg> & { kind: EffectCfg["kind"] }) => void;

interface EffectPadProps {
  effect: { kind: EffectCfg["kind"]; label: string; key?: string };
  trigger: Trigger;
  color?: Pick<EffectCfg, "hue" | "saturation" | "brightness">;
  className?: string;
  showKey?: boolean;
}

function savedDirection(): 1 | -1 {
  return localStorage.getItem(ROTATE_DIRECTION_KEY) === "-1" ? -1 : 1;
}

/**
 * A normal one-shot effect pad, or a pressure-like Rotate pad. Rotate emits
 * increasingly strong impulses while held; its adjacent toggle flips direction.
 */
export default function EffectPad({ effect, trigger, color, className = "effect-btn", showKey = true }: EffectPadProps) {
  const [direction, setDirection] = useState<1 | -1>(savedDirection);
  const timer = useRef<number | null>(null);
  const heldAt = useRef(0);

  useEffect(() => {
    const sync = () => setDirection(savedDirection());
    window.addEventListener(ROTATE_DIRECTION_EVENT, sync);
    return () => window.removeEventListener(ROTATE_DIRECTION_EVENT, sync);
  }, []);

  useEffect(() => () => {
    if (timer.current !== null) window.clearInterval(timer.current);
  }, []);

  const fire = (intensity = 1) => trigger({
    kind: effect.kind,
    angle: effect.kind === "rotate" ? direction : Math.random() * Math.PI * 2,
    intensity,
    ...color,
  });

  if (effect.kind !== "rotate") {
    return (
      <button className={className} onClick={() => fire()}>
        {effect.label}
        {showKey && effect.key && <span className="key-hint">{effect.key}</span>}
      </button>
    );
  }

  const stop = (event?: PointerEvent<HTMLButtonElement>) => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const start = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || timer.current !== null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    heldAt.current = performance.now();
    fire(0.45);
    timer.current = window.setInterval(() => {
      const heldSeconds = (performance.now() - heldAt.current) / 1000;
      fire(Math.min(2.4, 0.45 + heldSeconds * 0.65));
    }, 140);
  };
  const flip = () => {
    const next = direction === 1 ? -1 : 1;
    localStorage.setItem(ROTATE_DIRECTION_KEY, String(next));
    window.dispatchEvent(new Event(ROTATE_DIRECTION_EVENT));
  };

  return (
    <div className="rotate-effect-pad">
      <button
        className={className}
        onPointerDown={start}
        onPointerUp={stop}
        onPointerCancel={stop}
        onLostPointerCapture={() => stop()}
        title="Hold to accelerate the whole Gate"
      >
        {effect.label} {direction === 1 ? "↺" : "↻"}
        {showKey && effect.key && <span className="key-hint">{effect.key}</span>}
      </button>
      <button className="rotate-direction" onClick={flip} aria-label="Reverse rotation direction" title="Reverse direction">
        Flip
      </button>
    </div>
  );
}
