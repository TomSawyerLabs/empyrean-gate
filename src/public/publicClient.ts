// The public floor's WebSocket client. Same JSON protocol as the operator
// UI's `GateClient`, but only the half the public listener accepts (see
// src-tauri/src/public.rs `gate`), plus: remembered keys replayed on hello,
// a `public_state` snapshot instead of the show's config/status, and a
// jittered backoff so a thousand phones never reconnect in step.

import type { CanvasTransport } from "../GateCanvas";
import { confirmDeviceName, loadDeviceName } from "../deviceNames";
import { SHAPE_STYLE_DEFAULTS } from "../shapeStyle";
import type {
  EffectCfg,
  GameCommand,
  PenKind,
  PreviewFrame,
  PublicSnapshot,
  ServerMsg,
} from "../types";
import { parsePreview } from "../ws";

const ID_KEY = "empyrean-public-id";
const KEYS_KEY = "empyrean-public-keys";
const MAX_KEYS = 8;

/** Where this page reaches its backend. Served by the public listener the
 *  answer is "same origin"; under Vite it is the public port on this host
 *  (`?backend=9521` to pick another). */
function resolveBase(): { http: string; ws: string } {
  if (import.meta.env.DEV) {
    const q = new URLSearchParams(location.search).get("backend");
    const port = q && /^\d+$/.test(q) ? Number(q) : 9521;
    return { http: `http://${location.hostname}:${port}`, ws: `ws://${location.hostname}:${port}/ws` };
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return { http: location.origin, ws: `${proto}://${location.host}/ws` };
}

function loadKeys(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEYS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === "string") : [];
  } catch {
    return [];
  }
}

function saveKeys(keys: string[]) {
  localStorage.setItem(KEYS_KEY, JSON.stringify(keys.slice(-MAX_KEYS)));
}

/** A key arriving in the URL — `?key=<secret>` or `/k/<secret>` — is kept on
 *  the phone and taken out of the address bar, so the unlock survives a
 *  reload and a screenshot of the page does not hand the secret on. */
export function absorbKeyFromUrl(): string | null {
  const params = new URLSearchParams(location.search);
  let key = params.get("key");
  const path = /^\/k\/([^/]+)\/?$/.exec(location.pathname);
  if (!key && path) key = decodeURIComponent(path[1]);
  if (!key) return null;
  const keys = loadKeys();
  if (!keys.includes(key)) keys.push(key);
  saveKeys(keys);
  params.delete("key");
  const query = params.size > 0 ? `?${params.toString()}` : "";
  history.replaceState(null, "", `/${query}${location.hash}`);
  return key;
}

type Unsub = () => void;

export class PublicClient implements CanvasTransport {
  readonly clientId: string;
  httpBase = "";
  snapshot: PublicSnapshot | null = null;
  connected = false;
  /** Set when the server refused this connection; cleared on the next attempt. */
  denied: string | null = null;

  private ws: WebSocket | null = null;
  private closed = false;
  private attempt = 0;
  private retryTimer: number | null = null;
  private snapshotListeners = new Set<(s: PublicSnapshot) => void>();
  private statusListeners = new Set<(up: boolean) => void>();
  private frameListeners = new Set<(f: PreviewFrame) => void>();
  private messageListeners = new Set<(m: ServerMsg) => void>();
  private nameListeners = new Set<(name: string) => void>();

  constructor() {
    this.clientId = localStorage.getItem(ID_KEY) ?? this.mintId();
  }

  private mintId(): string {
    const random =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
    const id = `pub-${random}`;
    localStorage.setItem(ID_KEY, id);
    return id;
  }

  get deviceName(): string {
    return loadDeviceName();
  }

  setDeviceName(name: string) {
    const clean = name.trim().slice(0, 40);
    if (!clean) return;
    localStorage.setItem("empyrean-client-name", clean);
    confirmDeviceName();
    this.send({ type: "set_client_name", name: clean });
    this.nameListeners.forEach((l) => l(clean));
  }

  connect() {
    if (this.closed) return;
    const base = resolveBase();
    this.httpBase = base.http;
    this.denied = null;
    const ws = new WebSocket(base.ws);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.connected = true;
      this.send({
        type: "hello",
        name: this.deviceName,
        client_id: this.clientId,
        token: "",
        surface: "public",
        keys: loadKeys(),
      });
      this.statusListeners.forEach((l) => l(true));
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        const msg = JSON.parse(ev.data) as ServerMsg;
        if (msg.type === "public_state") {
          this.snapshot = msg.state;
          this.snapshotListeners.forEach((l) => l(msg.state));
        } else if (msg.type === "denied") {
          this.denied = msg.reason;
        }
        this.messageListeners.forEach((l) => l(msg));
        return;
      }
      const parsed = parsePreview(ev.data as ArrayBuffer);
      if (parsed?.bus === "program") {
        this.send({ type: "preview_ack", frame: parsed.frame.frameNumber });
        this.frameListeners.forEach((l) => l(parsed.frame));
      }
    };
    ws.onclose = () => {
      const wasUp = this.connected;
      this.connected = false;
      if (wasUp) this.statusListeners.forEach((l) => l(false));
      if (this.closed) return;
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  /** Exponential backoff with jitter: 1 s doubling to 30 s, each spread over
   *  ±50 % so a floor of phones that all lost the proxy at once comes back as
   *  a trickle. A refusal (blocked, closing, full) waits the full 30 s — the
   *  answer is not going to change in a hurry. */
  private scheduleReconnect() {
    this.attempt += 1;
    const base = this.denied ? 30_000 : Math.min(30_000, 1000 * 2 ** Math.min(this.attempt - 1, 5));
    const delay = base * (0.5 + Math.random());
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => this.connect(), delay);
  }

  close() {
    this.closed = true;
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.ws?.close();
  }

  send(msg: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  // --- CanvasTransport ---
  subscribePreview(fps: number, decimate: number) {
    this.send({ type: "subscribe_preview", fps, decimate, include_ready: false });
  }
  onFrame(l: (f: PreviewFrame) => void): Unsub {
    this.frameListeners.add(l);
    return () => this.frameListeners.delete(l);
  }
  onMessage(l: (m: ServerMsg) => void): Unsub {
    this.messageListeners.add(l);
    return () => this.messageListeners.delete(l);
  }
  onStatus(l: (up: boolean) => void): Unsub {
    this.statusListeners.add(l);
    return () => this.statusListeners.delete(l);
  }
  onSnapshot(l: (s: PublicSnapshot) => void): Unsub {
    this.snapshotListeners.add(l);
    return () => this.snapshotListeners.delete(l);
  }
  onDeviceName(l: (name: string) => void): Unsub {
    this.nameListeners.add(l);
    return () => this.nameListeners.delete(l);
  }

  // --- play ---
  unlock(code: string) {
    const clean = code.trim();
    if (!clean) return;
    const keys = loadKeys();
    if (!keys.includes(clean)) saveKeys([...keys, clean]);
    this.send({ type: "unlock", key: clean });
  }

  /** Forget a key the server said is useless, so hello stops replaying it. */
  forgetKey(code: string) {
    saveKeys(loadKeys().filter((k) => k !== code));
  }

  triggerEffect(effect: Partial<EffectCfg> & { kind: EffectCfg["kind"] }) {
    this.send({
      type: "trigger_effect",
      effect: {
        angle: 0,
        radius: 1,
        intensity: 1,
        size: 1,
        hue: -1,
        saturation: 0.85,
        brightness: 1,
        duration: 0,
        rotation: 0,
        grow: 0,
        ...SHAPE_STYLE_DEFAULTS,
        ...effect,
      },
    });
  }

  paint(pen: PenKind, points: { angle: number; radius: number; dir?: number }[], color: { hue: number; saturation: number; brightness: number }, size: number) {
    this.send({ type: "paint", pen, points, ...color, size, intensity: 1 });
  }

  gameInput(species: number, points: { angle: number; radius: number }[]) {
    this.send({ type: "game_input", species, points });
  }

  gameCommand(command: GameCommand) {
    this.send({ type: "game_command", command });
  }
}
