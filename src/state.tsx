// App-wide state: one GateClient, the latest config + status from the backend,
// connection state, and a beat pulse per audio source.

import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { GateClient } from "./ws";
import type { AppConfig, ProDjLinkDebugEntry, RuntimeStatus, ServerMsg } from "./types";
import {
  fetchBrcEventDots,
  type BrcEventDiagnostic,
  type BrcEventDot,
} from "./ambientScenes";

const BRC_API_KEY_STORAGE = "empyrean-gate.brc-api-key";

export type BrcEventState = "idle" | "loading" | "ready" | "empty" | "error";

export interface BrcEventLogEntry extends BrcEventDiagnostic {
  sequence: number;
  timestamp: string;
}

interface Gate {
  client: GateClient;
  config: AppConfig | null;
  status: RuntimeStatus | null;
  connected: boolean;
  /** Set when the server refused this client (revoked / token required). */
  denied: string | null;
  /** Bumps every time the backend confirms a config change (saved + broadcast). */
  savedPulse: number;
  errors: string[];
  dismissError: (i: number) => void;
  /** Timestamp (performance.now()) of the last beat per source index. */
  beatAt: React.RefObject<number[]>;
  djLinkLog: ProDjLinkDebugEntry[];
  clearDjLinkLog: () => void;
  brcApiKey: string;
  setBrcApiKey: (key: string) => void;
  brcEvents: BrcEventDot[];
  brcEventState: BrcEventState;
  brcEventError: string;
  brcEventLog: BrcEventLogEntry[];
  refreshBrcEvents: () => Promise<void>;
  clearBrcEventLog: () => void;
}

const GateContext = createContext<Gate | null>(null);

export function GateProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => new GateClient(), []);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [denied, setDenied] = useState<string | null>(null);
  const [savedPulse, setSavedPulse] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const beatAt = useRef<number[]>([0, 0, 0, 0]);
  const [djLinkLog, setDjLinkLog] = useState<ProDjLinkDebugEntry[]>([]);
  const [brcApiKey, setBrcApiKeyState] = useState(() => localStorage.getItem(BRC_API_KEY_STORAGE) ?? "");
  const [brcEvents, setBrcEvents] = useState<BrcEventDot[]>([]);
  const [brcEventState, setBrcEventState] = useState<BrcEventState>("idle");
  const [brcEventError, setBrcEventError] = useState("");
  const [brcEventLog, setBrcEventLog] = useState<BrcEventLogEntry[]>([]);
  const brcLogSequence = useRef(0);
  const brcRefreshPending = useRef(false);

  const appendBrcLog = useCallback((entries: BrcEventDiagnostic[]) => {
    const timestamp = new Date().toISOString();
    setBrcEventLog((current) => [
      ...current,
      ...entries.map((entry) => ({ ...entry, timestamp, sequence: ++brcLogSequence.current })),
    ].slice(-200));
  }, []);

  const setBrcApiKey = useCallback((key: string) => {
    setBrcApiKeyState(key);
    const trimmed = key.trim();
    if (trimmed) localStorage.setItem(BRC_API_KEY_STORAGE, trimmed);
    else localStorage.removeItem(BRC_API_KEY_STORAGE);
  }, []);

  const refreshBrcEvents = useCallback(async () => {
    if (brcRefreshPending.current) return;
    brcRefreshPending.current = true;
    setBrcEventState("loading");
    setBrcEventError("");
    appendBrcLog([{ level: "info", summary: "Refreshing official 2026 event data", details: {} }]);
    try {
      const scan = await fetchBrcEventDots(
        (resource, uid) => client.fetchBrcApi(brcApiKey.trim(), resource, uid),
      );
      setBrcEvents(scan.dots);
      setBrcEventState(scan.dots.length ? "ready" : "empty");
      appendBrcLog(scan.diagnostics);
    } catch (eventError) {
      const message = eventError instanceof Error ? eventError.message : String(eventError);
      setBrcEventState("error");
      setBrcEventError(message);
      appendBrcLog([{ level: "warn", summary: "Event refresh failed", details: { error: message } }]);
    } finally {
      brcRefreshPending.current = false;
    }
  }, [appendBrcLog, brcApiKey, client]);

  useEffect(() => {
    const offMsg = client.onMessage((msg: ServerMsg) => {
      switch (msg.type) {
        case "state":
          setConfig((prev) => {
            // The very first state after connect is a greeting, not a save.
            if (prev !== null) setSavedPulse((p) => p + 1);
            return msg.config;
          });
          setStatus(msg.status);
          setDjLinkLog(msg.status.pro_dj_link_debug ?? []);
          break;
        case "status":
          setStatus(msg.status);
          break;
        case "beat":
          beatAt.current[msg.source] = performance.now();
          break;
        case "pro_dj_link_debug":
          setDjLinkLog((entries) => {
            if (entries.at(-1)?.sequence === msg.entry.sequence) return entries;
            return [...entries.slice(-399), msg.entry];
          });
          break;
        case "error":
          setErrors((e) => [...e.slice(-4), msg.message]);
          break;
      }
    });
    const offStatus = client.onStatus(setConnected);
    const offDenied = client.onDenied(setDenied);
    void client.connect();
    return () => {
      offMsg();
      offStatus();
      offDenied();
      client.close();
    };
  }, [client]);

  const value: Gate = {
    client,
    config,
    status,
    connected,
    denied,
    savedPulse,
    errors,
    dismissError: (i) => setErrors((e) => e.filter((_, j) => j !== i)),
    beatAt,
    djLinkLog,
    clearDjLinkLog: () => setDjLinkLog([]),
    brcApiKey,
    setBrcApiKey,
    brcEvents,
    brcEventState,
    brcEventError,
    brcEventLog,
    refreshBrcEvents,
    clearBrcEventLog: () => setBrcEventLog([]),
  };
  return <GateContext.Provider value={value}>{children}</GateContext.Provider>;
}

export function useGate(): Gate {
  const ctx = useContext(GateContext);
  if (!ctx) throw new Error("useGate outside GateProvider");
  return ctx;
}

/** Throttle rapid slider changes to ~10 msg/s, always sending the trailing value. */
export function useThrottled<T>(fn: (v: T) => void, ms = 100): (v: T) => void {
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<T | null>(null);
  return (v: T) => {
    const now = Date.now();
    if (now - last.current >= ms) {
      last.current = now;
      fn(v);
    } else {
      pending.current = v;
      if (!timer.current) {
        timer.current = setTimeout(() => {
          timer.current = null;
          last.current = Date.now();
          if (pending.current !== null) fn(pending.current);
          pending.current = null;
        }, ms - (now - last.current));
      }
    }
  };
}
