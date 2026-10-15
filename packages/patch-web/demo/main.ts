// Bare runtime check: every preset rendering through the wasm core + WebGPU.
// `bun run demo` in packages/patch-web.

import { PatchRuntime } from "../src/runtime";

const status = document.querySelector<HTMLSpanElement>("#status")!;
const select = document.querySelector<HTMLSelectElement>("#preset")!;
const canvas = document.querySelector<HTMLCanvasElement>("#gate")!;

try {
  const rt = await PatchRuntime.create();
  rt.onStatus((s) => (status.textContent = s.error ?? (s.active ? "rendering" : "idle")));
  rt.core.presets.forEach((p, i) => select.add(new Option(p.name, String(i))));
  const load = () => void rt.setPatch(rt.core.presets[Number(select.value)]);
  select.onchange = load;
  document.querySelector<HTMLButtonElement>("#tap")!.onclick = () =>
    rt.trigger({ kind: "burst", angle: Math.random() * Math.PI * 2, radius: 0.7, hue: Math.random() });
  document.querySelector<HTMLButtonElement>("#mic")!.onclick = () => void rt.startMic();
  rt.attach(canvas);
  rt.start();
  load();
  Object.assign(globalThis, { rt });
} catch (e) {
  status.textContent = e instanceof Error ? e.message : String(e);
}
