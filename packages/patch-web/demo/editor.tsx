// The editor on its own, over the real patch core and an in-memory library:
// for working on the editor without a gate or the website. `bun run demo` in
// packages/patch-web, then /editor.html. Renders with WebGPU where there is
// one (live node thumbnails and the array beside the canvas), driven by the
// stand-ins: the synthetic groove, the test film and simulated visitors.
// Without WebGPU the editor still works on the registry alone.
// `globalThis.editorRef.current` is the editor's handle (open, arrange …),
// which scripts/arrange-presets.ts drives.

import { createRef, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { PatchEditor, type PatchEditorHandle, type PatchStore, type PatchStoreEvent } from "../src/editor";
import "../src/editor/editor.css";
import { attachGroove, attachVisitors, PatchRuntime, type RuntimeStats } from "../src/runtime";
import { loadPatchCore, type PatchCore } from "../src/runtime/core";
import type { PatchDoc } from "../src/types";

function memoryStore(seed: PatchDoc[]): PatchStore {
  const docs = new Map(seed.map((d) => [d.id, structuredClone(d)]));
  const listeners = new Set<(e: PatchStoreEvent) => void>();
  const emit = (e: PatchStoreEvent) => listeners.forEach((l) => l(e));
  const list = () =>
    emit({
      type: "patches",
      patches: [...docs.values()].map((d) => ({ id: d.id, name: d.name, description: d.description, nodes: d.nodes.length })),
    });
  let ids = 0;
  return {
    list: () => queueMicrotask(list),
    get: (id) => queueMicrotask(() => docs.has(id) && emit({ type: "patch", patch: structuredClone(docs.get(id)!) })),
    save(doc) {
      const saved = { ...structuredClone(doc), id: doc.id || `p${++ids}` };
      docs.set(saved.id, saved);
      queueMicrotask(() => {
        emit({ type: "patch", patch: structuredClone(saved) });
        list();
      });
    },
    remove(id) {
      docs.delete(id);
      queueMicrotask(list);
    },
    activate() {},
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

const editorRef = createRef<PatchEditorHandle>();

function App({ core, runtime, noGpu }: { core: PatchCore; runtime: PatchRuntime | null; noGpu: string | null }) {
  const store = useMemo(() => memoryStore(core.presets.slice(0, 1).map((p) => ({ ...p, id: "start" }))), [core]);
  const [doc, setDoc] = useState<PatchDoc | null>(null);
  const [status, setStatus] = useState(runtime?.getStatus() ?? null);
  useEffect(() => runtime?.onStatus(setStatus), [runtime]);
  const [stats, setStats] = useState<RuntimeStats | null>(null);
  useEffect(() => runtime?.onStats(setStats), [runtime]);
  useEffect(() => {
    if (runtime && doc) void runtime.setPatch(doc);
  }, [runtime, doc]);
  useEffect(() => {
    store.get("start");
  }, [store]);
  return (
    <PatchEditor
      store={store}
      registry={core.registry}
      presets={core.presets}
      codeReference={core.codeReference}
      convertToCode={async (d, id) => core.convertToCode(d, id)}
      ready
      activeId={doc?.id ?? null}
      status={
        runtime
          ? status && { ...status, beat: stats?.frames ?? 0, details: runtime.statusDetails(stats) }
          : { active: false, error: null, unavailable: { label: "no WebGPU", reason: noGpu ?? "" } }
      }
      canEdit
      minis={runtime}
      showActivate={false}
      onDocChange={setDoc}
      editorRef={editorRef}
    />
  );
}

const root = createRoot(document.querySelector("#editor")!);
const wasm = await fetch(new URL("../wasm/patch_bg.wasm", import.meta.url)).then((r) => r.arrayBuffer());
let runtime: PatchRuntime | null = null;
let noGpu: string | null = null;
try {
  runtime = await PatchRuntime.create(undefined, { wasm });
  attachGroove(runtime);
  attachVisitors(runtime);
  runtime.attach(document.querySelector<HTMLCanvasElement>("#gate")!);
  runtime.start();
} catch (e) {
  noGpu = `${e instanceof Error ? e.message : String(e)} Editing works; nothing renders here.`;
  document.querySelector("#gate")!.replaceWith("No WebGPU here: editing only.");
}
const core = runtime?.core ?? (await loadPatchCore(wasm));
Object.assign(globalThis, { core, runtime, editorRef });
root.render(<App core={core} runtime={runtime} noGpu={noGpu} />);
