// Every palette thumbnail on one page, grouped as the palette groups them:
// for checking `bun run thumbnails` output by eye. /thumbs.html under
// `bun run demo`.

import { createRoot } from "react-dom/client";
import "../src/editor/editor.css";
import { grouped } from "../src/groups";
import { NodeIcon } from "../src/editor/icons";
import { RingThumb, TraceThumbView } from "../src/editor/thumbs";
import { THUMBS } from "../src/editor/thumbs.gen";
import { loadPatchCore } from "../src/runtime/core";

const wasm = await fetch(new URL("../wasm/patch_bg.wasm", import.meta.url)).then((r) => r.arrayBuffer());
const core = await loadPatchCore(wasm);

createRoot(document.querySelector("#sheet")!).render(
  <>
    {grouped(core.registry).map(({ group, types }) => (
      <section key={group.id}>
        <h2>{group.label}</h2>
        <main>
          {types.map((t) => (
            <figure key={t.id}>
              {THUMBS.rings[t.id] ? (
                <RingThumb data={THUMBS} kind={t.id} size={112} />
              ) : THUMBS.traces[t.id] ? (
                <TraceThumbView trace={THUMBS.traces[t.id]!} width={112} height={56} />
              ) : (
                <NodeIcon kind={t.id} category={t.category} size={48} />
              )}
              <figcaption>{t.label}</figcaption>
            </figure>
          ))}
        </main>
      </section>
    ))}
  </>,
);
