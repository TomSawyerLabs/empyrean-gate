// This device's guardrail level, and an Expert's per-slider speed limits
// (plans/guardrail-modes.md).

import { useState } from "react";
import { useGate } from "./state";
import { CONTROLS, LEVELS, rateToSecs, secsToRate, useGuardrail } from "./guardrails";
import type { GuardrailCfg, GuardrailControl } from "./types";

export default function GuardrailPicker() {
  const { client } = useGate();
  const cfg = useGuardrail();
  const set = (next: GuardrailCfg) => client.send({ type: "set_client_guardrail", guardrail: next });

  return (
    <div className="guardrail-picker">
      <div className="field-row">
        <span>Guardrails</span>
        <div className="segmented" role="radiogroup" aria-label="Guardrails">
          {LEVELS.map((l) => (
            <button
              key={l.id}
              role="radio"
              aria-checked={cfg.level === l.id}
              className={cfg.level === l.id ? "active" : ""}
              onClick={() => set({ ...cfg, level: l.id })}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <p className="hint">{LEVELS.find((l) => l.id === cfg.level)?.hint}</p>
      {cfg.level === "expert" && <ExpertRates cfg={cfg} onChange={set} />}
    </div>
  );
}

function ExpertRates({ cfg, onChange }: { cfg: GuardrailCfg; onChange: (c: GuardrailCfg) => void }) {
  return (
    <details className="guardrail-rates">
      <summary>Slider speed limits</summary>
      <p className="hint">
        Seconds a full swing of the slider takes on the lights. Leave blank for no limit.
      </p>
      {CONTROLS.map((c) => (
        <RateRow
          key={`${c.id}:${rateToSecs(cfg.rates[c.id], c.span)}`}
          label={c.label}
          value={rateToSecs(cfg.rates[c.id], c.span)}
          onCommit={(secs) => {
            const rates = { ...cfg.rates };
            const rate = secsToRate(secs, c.span);
            if (rate === undefined) delete rates[c.id as GuardrailControl];
            else rates[c.id] = rate;
            onChange({ ...cfg, rates });
          }}
        />
      ))}
    </details>
  );
}

function RateRow({ label, value, onCommit }: { label: string; value: string; onCommit: (secs: string) => void }) {
  const [draft, setDraft] = useState(value);
  return (
    <label className="field-row">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        step={0.05}
        inputMode="decimal"
        placeholder="no limit"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onCommit(draft);
        }}
      />
    </label>
  );
}
