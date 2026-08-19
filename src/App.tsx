import { useEffect, useState } from "react";
import Control from "./Control";
import Draw from "./Draw";
import { EFFECTS } from "./effects";
import Settings from "./Settings";
import { useGate } from "./state";
import View from "./View";

const TABS = [
  { id: "view", label: "View" },
  { id: "draw", label: "Draw" },
  { id: "control", label: "Control" },
  { id: "settings", label: "Settings" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function tabFromHash(): TabId {
  const h = location.hash.replace("#", "");
  return (TABS.find((t) => t.id === h)?.id ?? "view") as TabId;
}

const IN_TAURI = "__TAURI_INTERNALS__" in window;

async function openNewWindow(tab: TabId) {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const label = `aux-${tab}-${Date.now() % 100000}`;
  new WebviewWindow(label, {
    url: `/#${tab}`,
    title: `Empyrean Gate — ${tab}`,
    width: 900,
    height: 900,
  });
}

function ConnectModal({ onClose }: { onClose: () => void }) {
  const { client, config, status } = useGate();
  const interfaces = status?.interfaces ?? [];
  const [ip, setIp] = useState<string>("");
  const chosen = ip || interfaces[0]?.split("—").pop()?.trim() || "";
  const port = config?.server.port ?? 9520;
  const url = `http://${chosen}:${port}/?join=${config?.server.join_token ?? ""}`;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Connect a device</h2>
        <p className="hint">Scan from a phone/iPad on the same network, then Add to Home Screen.</p>
        {interfaces.length > 1 && (
          <select value={chosen} onChange={(e) => setIp(e.target.value)}>
            {interfaces.map((i) => {
              const addr = i.split("—").pop()?.trim() ?? i;
              return (
                <option key={i} value={addr}>
                  {i}
                </option>
              );
            })}
          </select>
        )}
        {chosen ? (
          <img
            className="qr"
            src={`${client.httpBase}/qr.svg?data=${encodeURIComponent(url)}`}
            alt={`QR code for ${url}`}
          />
        ) : (
          <p className="warn">No network interface found.</p>
        )}
        <code className="join-url">{url}</code>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

export default function App() {
  const { connected, status, errors, dismissError, client, denied } = useGate();
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const [showConnect, setShowConnect] = useState(false);

  // Hash <-> tab sync, so PWA shortcuts / popped-out windows can pin a mode.
  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const selectTab = (t: TabId) => {
    location.hash = t;
    setTab(t);
  };

  // Global keyboard: 1-4 fire effects.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const fx = EFFECTS.find((f) => f.key === e.key);
      if (fx) {
        client.triggerEffect({ kind: fx.kind, angle: Math.random() * Math.PI * 2 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [client]);

  if (denied) {
    return (
      <div className="app denied-screen">
        <h1>Not connected</h1>
        <p>{denied}</p>
        <p className="hint">
          Ask the operator, then reload this page (or re-scan the Connect QR code).
        </p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>Empyrean Gate</h1>
        <nav>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "active" : ""}
              onClick={() => selectTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        <button className="ghost" onClick={() => setShowConnect(true)}>
          ⊕ Connect
        </button>
        {IN_TAURI && (
          <button className="ghost" onClick={() => void openNewWindow(tab)}>
            ⧉ New window
          </button>
        )}
        {status && <span className="gpu-name">{status.gpu_name}</span>}
        <span className={connected ? "conn ok" : "conn bad"}>
          {connected ? "connected" : "reconnecting…"}
        </span>
      </header>

      {status?.gpu_error && (
        <div className="banner error">
          <strong>GPU error:</strong> {status.gpu_error}
        </div>
      )}
      {errors.map((e, i) => (
        <div key={i} className="banner warn" onClick={() => dismissError(i)}>
          {e} <span className="hint">(click to dismiss)</span>
        </div>
      ))}

      <main>
        {tab === "view" && <View />}
        {tab === "draw" && <Draw />}
        {tab === "control" && <Control />}
        {tab === "settings" && <Settings />}
      </main>

      {showConnect && <ConnectModal onClose={() => setShowConnect(false)} />}
    </div>
  );
}
