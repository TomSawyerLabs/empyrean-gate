// View tab: clean full preview for monitoring or projection. Tap/click fires a
// burst from that spot; no other chrome.

import { useEffect, useRef } from "react";
import GateCanvas from "./GateCanvas";
import { useGate } from "./state";

export default function View() {
  const { client, status, beatAt } = useGate();
  const beatDotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const dot = beatDotRef.current;
      if (dot) {
        const age = performance.now() - Math.max(...beatAt.current);
        const a = Math.max(0, 1 - age / 300);
        dot.style.opacity = String(0.15 + a * 0.85);
        dot.style.transform = `scale(${1 + a * 0.6})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [beatAt]);

  const bpm = status?.audio.find((a) => a.active)?.bpm ?? 0;

  return (
    <div className="view-page">
      <GateCanvas onTap={(angle, radius) => client.triggerEffect({ kind: "burst", angle, radius })} />
      <div className="preview-hud">
        <div ref={beatDotRef} className="beat-dot" />
        <span>{bpm > 0 ? `${bpm.toFixed(0)} BPM` : "no beat"}</span>
        {status && <span>{status.engine_fps.toFixed(0)} fps</span>}
        {status?.sacn_enabled && (
          <span className="live-pill">sACN {status.sacn_pps > 0 ? `${status.sacn_pps} pkt/s` : "LIVE — 0 pkt/s ⚠"}</span>
        )}
      </div>
    </div>
  );
}
