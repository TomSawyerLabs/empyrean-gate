// WebSocket client for the Gate backend. Used identically by the Tauri webview,
// LAN browsers, and phones. Text = JSON protocol; binary = preview frames.

import type { EffectCfg, LayerCfg, AppConfig, PreviewFrame, ServerMsg } from "./types";

const PREVIEW_MAGIC = 0x45475056;

type Listener = (msg: ServerMsg) => void;
type FrameListener = (frame: PreviewFrame) => void;
type StatusListener = (connected: boolean) => void;

async function resolveWsUrl(): Promise<string> {
  // Inside the Tauri webview, ask the shell which port the backend bound.
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown };
  if (w.__TAURI_INTERNALS__) {
    const { invoke } = await import("@tauri-apps/api/core");
    const info = (await invoke("backend_info")) as { wsPort: number };
    return `ws://127.0.0.1:${info.wsPort}/ws`;
  }
  // Vite dev server: backend runs on its default port on the same host.
  if (location.port === "1420") {
    return `ws://${location.hostname}:9520/ws`;
  }
  // Served by the backend itself.
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws`;
}

/// On (re)connect, detect a UI bundle older than what the backend now serves and
/// refresh. Vite content-hashes bundle filenames, so comparing the entry script name
/// in the freshly-fetched index.html against the one this page loaded is exact.
/// Meaningless in the Tauri webview (assets ship with the binary) and vite dev (HMR).
async function reloadIfStale(): Promise<void> {
  if ("__TAURI_INTERNALS__" in window || import.meta.env.DEV) return;
  try {
    const res = await fetch("/index.html", { cache: "no-store" });
    if (!res.ok) return;
    const served = (await res.text()).match(/\/assets\/index-[\w-]+\.js/)?.[0];
    const current = document
      .querySelector('script[src*="/assets/index-"]')
      ?.getAttribute("src");
    if (!served || !current || served === current) return;
    // One reload per target bundle — never loop even if something still serves stale.
    if (sessionStorage.getItem("empyrean-reloaded-for") === served) return;
    sessionStorage.setItem("empyrean-reloaded-for", served);
    location.reload();
  } catch {
    // Offline or backend restarting; the next reconnect will check again.
  }
}

export class GateClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private frameListeners = new Set<FrameListener>();
  private statusListeners = new Set<StatusListener>();
  private closed = false;
  private retryMs = 500;
  clientId: string;

  constructor() {
    this.clientId = localStorage.getItem("empyrean-client-id") ?? this.newClientId();
  }

  private newClientId(): string {
    const id = `client-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem("empyrean-client-id", id);
    return id;
  }

  async connect(): Promise<void> {
    if (this.closed) return;
    const url = await resolveWsUrl();
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      this.retryMs = 500;
      void reloadIfStale();
      this.send({ type: "hello", name: navigator.userAgent, client_id: this.clientId, token: "" });
      this.statusListeners.forEach((l) => l(true));
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        const msg = JSON.parse(ev.data) as ServerMsg;
        this.listeners.forEach((l) => l(msg));
      } else {
        const frame = parsePreview(ev.data as ArrayBuffer);
        if (frame) this.frameListeners.forEach((l) => l(frame));
      }
    };
    ws.onclose = () => {
      this.statusListeners.forEach((l) => l(false));
      if (!this.closed) {
        setTimeout(() => void this.connect(), this.retryMs);
        this.retryMs = Math.min(this.retryMs * 2, 5000);
      }
    };
    ws.onerror = () => ws.close();
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }

  onMessage(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onFrame(l: FrameListener): () => void {
    this.frameListeners.add(l);
    return () => this.frameListeners.delete(l);
  }

  onStatus(l: StatusListener): () => void {
    this.statusListeners.add(l);
    return () => this.statusListeners.delete(l);
  }

  send(msg: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  // --- convenience wrappers ---
  setConfig(config: AppConfig) {
    this.send({ type: "set_config", config });
  }
  setMaster(v: { brightness?: number; speed?: number }) {
    this.send({ type: "set_master", ...v });
  }
  setSacnEnabled(enabled: boolean) {
    this.send({ type: "set_sacn_enabled", enabled });
  }
  addLayer(layer: LayerCfg) {
    this.send({ type: "add_layer", layer });
  }
  updateLayer(index: number, layer: LayerCfg) {
    this.send({ type: "update_layer", index, layer });
  }
  removeLayer(index: number) {
    this.send({ type: "remove_layer", index });
  }
  moveLayer(from: number, to: number) {
    this.send({ type: "move_layer", from, to });
  }
  triggerEffect(effect: Partial<EffectCfg> & { kind: EffectCfg["kind"] }) {
    this.send({
      type: "trigger_effect",
      effect: {
        angle: 0,
        radius: 1,
        intensity: 1,
        hue: -1,
        duration: 0,
        ...effect,
      },
    });
  }
  subscribePreview(fps: number, decimate: number) {
    this.send({ type: "subscribe_preview", fps, decimate });
  }
  sendAudioFrame(f: { level: number; bass: number; mid: number; treble: number; flux: number }) {
    this.send({ type: "audio_frame", ...f });
  }
  sendImu(f: { yaw: number; pitch: number; roll: number; shake: number }) {
    this.send({ type: "imu", ...f });
  }
}

function parsePreview(buf: ArrayBuffer): PreviewFrame | null {
  if (buf.byteLength < 12) return null;
  const view = new DataView(buf);
  if (view.getUint32(0, true) !== PREVIEW_MAGIC) return null;
  const frameNumber = view.getUint32(4, true);
  const spokes = view.getUint16(8, true);
  const pixels = view.getUint16(10, true);
  const rgb = new Uint8Array(buf, 12);
  if (rgb.length < spokes * pixels * 3) return null;
  return { frameNumber, spokes, pixels, rgb };
}
