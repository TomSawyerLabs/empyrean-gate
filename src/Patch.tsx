// The Patch tab: the shared node-graph editor (packages/patch-web) wired to this
// gate. Editing is only possible from the Gate machine itself — the backend
// refuses mutations from non-loopback connections — so remote clients get a
// read-only view of the graph.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  openPatchFromDisk,
  PatchEditor,
  savePatchToDisk,
  type GlobalControl,
  type PatchDoc,
  type PatchNodeType,
  type PatchStore,
} from "@empyrean-gate/patch-web/editor";
import { getMiniHub } from "./miniPreview";
import { useGate, useThrottled } from "./state";
import type { GateClient } from "./ws";

/** The gate's patch store, over the WebSocket protocol. */
function gateStore(client: GateClient): PatchStore {
  return {
    list: () => client.patchList(),
    get: (id) => client.patchGet(id),
    save: (doc) => client.patchSave(doc),
    remove: (id) => client.patchDelete(id),
    activate: (id) => client.patchActivate(id),
    subscribe: (listener) =>
      client.onMessage((msg) => {
        if (msg.type === "patches") listener({ type: "patches", patches: msg.patches });
        else if (msg.type === "patch") listener({ type: "patch", patch: msg.patch });
        else if (msg.type === "patch_param_changed") {
          listener({ type: "param", node: msg.node, param: msg.param, value: msg.value });
        }
      }),
  };
}

export default function Patch() {
  const { client, config, status, connected } = useGate();
  const store = useMemo(() => gateStore(client), [client]);
  const [registry, setRegistry] = useState<PatchNodeType[] | null>(null);
  const [presets, setPresets] = useState<PatchDoc[]>([]);
  const [importError, setImportError] = useState<string | null>(null);

  // Editing works only where the backend will accept it: loopback connections.
  const canEdit =
    client.httpBase.startsWith("http://127.0.0.1") ||
    client.httpBase.startsWith("http://localhost");

  // Palette (from the backend registry) and presets, once connected.
  useEffect(() => {
    if (!connected) return;
    let stale = false;
    void fetch(`${client.httpBase}/patch/registry`)
      .then((r) => r.json())
      .then((types: PatchNodeType[]) => {
        if (!stale) setRegistry(types);
      })
      .catch(() => {});
    void fetch(`${client.httpBase}/patch/presets`)
      .then((r) => r.json())
      .then((docs: PatchDoc[]) => {
        if (!stale) setPresets(docs);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [connected, client]);

  // The gate's master brightness and speed, as a card in the editor's canvas.
  // They are the Live tab's sliders, so any client may move them (the graph
  // itself stays read-only off the Gate machine). Local state keeps a drag
  // smooth; the echoed config is taken back once the hand is still.
  const [brightness, setBrightness] = useState(1);
  const [speed, setSpeed] = useState(1);
  const lastSet = useRef(0);
  const remoteBrightness = config?.render.master_brightness ?? 1;
  const remoteSpeed = config?.render.master_speed ?? 1;
  useEffect(() => {
    if (Date.now() - lastSet.current < 400) return;
    setBrightness(remoteBrightness);
    setSpeed(remoteSpeed);
  }, [remoteBrightness, remoteSpeed]);
  const sendMaster = useThrottled((v: { brightness?: number; speed?: number }) =>
    client.setMaster(v),
  );
  const globals: GlobalControl[] = [
    {
      name: "brightness",
      label: "Brightness",
      value: brightness,
      min: 0,
      max: 1,
      format: (v) => `${Math.round(v * 100)}%`,
      onChange: (v) => {
        lastSet.current = Date.now();
        setBrightness(v);
        sendMaster({ brightness: v });
      },
    },
    {
      name: "speed",
      label: "Speed",
      value: speed,
      min: 0,
      max: 4,
      step: 0.05,
      format: (v) => `${v.toFixed(2)}×`,
      onChange: (v) => {
        lastSet.current = Date.now();
        setSpeed(v);
        sendMaster({ speed: v });
      },
    },
  ];

  return (
    <PatchEditor
      store={store}
      registry={registry}
      presets={presets}
      ready={connected}
      activeId={config?.active_patch ?? null}
      status={status ? { active: status.patch_active, error: status.patch_error ?? null } : null}
      canEdit={canEdit}
      readOnlyHint="read-only — edit on the Gate machine"
      minis={getMiniHub(client)}
      globals={globals}
      globalsNote="The Live tab's master brightness and speed, outside the patch: speed scales every Time node and phase, brightness scales the Output."
      nodeExtras={(node) =>
        node.kind === "video_in" ? (
          <p className="hint">
            Shows the gate's live video: whatever the Media tab is playing. For a fixed
            picture, use a Still image node, which carries its own image.
          </p>
        ) : null
      }
      toolbarExtra={({ doc, open }) => (
        <>
          {canEdit && (
            <button
              title="Open a patch file (for example one saved from the empyreangate.org playground) as a new patch"
              onClick={() => {
                setImportError(null);
                openPatchFromDisk()
                  .then(async (d) => {
                    if (!d) return;
                    // Upgrade an older file first, so the editor shows exactly
                    // what will be stored and rendered.
                    const res = await fetch(`${client.httpBase}/patch/migrate`, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify(d),
                    });
                    if (!res.ok) throw new Error(`The gate could not read that patch (${res.status}).`);
                    open((await res.json()) as PatchDoc, true);
                  })
                  .catch((e: unknown) => setImportError(e instanceof Error ? e.message : String(e)));
              }}
            >
              Import…
            </button>
          )}
          {doc && (
            <button
              title="Save this patch to a file"
              onClick={() => void savePatchToDisk(doc).catch(() => {})}
            >
              Export…
            </button>
          )}
          {importError && <span className="patch-status error">⚠ {importError}</span>}
        </>
      )}
    />
  );
}
