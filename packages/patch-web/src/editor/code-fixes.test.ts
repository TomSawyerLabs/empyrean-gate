import { describe, expect, test } from "bun:test";
import { closestNames, distance, fixesFor, type FixContext, type QuickFix } from "./code-fixes";

const GPU: FixContext = { outputs: ["out"], names: ["c", "G", "hsv2rgb", "smoothstep", "twist", "out"], tier: "gpu" };
const CPU: FixContext = { outputs: ["out", "hit"], names: ["x", "out", "hit", "sin", "dt"], tier: "cpu" };

/** The body after `fix` (edits are in the original's coordinates). */
function apply(body: string, fix: QuickFix): string {
  let s = body;
  for (const c of [...fix.changes].sort((a, b) => b.from - a.from || b.to - a.to)) {
    s = s.slice(0, c.from) + c.insert + s.slice(c.to);
  }
  return s;
}

/** The fixes for `message` reported where `|` is in `marked`. */
function fixes(marked: string, message: string, ctx = GPU) {
  const at = marked.indexOf("|");
  const body = marked.replace("|", "");
  return { body, list: fixesFor(message, at, body, ctx) };
}

describe("return with a value", () => {
  const msg = "line 1:1: return a value: assign the output by name instead (`out = …;`), then `return;` if the body must stop early";
  test("at the end: an assignment", () => {
    const { body, list } = fixes("let a = 1.0;\n|return vec4f(a);\n", msg);
    expect(list.map((f) => f.name)).toEqual(["Assign `out` instead"]);
    expect(apply(body, list[0]!)).toBe("let a = 1.0;\nout = vec4f(a);\n");
  });
  test("early: an assignment, then return;", () => {
    const { body, list } = fixes("if (c.rn > 0.5) {\n  |return vec4f(1.0);\n}\nout = vec4f(0.0);", msg);
    expect(apply(body, list[0]!)).toBe("if (c.rn > 0.5) {\n  out = vec4f(1.0);\n  return;\n}\nout = vec4f(0.0);");
  });
  test("one fix per output on the CPU", () => {
    // The interpreter points at the value, not at `return`.
    const { body, list } = fixes("return |1.0;", "line 1:8: assign the outputs by name instead of returning a value", CPU);
    expect(list.map((f) => f.name)).toEqual(["Assign `out` instead", "Assign `hit` instead"]);
    expect(apply(body, list[0]!)).toBe("out = 1.0;");
  });
});

describe("brackets", () => {
  test("an unclosed { is closed at the end", () => {
    const { body, list } = fixes("if (true) |{\n  out = vec4f(1.0);\n", "line 1:11: this `{` is never closed");
    expect(apply(body, list[0]!)).toBe("if (true) {\n  out = vec4f(1.0);\n}\n");
  });
  test("an unclosed ( is closed before the line's ;", () => {
    const { body, list } = fixes("out = vec4f|(1.0;\nlet b = 2.0;", "line 1:12: this `(` is never closed");
    expect(apply(body, list[0]!)).toBe("out = vec4f(1.0);\nlet b = 2.0;");
  });
  test("a stray } is removed", () => {
    const { body, list } = fixes("out = vec4f(1.0);\n|}", "line 2:1: this `}` closes nothing");
    expect(apply(body, list[0]!)).toBe("out = vec4f(1.0);\n");
  });
});

describe("loops in a field body", () => {
  test("while becomes a bounded for that breaks on the condition", () => {
    const { body, list } = fixes(
      "var x = 1.0;\n|while (x > 0.1) {\n  x = x * 0.5;\n}",
      "line 2:1: `while` is not allowed in a field body: a loop without a fixed bound can hang the GPU",
    );
    expect(apply(body, list[0]!)).toBe(
      "var x = 1.0;\nfor (var i = 0u; i < 256u; i++) {\n  if (!(x > 0.1)) { break; }\n  x = x * 0.5;\n}",
    );
  });
  test("loop becomes a bounded for, with a free name", () => {
    const { body, list } = fixes("let i = 2.0;\n|loop {\n  break;\n}", "line 2:1: `loop` is not allowed in a field body");
    expect(apply(body, list[0]!)).toBe("let i = 2.0;\nfor (var k = 0u; k < 256u; k++) {\n  break;\n}");
  });
  test("a for without a bound gets one, its condition kept as a break", () => {
    const { body, list } = fixes(
      "|for (var i = 0; f32(i) < twist; i++) {\n  out += vec4f(0.1);\n}",
      "line 1:1: a `for` in a field body needs a fixed bound in its condition",
    );
    expect(list[0]!.name).toBe("Cap it at 256 iterations");
    expect(apply(body, list[0]!)).toBe(
      "for (var i = 0; i < 256; i++) {\n  if (!(f32(i) < twist)) { break; }\n  out += vec4f(0.1);\n}",
    );
  });
});

describe("assignments", () => {
  test("writing to an input works on a copy instead", () => {
    const { body, list } = fixes(
      "// note\nlet a = twist * 2.0;\n|twist = twist + 1.0;\nout = vec4f(twist, c.twist, 0.0, 1.0);",
      "line 3:1: `twist` is an input, and inputs are read-only; `var x = twist;` makes a copy to change",
    );
    expect(apply(body, list[0]!)).toBe(
      "// note\nvar twist_v = twist;\nlet a = twist_v * 2.0;\ntwist_v = twist_v + 1.0;\nout = vec4f(twist_v, c.twist, 0.0, 1.0);",
    );
  });
  test("assigning a let makes it a var", () => {
    const { body, list } = fixes("let y = 1.0;\ny |= 2.0;", "line 2:3: `y` is a `let`; declare it with `var` to assign it", CPU);
    expect(apply(body, list[0]!)).toBe("var y = 1.0;\ny = 2.0;");
  });
});

describe("compiler errors", () => {
  test("a missing ; goes after the previous token", () => {
    const { body, list } = fixes("out = 1.0\n|let b = 2.0;", "line 2:1: expected `;`, found `let`", CPU);
    expect(apply(body, list[0]!)).toBe("out = 1.0;\nlet b = 2.0;");
  });
  test("an unknown name offers the close ones in scope, the body's own included", () => {
    const { body, list } = fixes(
      "let bright = 0.5;\nout = vec4f(hsv2rbg(brigth, 1.0, 1.0), 1.0);",
      "",
    );
    expect(body).toContain("brigth");
    const at = body.indexOf("brigth");
    const named = fixesFor("unresolved identifier 'brigth'", at, body, GPU);
    expect(named.map((f) => f.name)).toEqual(["Change to `bright`"]);
    expect(apply(body, named[0]!)).toContain("hsv2rbg(bright,");
    const fn = fixesFor("Code node \"n\" line 2:13 unresolved call target 'hsv2rbg'", body.indexOf("hsv2rbg"), body, GPU);
    expect(fn.map((f) => f.name)).toEqual(["Change to `hsv2rgb`"]);
    expect(list).toEqual([]);
  });
  test("the CPU's 'not declared' too", () => {
    const { body, list } = fixes("out = sin(|xx);", "line 1:11: `xx` is not declared", CPU);
    expect(list.map((f) => f.name)).toEqual(["Change to `x`"]);
    expect(apply(body, list[0]!)).toBe("out = sin(x);");
  });
});

describe("closestNames", () => {
  test("ranks by edit distance, case first, at most three", () => {
    expect(distance("hsv2rbg", "hsv2rgb")).toBe(1);
    expect(closestNames("Twist", ["twist", "twirl", "list"])).toEqual(["twist"]);
    expect(closestNames("ab", ["xyz"])).toEqual([]);
  });
});
