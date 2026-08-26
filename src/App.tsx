import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import Control from "./Control";
import Games from "./Games";
import { EFFECTS } from "./effects";
import Live from "./Live";
import { loadSelectedLiveColor } from "./liveColors";
import Media from "./Media";
import Replay from "./Replay";
import ReportModal from "./Report";
import Settings from "./Settings";
import Test from "./Test";
import { contenders, peerLabel, peerVerdict, severity } from "./sacnPeers";
import Ready from "./Ready";
import { useGate } from "./state";
import Participate from "./Participate";
import ParticipationControl from "./ParticipationControl";

// The patch editor pulls in React Flow; lazy so phones on the play surfaces
// never pay for it.
const Patch = lazy(() => import("./Patch"));

const TABS = [
  { id: "live", label: "Live" },
  { id: "ready", label: "Ready" },
  { id: "media", label: "Media" },
  { id: "patch", label: "Patch" },
  { id: "replay", label: "Archive" },
  { id: "control", label: "Control" },
  { id: "games", label: "Games" },
  { id: "test", label: "Test" },
  { id: "settings", label: "Settings" },
] as const;

const NAV_TABS: ReadonlyArray<{ id: TabId; label: string }> = TABS;

type TabId = (typeof TABS)[number]["id"];

function tabFromHash(): TabId {
  const h = location.hash.replace("#", "");
  // Old bookmarks / PWA shortcuts used #view and #draw; both merged into Live.
  if (h === "view" || h === "draw") return "live";
  return (TABS.find((t) => t.id === h)?.id ?? "live") as TabId;
}

const IN_TAURI = "__TAURI_INTERNALS__" in window;
const IS_LOCAL_UI = IN_TAURI || ["localhost", "127.0.0.1", "::1"].includes(location.hostname);

const SHOW_MODE_KEY = "empyrean-show-mode";

function defaultPerformanceName(): string {
  return `Performance ${new Date().toLocaleString([], {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  })}`;
}
/// Date (local) that the scheduled show-mode exit last fired, so it fires once a day.
const SHOW_MODE_LEFT_KEY = "empyrean-show-mode-left-on";

/// Show mode: the native window goes real fullscreen while retaining the tab bar,
/// so every performance surface stays reachable. The preference lives in
/// localStorage (which survives restarts and self-update binary swaps, since the
/// webview data folder is keyed by the app identifier), and is re-applied on
/// mount — so the app comes back in whatever state it was closed in. Browser
/// clients get the chrome-hiding half; only Tauri can take a window fullscreen.
function useShowMode(leaveAt: string | null | undefined): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => localStorage.getItem(SHOW_MODE_KEY) === "1");

  const set = useCallback((next: boolean) => {
    setOn(next);
    localStorage.setItem(SHOW_MODE_KEY, next ? "1" : "0");
  }, []);

  // Drop out of show mode once a day, at a local hour when the Gate is washed
  // out by daylight anyway.
  //
  // Show mode hides the chrome an update is offered through, so a rig left in it
  // with auto-install switched off for the night would never take an update
  // again. This is what makes "not tonight" mean tonight rather than forever.
  //
  // Keyed on the DATE it last fired, not on "is it 09:00 right now": a machine
  // asleep or a tab throttled across the boundary still leaves show mode on its
  // next tick instead of silently missing the day.
  useEffect(() => {
    if (!on || !leaveAt) return;
    const match = /^(\d{1,2}):(\d{2})$/.exec(leaveAt.trim());
    if (!match) return;
    const dueMinutes = Number(match[1]) * 60 + Number(match[2]);

    const check = () => {
      const now = new Date();
      const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
      if (localStorage.getItem(SHOW_MODE_LEFT_KEY) === today) return;
      if (now.getHours() * 60 + now.getMinutes() < dueMinutes) return;
      localStorage.setItem(SHOW_MODE_LEFT_KEY, today);
      set(false);
    };

    // Mark today as already handled when show mode is turned on AFTER the hour
    // has passed — otherwise entering show mode at 21:00 would immediately kick
    // you back out, having "crossed" 09:00 twelve hours ago.
    const now = new Date();
    if (now.getHours() * 60 + now.getMinutes() >= dueMinutes) {
      const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
      if (localStorage.getItem(SHOW_MODE_LEFT_KEY) !== today) {
        localStorage.setItem(SHOW_MODE_LEFT_KEY, today);
      }
    }

    const timer = window.setInterval(check, 30_000);
    return () => window.clearInterval(timer);
  }, [on, leaveAt, set]);

  useEffect(() => {
    if (!IN_TAURI) return;
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setFullscreen(on);
    })();
  }, [on]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        set(!on);
      } else if (e.key === "Escape" && on && !document.querySelector(".modal-backdrop")) {
        // A dialog on top owns Escape first — leaving show mode out from under
        // an open Report would lose what the operator had typed.
        e.preventDefault();
        set(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on, set]);

  return [on, set];
}

async function openNewWindow(tab: TabId) {
  // Rust creates it with a stable label (aux-<tab>) so its geometry persists and
  // it is recreated after restarts/self-updates; re-invoking focuses the existing.
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_aux", { tab });
}

/// Fullscreen overlay while the backend is unreachable. Appears after a short
/// grace period (so sub-second blips never flash it) and dismisses itself the
/// moment the connection returns.
function DisconnectedOverlay({ disabled = false }: { disabled?: boolean }) {
  const { connected } = useGate();
  const [visible, setVisible] = useState(false);
  const [since, setSince] = useState<number | null>(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (connected) {
      setVisible(false);
      setSince(null);
      return;
    }
    const started = Date.now();
    setSince(started);
    const grace = setTimeout(() => setVisible(true), 2000);
    const tick = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => {
      clearTimeout(grace);
      clearInterval(tick);
    };
  }, [connected]);

  if (disabled || !visible || connected) return null;
  const secs = since ? Math.floor((Date.now() - since) / 1000) : 0;
  return (
    <div className="disconnected-overlay">
      <div className="disconnected-box">
        <div className="disconnected-spinner" />
        <h1>Backend unreachable</h1>
        <p>
          Lost the connection to the Empyrean Gate backend
          {secs >= 5 ? ` ${secs} seconds ago` : ""}. Reconnecting automatically — this
          message will disappear as soon as it&apos;s back.
        </p>
        <p className="hint">
          If it doesn&apos;t come back: is the Gate app (or headless backend) running? Are
          you on the same network?
        </p>
      </div>
    </div>
  );
}

/// The update controls that show mode gets, since it hides the top bar the
/// version chip lives in. Renders nothing at all until there is an update to
/// act on — the show surface is deliberately near-empty.
///
/// Installing mid-show is allowed on purpose: the two-phase handover costs about
/// a frame, which is the whole reason it exists. What was missing was any way to
/// see it coming or to say "not during this set".
function ShowModeUpdate() {
  const { client, status, config } = useGate();
  const [busy, setBusy] = useState(false);
  const next = status?.update_available;
  if (!next || !config) return null;

  const auto = config.update.auto_install;
  const note = status?.update_state;
  return (
    <div className="show-update">
      <button
        className="show-update-install"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          client.send({ type: "install_update" });
        }}
      >
        {busy || note === "handing over…"
          ? `Updating to v${next}…`
          : status?.update_staged
            ? `⤓ Update to v${next} now`
            : `⤓ Get v${next}`}
      </button>
      <label className="show-update-auto">
        <input
          type="checkbox"
          checked={auto}
          onChange={(event) =>
            client.setConfig({
              ...config,
              update: { ...config.update, auto_install: event.target.checked },
            })
          }
        />
        <span>Auto-update</span>
      </label>
    </div>
  );
}

/// Small version tag in the corner. Click checks for updates; when a newer
/// release is known it lights up and a click hot-swaps to it (seamless takeover).
function VersionChip() {
  const { client, status } = useGate();
  const [busy, setBusy] = useState(false);
  if (!status?.version) return null;
  const next = status.update_available;
  const note = status.update_state;

  if (next) {
    return (
      <button
        className="version-chip update"
        onClick={() => {
          setBusy(true);
          client.send({ type: "install_update" });
        }}
      >
        v{status.version} → v{next}
        {busy || note ? ` · ${note || "updating…"}` : " · click to update"}
      </button>
    );
  }
  return (
    <button
      className="version-chip"
      onClick={() => client.send({ type: "check_update" })}
    >
      v{status.version}
      {note ? ` · ${note}` : ""}
    </button>
  );
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

/// The X on a touch display sits a few pixels from the controls, and hitting it
/// mid-show kills the engine and blacks out the rig. The native side refuses the
/// close while sACN is transmitting and asks here instead; anything else (output
/// off, no show running) closes normally with no dialog in the way.
function CloseGuard() {
  const { status } = useGate();
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!IN_TAURI) return;
    let stop: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const { invoke } = await import("@tauri-apps/api/core");
      stop = await listen("close-requested", () => setAsking(true));
      // Only now is the guard allowed to refuse a close. If this never runs —
      // the webview failed to load, an older build, a crash on mount — the
      // native side stays disarmed and the window closes normally.
      await invoke("set_close_guard_ready", { ready: true });
    })();
    return () => {
      stop?.();
      void import("@tauri-apps/api/core").then(({ invoke }) =>
        invoke("set_close_guard_ready", { ready: false }),
      );
    };
  }, []);

  if (!asking) return null;
  const universes = status?.sacn_universes ?? 0;
  const invokeCommand = async (command: string) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke(command);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal close-guard">
        <h2>The show is live</h2>
        <p>
          sACN is transmitting{universes > 0 ? ` on ${universes} universes` : ""}.
          Closing stops the engine and the lights go dark.
        </p>
        <button
          className="primary"
          autoFocus
          onClick={() => {
            setAsking(false);
            void invokeCommand("cancel_close");
          }}
        >
          Keep the show running
        </button>
        <button className="danger" onClick={() => void invokeCommand("confirm_close")}>
          Stop the show and close
        </button>
      </div>
    </div>
  );
}

/// Another sACN source is driving universes we drive.
///
/// This gets banner treatment for the same reason test mode does: it changes what
/// the rig is doing, the cause is off-screen, and every second spent looking for
/// the bug in the show is a second wasted. Shown on every tab and in show mode —
/// being mid-performance is exactly when it matters.
function SacnContentionBanner() {
  const { status } = useGate();
  const peers = status?.sacn_peers ?? [];
  const level = severity(peers);
  if (level === "clear") return null;
  const rivals = contenders(peers);
  const headline =
    level === "overridden"
      ? "Another sACN source is overriding this one"
      : level === "merging"
        ? "Another sACN source is merging with this one"
        : "Another sACN source shares these universes";

  return (
    <div className={`banner sacn-peer-banner ${level}`}>
      <span className="sacn-peer-dot" />
      <div className="sacn-peer-body">
        <strong>{headline}</strong>
        <ul>
          {rivals.slice(0, 3).map((p) => (
            <li key={p.cid}>
              <span className="sacn-peer-name">{peerLabel(p)}</span>
              {p.from_ip && p.source_name ? <span className="hint"> at {p.from_ip}</span> : null}
              {" — "}
              {peerVerdict(p)}
            </li>
          ))}
        </ul>
        {rivals.length > 3 && (
          <span className="hint">and {rivals.length - 3} more — see Test → Controllers</span>
        )}
      </div>
    </div>
  );
}

/// Everything the ≤700px topbar cannot show, behind one corner button.
///
/// A phone has room for a single row of chrome, and the Live tab wants every pixel
/// under it. The old narrow breakpoint spent that row on a two-line grid of seven
/// tabs and simply `display: none`d Show mode, Connect, New window, the connection
/// state and the version chip — which made them unreachable rather than merely
/// small. They all live in here now, and the tab row's height goes back to the
/// array.
function TopbarMenu({
  tab,
  onSelectTab,
  onClose,
  onShowMode,
  onConnect,
  onNewWindow,
  newWindowBusy,
}: {
  tab: TabId;
  onSelectTab: (t: TabId) => void;
  onClose: () => void;
  onShowMode: () => void;
  onConnect: () => void;
  onNewWindow: () => void;
  newWindowBusy: boolean;
}) {
  const { connected, status } = useGate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="topbar-menu-backdrop" onClick={onClose}>
      <div className="topbar-menu" onClick={(e) => e.stopPropagation()}>
        {/* The backdrop covers the topbar, so the button that opened this is not
            available to close it. Tapping outside works but is not discoverable;
            an explicit × is. The app name comes back with it — the narrow topbar
            has no room for the title. */}
        <div className="topbar-menu-head">
          <h2>Empyrean Gate</h2>
          <button className="ghost" aria-label="Close menu" onClick={onClose}>
            ×
          </button>
        </div>
        <nav className="topbar-menu-tabs">
          {NAV_TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "active" : ""}
              onClick={() => {
                onSelectTab(t.id);
                onClose();
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="topbar-menu-actions">
          <button
            onClick={() => {
              onShowMode();
              onClose();
            }}
          >
            ⛶ Show mode
          </button>
          <button
            onClick={() => {
              onConnect();
              onClose();
            }}
          >
            ⊕ Connect a device
          </button>
          {IN_TAURI && (
            <button
              disabled={newWindowBusy}
              onClick={() => {
                onNewWindow();
                onClose();
              }}
            >
              {newWindowBusy ? "Opening…" : "⧉ New window"}
            </button>
          )}
        </div>
        <div className="topbar-menu-foot">
          <span className={connected ? "conn ok" : "conn bad"}>
            {connected ? "connected" : "reconnecting…"}
          </span>
          {status && <span className="gpu-name">{status.gpu_name}</span>}
          <VersionChip />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { connected, status, errors, dismissError, client, config, denied, savedPulse, role } = useGate();
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const [showConnect, setShowConnect] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [savedVisible, setSavedVisible] = useState(false);
  const [showMode, setShowMode] = useShowMode(config?.update.leave_show_at);
  const [menuOpen, setMenuOpen] = useState(false);
  const [newWindowBusy, setNewWindowBusy] = useState(false);
  const [newWindowError, setNewWindowError] = useState<string | null>(null);

  const handleOpenNewWindow = useCallback(async () => {
    if (newWindowBusy) return;
    setNewWindowBusy(true);
    setNewWindowError(null);
    try {
      await openNewWindow(tab);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setNewWindowError(detail || "The native window could not be created.");
    } finally {
      setNewWindowBusy(false);
    }
  }, [newWindowBusy, tab]);

  const togglePerformanceRecording = () => {
    if (status?.performance_recording) {
      const fallback = status.performance_recording_name || defaultPerformanceName();
      const chosen = window.prompt("Save this performance as:", fallback);
      client.stopPerformanceRecording(chosen?.trim() || fallback);
    } else {
      client.startPerformanceRecording(defaultPerformanceName());
    }
  };

  // Flash "saved" whenever the backend confirms a config change (from any client).
  useEffect(() => {
    if (savedPulse === 0) return;
    setSavedVisible(true);
    const t = setTimeout(() => setSavedVisible(false), 1200);
    return () => clearTimeout(t);
  }, [savedPulse]);

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

  // Global keyboard: number keys fire motion effects; R rotates the whole
  // composition. The shape keys are Live's,
  // because there they pick what a press on the array stamps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        // Ctrl+1 and friends belong to the browser and the window, not to us.
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        return;
      }
      const fx = EFFECTS.find((f) => f.key === e.key.toLowerCase());
      if (fx) {
        const color = loadSelectedLiveColor();
        client.triggerEffect({
          kind: fx.kind,
          angle: fx.kind === "rotate" ? (e.shiftKey ? -1 : 1) : Math.random() * Math.PI * 2,
          intensity: fx.kind === "rotate" ? (e.repeat ? 1.35 : 0.45) : 1,
          hue: color.hue,
          saturation: color.saturation,
          brightness: color.brightness,
        });
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

  if (role !== "operator") return <Participate />;

  return (
    <div
      className={`app ${showMode ? "show-mode" : ""}`}
      // Reflects the backend link in the DOM. The layout gate waits on this
      // rather than on a visible chip, which the narrow breakpoint hides.
      data-connected={connected ? "yes" : "no"}
    >
      {showMode && (
        <div className="show-controls">
          {/* Keep the performance shortcuts close to the surface even though the
              normal top bar now remains available in fullscreen. */}
          <button className="show-report" onClick={() => setShowReport(true)}>
            ⚑ Report
          </button>
          <button
            className={`show-report ${status?.performance_recording ? "recording" : ""}`}
            onClick={togglePerformanceRecording}
          >
            {status?.performance_recording ? "■ Stop recording" : "● Record"}
          </button>
          <button className="show-exit" onClick={() => setShowMode(false)}>
            ⤢ Exit show mode <span className="chip-key">Esc</span>
          </button>
          {config && config.public_access.mode !== "private" && <button className="danger"
            onClick={() => client.setConfig({ ...config, public_access: { ...config.public_access, mode: "private" } })}>
            Lock public now
          </button>}
          {/* Only when there is actually an update. Show mode is meant to be
              nearly empty, so a control that is always there costs more than it
              earns — but an update you cannot see or refuse is worse. */}
          <ShowModeUpdate />
        </div>
      )}
      <header className="topbar">
        {/* Narrow screens only (CSS). The current tab's name rides along, because a
            bare hamburger leaves you with no idea where you already are. */}
        <button
          className="ghost topbar-menu-toggle"
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          ☰ <span className="topbar-menu-here">{TABS.find((t) => t.id === tab)?.label}</span>
        </button>
        <h1>Empyrean Gate</h1>
        <nav>
          {NAV_TABS.map((t) => (
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
        <span className={`saved-chip ${savedVisible ? "show" : ""}`}>✓ saved</span>
        <button
          className="ghost report-btn"
          aria-label="Report"
          onClick={() => setShowReport(true)}
        >
          ⚑ <span className="btn-label">Report</span>
        </button>
        <button
          className={`ghost record-btn ${status?.performance_recording ? "recording" : ""}`}
          aria-label={status?.performance_recording ? "Stop and save performance" : "Record performance"}
          onClick={togglePerformanceRecording}
        >
          {status?.performance_recording ? "■" : "●"}{" "}
          <span className="btn-label">{status?.performance_recording ? "Stop" : "Record"}</span>
        </button>
        <button
          className="ghost"
          aria-label={showMode ? "Exit show mode" : "Show mode"}
          onClick={() => setShowMode(!showMode)}
        >
          ⛶ <span className="btn-label">{showMode ? "Exit show mode" : "Show mode"}</span>{" "}
          <span className="chip-key">F11</span>
        </button>
        <button className="ghost" aria-label="Connect a device" onClick={() => setShowConnect(true)}>
          ⊕ <span className="btn-label">Connect</span>
        </button>
        {IN_TAURI && (
          <button
            className="ghost"
            aria-label="New window"
            disabled={newWindowBusy}
            onClick={() => void handleOpenNewWindow()}
          >
            ⧉ <span className="btn-label">{newWindowBusy ? "Opening…" : "New window"}</span>
          </button>
        )}
        {status && <span className="gpu-name">{status.gpu_name}</span>}
        <span className={connected ? "conn ok" : "conn bad"}>
          {connected ? "connected" : "reconnecting…"}
        </span>
        <VersionChip />
      </header>
      <ParticipationControl />

      {newWindowError && (
        <div className="banner error dismissible" onClick={() => setNewWindowError(null)}>
          <strong>Could not open another window:</strong> {newWindowError}. The show is
          still running; use <code>http://localhost:9520/#{tab}</code> in a browser if
          you need a second control surface now. <span className="hint">(click to dismiss)</span>
        </div>
      )}

      {/* Test mode drives the rig from a fixed pattern instead of the show, so it
          has to be impossible to leave on by accident. Shown on every tab and in
          show mode, on every connected device, with the exit right there. */}
      {status?.test?.active && (
        <div className="banner testmode-banner">
          <span className="testmode-dot" />
          <strong>TEST MODE</strong>
          <span className="testmode-summary">{status.test.summary}</span>
          {status.test.expires_secs > 0 && (
            <span className="hint">
              auto-exit in {Math.ceil(status.test.expires_secs / 60)} min
            </span>
          )}
          <button className="ghost" onClick={() => client.setTestMode(false)}>
            Disarm
          </button>
        </div>
      )}
      {/* Game mode replaces the scene with a game world; like test mode the
          state is unmissable everywhere, but stopping is Gate-machine-only so
          the button only shows where it will actually work. The banner is
          also the JOIN path: every phone sees ▶ Play, which lands on the
          Games tab's play surface. */}
      {status?.game?.active && (
        <div className="banner game-banner">
          <span className="game-dot" />
          <strong>GAME MODE</strong>
          <span className="testmode-summary">{status.game.summary}</span>
          {tab !== "games" && (
            <button
              className="game-banner-play"
              onClick={() => {
                location.hash = "games";
              }}
            >
              ▶ Play
            </button>
          )}
          {(client.httpBase.startsWith("http://127.0.0.1") ||
            client.httpBase.startsWith("http://localhost")) && (
            <button className="ghost" onClick={() => client.setGameMode(null)}>
              Stop
            </button>
          )}
        </div>
      )}
      <SacnContentionBanner />
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
      {status?.sacn_error && (
        <div className="banner warn">
          <strong>sACN output:</strong> {status.sacn_error}
        </div>
      )}
      {status?.config_error && (
        <div className="banner error">
          <strong>Settings are not being saved:</strong> {status.config_error}. Keep
          the app running and free disk space or restore write access before
          restarting.
        </div>
      )}
      {status?.power_error && (
        <div className="banner warn">
          <strong>Keep-awake failed:</strong> {status.power_error}. Verify the Gate
          machine's sleep settings before a show.
        </div>
      )}
      {status?.firewall_pending && (
        <div className="banner warn">
          Windows Firewall hasn't been authorized — phones and iPads on the LAN
          may not be able to connect.{" "}
          {IS_LOCAL_UI ? (
            <button className="ghost" onClick={() => client.authorizeFirewall()}>
              Authorize
            </button>
          ) : (
            <strong>Open the desktop app on the Gate machine to authorize it.</strong>
          )}{" "}
          <span className="hint">
            (one admin prompt on the Gate machine; never asks again, even after
            updates — also confines Windows Update restarts to 9am–3pm)
          </span>
        </div>
      )}

      <main>
        {tab === "live" && <Live />}
        {tab === "ready" && <Ready />}
        {/* Keep the decoder mounted while the operator visits Live/Settings.
            An offscreen composited video continues producing frames on iPadOS;
            unmounting it would stop the Gate feed at every tab change. */}
        <div
          className={tab === "media" ? "media-tab-active" : "media-tab-background"}
          aria-hidden={tab !== "media"}
          inert={tab !== "media"}
          // Parked far off-screen on purpose while another tab is showing. The
          // layout gate (tests/layout.spec.ts) treats out-of-viewport geometry
          // as a bug unless it is declared here.
          data-layout-exempt={tab === "media" ? undefined : ""}
        >
          <Media />
        </div>
        {tab === "replay" && <Replay />}
        {tab === "patch" && (
          <Suspense fallback={<div className="patch-empty">Loading editor…</div>}>
            <Patch />
          </Suspense>
        )}
        {tab === "control" && <Control />}
        {tab === "games" && <Games />}
        {tab === "test" && <Test />}
        {tab === "settings" && <Settings />}
      </main>

      {menuOpen && (
        <TopbarMenu
          tab={tab}
          onSelectTab={selectTab}
          onClose={() => setMenuOpen(false)}
          onShowMode={() => setShowMode(true)}
          onConnect={() => setShowConnect(true)}
          onNewWindow={() => void handleOpenNewWindow()}
          newWindowBusy={newWindowBusy}
        />
      )}
      {showConnect && <ConnectModal onClose={() => setShowConnect(false)} />}
      {showReport && <ReportModal onClose={() => setShowReport(false)} />}
      <CloseGuard />
      <DisconnectedOverlay disabled={tab === "replay"} />
    </div>
  );
}
