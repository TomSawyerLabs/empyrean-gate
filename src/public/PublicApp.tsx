// The public floor: one screen, phone-first. The array fills the top; what a
// touch does is picked below it. There is no settings surface, no roster, no
// show control — the server would refuse all of it, and a surface should not
// offer what it cannot do. Everything shown follows the `public_state`
// snapshot the server pushes: when the operator closes the floor the tools
// fold away and the page says so; when a game starts the tools become that
// game's. Keys arriving in the URL (`?key=`, `/k/<secret>`) or typed in
// unlock perks the same way.

import { useEffect, useMemo, useRef, useState } from "react";
import GateCanvas, { type DrawPen, type GatePreviewSource } from "../GateCanvas";
import ShapeIcon from "../ShapeIcon";
import ToolIcon from "../ToolIcon";
import { EFFECTS, SHAPES, isShape } from "../effects";
import { ERASE_SPECIES, GAMES, RINGFALL_COMMANDS, speciesColor } from "../gameCatalog";
import { BUILTIN_LIVE_COLORS, type LiveColor } from "../liveColors";
import { deviceNameUnconfirmed, generateDeviceName } from "../deviceNames";
import type { EffectKind, PenKind, PublicSnapshot, ServerMsg } from "../types";
import { PublicClient, absorbKeyFromUrl } from "./publicClient";

/** What a press on the array does. Shapes stamp where you tap; motion effects
 *  start from where you tap; a pen draws under a drag. */
type Tool = { kind: "effect"; effect: EffectKind } | { kind: "pen"; pen: PenKind };

const PENS: PenKind[] = ["glow", "ripple", "sparkle", "comet", "ring"];
const PEN_LABEL: Record<PenKind, string> = {
  glow: "Glow",
  ripple: "Ripple",
  sparkle: "Sparkle",
  comet: "Comet",
  ring: "Ring",
  beam: "Beam",
  ember: "Ember",
};
/** Motion effects a stranger gets. Strobe is a perk; Rotate is a held pad
 *  with a direction and does not read as "tap here". */
const PUBLIC_EFFECTS = EFFECTS.filter((e) => e.kind !== "strobe" && e.kind !== "rotate");
const STROBE = EFFECTS.find((e) => e.kind === "strobe")!;

const TOOL_KEY = "empyrean-public-tool";
const COLOR_KEY = "empyrean-public-color";

function loadTool(): Tool {
  try {
    const parsed = JSON.parse(localStorage.getItem(TOOL_KEY) ?? "");
    if (parsed?.kind === "pen" && PENS.includes(parsed.pen)) return parsed;
    if (parsed?.kind === "effect" && typeof parsed.effect === "string") return parsed;
  } catch {
    // first visit
  }
  return { kind: "effect", effect: "burst" };
}

function loadColor(): LiveColor {
  const id = localStorage.getItem(COLOR_KEY);
  return BUILTIN_LIVE_COLORS.find((c) => c.id === id) ?? BUILTIN_LIVE_COLORS[5];
}

/** Local feedback for a press: an expanding ring where the finger landed,
 *  so the floor feels alive even with no preview stream (the array itself is
 *  overhead — this is a receipt, not a picture of the show). */
function Ripples({ events }: { events: React.RefObject<{ x: number; y: number; t: number; hex: string }[]> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const canvas = ref.current;
      const list = events.current;
      if (canvas && list) {
        const size = Math.min(canvas.clientWidth, canvas.clientHeight);
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const backing = Math.max(1, Math.round(size * dpr));
        if (canvas.width !== backing) {
          canvas.width = backing;
          canvas.height = backing;
        }
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const now = performance.now();
          const LIFE = 700;
          for (let i = list.length - 1; i >= 0; i--) {
            const e = list[i];
            const age = (now - e.t) / LIFE;
            if (age >= 1) {
              list.splice(i, 1);
              continue;
            }
            const r = (0.04 + age * 0.22) * backing;
            ctx.beginPath();
            ctx.arc(e.x * backing, e.y * backing, r, 0, Math.PI * 2);
            ctx.strokeStyle = e.hex;
            ctx.globalAlpha = (1 - age) * 0.9;
            ctx.lineWidth = Math.max(1.5, (1 - age) * 6 * dpr);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [events]);
  return <canvas ref={ref} className="public-ripples" aria-hidden="true" />;
}

/** The array, drawn once: 64 faint spokes between the two radii. Behind the
 *  live ring when there is a stream, the whole picture when there is not. */
function Schematic({ spokes, inner }: { spokes: number; inner: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const paint = () => {
      const size = Math.min(canvas.clientWidth, canvas.clientHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const backing = Math.max(1, Math.round(size * dpr));
      canvas.width = backing;
      canvas.height = backing;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const c = backing / 2;
      const outer = c * 0.95;
      const innerR = outer * inner;
      ctx.clearRect(0, 0, backing, backing);
      ctx.strokeStyle = "rgba(180, 170, 230, 0.16)";
      ctx.lineWidth = Math.max(1, dpr);
      for (let s = 0; s < spokes; s++) {
        const theta = (s / spokes) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(c + innerR * Math.cos(theta), c + innerR * Math.sin(theta));
        ctx.lineTo(c + outer * Math.cos(theta), c + outer * Math.sin(theta));
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(180, 170, 230, 0.22)";
      for (const r of [innerR, outer]) {
        ctx.beginPath();
        ctx.arc(c, c, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [spokes, inner]);
  return <canvas ref={ref} className="public-schematic" aria-hidden="true" />;
}

function NameChip({ client }: { client: PublicClient }) {
  const [name, setName] = useState(() => client.deviceName);
  const [unconfirmed, setUnconfirmed] = useState(deviceNameUnconfirmed);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(name);
  useEffect(
    () =>
      client.onDeviceName((next) => {
        setName(next);
        setUnconfirmed(false);
      }),
    [client],
  );
  const commit = (value: string) => {
    client.setDeviceName(value);
    setOpen(false);
  };
  return (
    <>
      <button
        className={`name-chip ${unconfirmed ? "unconfirmed" : ""}`}
        aria-label={`Your name is ${name}. Change it`}
        onClick={() => {
          setDraft(name);
          setOpen(true);
        }}
      >
        ☺ {name}
        {unconfirmed && <span className="name-chip-nudge">pick a name</span>}
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal name-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Your name on the floor</h2>
            <p>The crew sees this beside what you play. Keep ours, roll another, or type your own.</p>
            <form
              className="name-form"
              onSubmit={(e) => {
                e.preventDefault();
                commit(draft);
              }}
            >
              <input autoFocus maxLength={40} value={draft} aria-label="Your name" onChange={(e) => setDraft(e.target.value)} />
              <button type="button" className="ghost" onClick={() => setDraft(generateDeviceName())}>
                🎲 Another
              </button>
            </form>
            <div className="name-actions">
              <button className="primary" onClick={() => commit(draft)} disabled={!draft.trim()}>
                {draft.trim() === name ? "Keep it" : "Use this name"}
              </button>
              <button className="ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CodeEntry({ client }: { client: PublicClient }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [note, setNote] = useState<string | null>(null);
  useEffect(
    () =>
      client.onMessage((m: ServerMsg) => {
        if (m.type === "unlocked") {
          setNote(`Unlocked: ${m.name}`);
          setOpen(false);
          setCode("");
        } else if (m.type === "error" && /code/i.test(m.message)) {
          setNote(m.message);
          client.forgetKey(code);
        }
      }),
    [client, code],
  );
  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), 4000);
    return () => window.clearTimeout(t);
  }, [note]);
  return (
    <div className="public-code">
      {note && (
        <div className="public-toast" role="status">
          {note}
        </div>
      )}
      {open ? (
        <form
          className="public-code-form"
          onSubmit={(e) => {
            e.preventDefault();
            client.unlock(code);
          }}
        >
          <input
            autoFocus
            value={code}
            maxLength={64}
            placeholder="secret code"
            autoCapitalize="characters"
            autoCorrect="off"
            aria-label="Secret code"
            onChange={(e) => setCode(e.target.value)}
          />
          <button type="submit" className="primary" disabled={code.trim().length < 4}>
            Unlock
          </button>
          <button type="button" className="ghost" onClick={() => setOpen(false)}>
            ✕
          </button>
        </form>
      ) : (
        <button className="ghost public-code-toggle" onClick={() => setOpen(true)}>
          Have a code?
        </button>
      )}
    </div>
  );
}

export default function PublicApp() {
  const client = useMemo(() => {
    absorbKeyFromUrl();
    const c = new PublicClient();
    c.connect();
    return c;
  }, []);
  const [snap, setSnap] = useState<PublicSnapshot | null>(client.snapshot);
  const [connected, setConnected] = useState(client.connected);
  const [denied, setDenied] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>(loadTool);
  const [color, setColor] = useState<LiveColor>(loadColor);
  const [size, setSize] = useState(0.12);
  const [mySpecies, setMySpecies] = useState(0);
  const ripples = useRef<{ x: number; y: number; t: number; hex: string }[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const offSnap = client.onSnapshot((s) => {
      setSnap(s);
      setDenied(null);
    });
    const offStatus = client.onStatus(setConnected);
    const offMsg = client.onMessage((m) => {
      if (m.type === "denied") setDenied(m.reason);
    });
    // The socket may have opened (and the snapshot landed) before this effect
    // ran — WebKit gets there first on a cold load — so read the client's
    // current state rather than waiting for the next event.
    setConnected(client.connected);
    if (client.snapshot) setSnap(client.snapshot);
    return () => {
      offSnap();
      offStatus();
      offMsg();
    };
  }, [client]);

  useEffect(() => localStorage.setItem(TOOL_KEY, JSON.stringify(tool)), [tool]);
  useEffect(() => localStorage.setItem(COLOR_KEY, color.id), [color]);

  // Game taps batch on the same ~33 ms cadence the drawing path uses.
  const pendingGame = useRef<{ angle: number; radius: number }[]>([]);
  const speciesRef = useRef(mySpecies);
  speciesRef.current = mySpecies;
  useEffect(() => {
    const flush = setInterval(() => {
      if (!pendingGame.current.length) return;
      client.gameInput(speciesRef.current, pendingGame.current);
      pendingGame.current = [];
    }, 33);
    return () => clearInterval(flush);
  }, [client]);

  const game = snap?.game.active ?? null;
  const gameInfo = GAMES.find((g) => g.kind === game);
  const species = Math.min(Math.max(snap?.game.species ?? 3, gameInfo?.knob.min ?? 2), gameInfo?.knob.max ?? 8);
  useEffect(() => {
    if (mySpecies === ERASE_SPECIES) {
      if (game !== "life") setMySpecies(0);
    } else if (mySpecies >= species) {
      setMySpecies(0);
    }
  }, [species, mySpecies, game]);

  const caps = snap?.caps ?? { draw: false, effects: false, games: false, knobs: false, preview: false };
  const perks = new Set(snap?.perks ?? []);
  const maxSize = snap?.max_dab_size ?? 0.25;
  useEffect(() => {
    if (size > maxSize) setSize(maxSize);
  }, [maxSize, size]);

  // Playing a game takes the whole surface; otherwise the chosen tool does.
  const playing = !!game && caps.games;
  const drawing = !playing && tool.kind === "pen" && caps.draw;
  const tapping = !playing && tool.kind === "effect" && caps.effects;
  const anything = playing || drawing || tapping;

  // Live ring when the operator streams one; a quiet schematic otherwise. The
  // static source keeps GateCanvas's pointer handling without a stream.
  const stream = (snap?.preview_fps ?? 0) > 0;
  const quietSource = useMemo<GatePreviewSource | undefined>(() => {
    if (!snap || stream) return undefined;
    return {
      meta: {
        spokes: snap.spokes,
        pixels: 8,
        decimate: 1,
        outer_radius_ft: snap.outer_radius_ft,
        inner_radius_ft: snap.inner_radius_ft,
      },
      subscribe: () => () => {},
    };
  }, [snap?.spokes, snap?.outer_radius_ft, snap?.inner_radius_ft, stream, snap]);

  const drawPen: DrawPen | undefined = drawing && tool.kind === "pen"
    ? { pen: tool.pen, hue: color.hue, saturation: color.saturation, brightness: color.brightness, size, intensity: 1 }
    : undefined;

  const onTap = anything && !drawing
    ? (angle: number, radius: number) => {
        if (playing) {
          if (game === "radial_tetris") client.gameInput(speciesRef.current, [{ angle, radius }]);
          else pendingGame.current.push({ angle, radius });
          return;
        }
        if (tool.kind !== "effect") return;
        const shape = isShape(tool.effect);
        client.triggerEffect({
          kind: tool.effect,
          angle,
          radius,
          size: shape ? 0.9 : 1,
          hue: color.hue,
          saturation: color.saturation,
          brightness: color.brightness,
        });
      }
    : undefined;

  const ripple = (e: React.PointerEvent) => {
    const stage = stageRef.current;
    if (!stage || !anything) return;
    const rect = stage.getBoundingClientRect();
    const hex = playing && game ? speciesColor(speciesRef.current === ERASE_SPECIES ? 0 : speciesRef.current, species) : color.hex;
    ripples.current.push({ x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height, t: performance.now(), hex });
    if (ripples.current.length > 24) ripples.current.shift();
  };

  const title = snap?.title || "Empyrean Gate";

  return (
    <div className={`public-app ${anything ? "" : "closed"}`} data-connected={connected && snap ? "yes" : "no"}>
      <header className="public-top">
        <span className={connected ? "conn-dot on" : "conn-dot"} aria-label={connected ? "connected" : "connecting"} />
        <h1>{title}</h1>
        <span className="public-players" aria-label="people playing">
          {snap ? `${snap.players} playing` : ""}
        </span>
        <NameChip client={client} />
      </header>

      {playing && gameInfo && (
        <div className="banner game-banner public-banner" role="status">
          <strong>GAME · {gameInfo.name}</strong>
          <span>{gameInfo.howTo}</span>
        </div>
      )}
      {snap && !anything && (
        <div className="banner warn public-banner" role="status">
          {!snap.open
            ? "The floor is closed right now — look up, the show is on."
            : game && !caps.games
              ? "A game is running on the array; the floor is watching this one."
              : "Nothing is open to play right now — look up."}
        </div>
      )}
      {!snap && (
        <div className="banner public-banner public-connecting" role="status">
          {denied ?? (connected ? "Joining…" : "Connecting to the floor…")}
        </div>
      )}
      {(snap?.unlocked.length ?? 0) > 0 && (
        <div className="public-unlocked" role="status">
          ✦ Unlocked: {snap!.unlocked.join(", ")}
        </div>
      )}

      <main className="public-main">
        <div
          ref={stageRef}
          className={`public-stage ${anything ? "live" : ""}`}
          onPointerDownCapture={ripple}
        >
          {snap && <Schematic spokes={snap.spokes} inner={snap.inner_radius_ft / snap.outer_radius_ft} />}
          {snap && (
            <GateCanvas
              transport={client}
              previewSource={quietSource}
              previewFps={stream ? snap.preview_fps : undefined}
              previewDecimate={stream ? snap.preview_decimate : undefined}
              onTap={onTap}
              drawPen={drawPen}
            />
          )}
          <Ripples events={ripples} />
        </div>

        <section className="public-tools" aria-label="What a touch does">
          {playing && gameInfo && (
            <>
              <div className="public-row-label">Your color</div>
              <div className="games-species">
                {Array.from({ length: species }, (_, s) => (
                  <button
                    key={s}
                    className={`games-chip ${mySpecies === s ? "active" : ""}`}
                    style={{ ["--chip" as string]: speciesColor(s, species) }}
                    aria-label={`Color ${s + 1}`}
                    onClick={() => setMySpecies(s)}
                  >
                    {s + 1}
                  </button>
                ))}
                {game === "life" && (
                  <button
                    className={`games-chip erase ${mySpecies === ERASE_SPECIES ? "active" : ""}`}
                    aria-label="Erase"
                    onClick={() => setMySpecies(ERASE_SPECIES)}
                  >
                    ✕
                  </button>
                )}
              </div>
              {game === "radial_tetris" && (
                <div className="ringfall-controls public-ringfall" role="group" aria-label="Ringfall controls">
                  {RINGFALL_COMMANDS.map((control) => (
                    <button
                      key={control.command}
                      className={control.strong ? "primary" : "ghost"}
                      onClick={() => client.gameCommand(control.command)}
                      aria-label={`${control.label} — ${control.detail}`}
                    >
                      <span className="ringfall-control-icon">{control.icon}</span>
                      <span>
                        <strong>{control.label}</strong>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {snap?.game.summary && <p className="hint public-summary">{snap.game.summary}</p>}
            </>
          )}

          {!playing && (caps.effects || caps.draw) && (
            <>
              <div className="public-row-label">Tap the array to…</div>
              <div className="public-pads">
                {caps.effects &&
                  PUBLIC_EFFECTS.map((e) => (
                    <button
                      key={e.kind}
                      className={`public-pad ${tool.kind === "effect" && tool.effect === e.kind ? "active" : ""}`}
                      onClick={() => setTool({ kind: "effect", effect: e.kind })}
                    >
                      {e.label}
                    </button>
                  ))}
                {caps.effects && perks.has("strobe") && (
                  <button
                    className={`public-pad perk ${tool.kind === "effect" && tool.effect === "strobe" ? "active" : ""}`}
                    onClick={() => setTool({ kind: "effect", effect: STROBE.kind })}
                  >
                    ✦ {STROBE.label}
                  </button>
                )}
                {caps.effects &&
                  SHAPES.map((s) => (
                    <button
                      key={s.kind}
                      className={`public-pad shape ${tool.kind === "effect" && tool.effect === s.kind ? "active" : ""}`}
                      aria-label={s.label}
                      onClick={() => setTool({ kind: "effect", effect: s.kind })}
                    >
                      <ShapeIcon kind={s.kind} />
                    </button>
                  ))}
              </div>
              {caps.draw && (
                <>
                  <div className="public-row-label">…or drag to draw with</div>
                  <div className="public-pens">
                    {PENS.map((p) => (
                      <button
                        key={p}
                        className={`pen-btn public-pen ${tool.kind === "pen" && tool.pen === p ? "active" : ""}`}
                        aria-label={`${PEN_LABEL[p]} pen`}
                        onClick={() => setTool({ kind: "pen", pen: p })}
                      >
                        <ToolIcon kind={p} />
                        <span>{PEN_LABEL[p]}</span>
                      </button>
                    ))}
                    <label className="public-size">
                      <span>Size{perks.has("big_brush") ? " ✦" : ""}</span>
                      <input
                        type="range"
                        min={0.03}
                        max={maxSize}
                        step={0.01}
                        value={Math.min(size, maxSize)}
                        aria-label="Stroke size"
                        onChange={(e) => setSize(Number(e.target.value))}
                      />
                    </label>
                  </div>
                </>
              )}
              <div className="public-row-label">Color</div>
              <div className="swatches public-swatches">
                {BUILTIN_LIVE_COLORS.map((c) => (
                  <button
                    key={c.id}
                    className={`swatch ${color.id === c.id ? "active" : ""}`}
                    style={{ background: c.hex }}
                    aria-label={c.label}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </>
          )}
        </section>
      </main>

      <footer className="public-foot">
        <CodeEntry client={client} />
        <span className="public-credit">Empyrean Gate · public floor</span>
      </footer>
    </div>
  );
}
