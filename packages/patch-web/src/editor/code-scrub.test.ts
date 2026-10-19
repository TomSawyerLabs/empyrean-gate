import { describe, expect, test } from "bun:test";
import { numberAt, scrubbedText } from "./code-scrub";

describe("numberAt", () => {
  test("finds the literal at or touching the column, with its form", () => {
    const text = "let w = sin(c.rn * 12.0 - G.time * 2u);";
    expect(numberAt(text, text.indexOf("12.0") + 2)).toEqual({
      from: 19,
      to: 23,
      value: 12,
      decimals: 1,
      point: true,
      suffix: "",
    });
    expect(numberAt(text, text.indexOf("2u") + 2)).toMatchObject({ value: 2, suffix: "u", point: false });
    expect(numberAt("x = .5;", 5)).toMatchObject({ value: 0.5, decimals: 1 });
    expect(numberAt("x = 2.;", 5)).toMatchObject({ value: 2, decimals: 0, point: true });
  });

  test("leaves names, hex and exponents alone", () => {
    expect(numberAt("let vec4f = 1.0;", 7)).toBeNull();
    expect(numberAt("x = 0x1F;", 5)).toBeNull();
    expect(numberAt("x = 1e3;", 4)).toBeNull();
    expect(numberAt("x = a;", 4)).toBeNull();
  });
});

describe("scrubbedText", () => {
  const lit = (s: string) => numberAt(s, 0)!;
  test("moves by the last digit, keeping decimals and suffix", () => {
    expect(scrubbedText(lit("12.0"), 3)).toBe("12.3");
    expect(scrubbedText(lit("0.05"), -2)).toBe("0.03");
    expect(scrubbedText(lit("8"), 5)).toBe("13");
    expect(scrubbedText(lit("2."), 1)).toBe("3.");
    expect(scrubbedText(lit("1.5f"), 1)).toBe("1.6f");
  });
  test("Shift is ten times, Ctrl a tenth (with one more decimal)", () => {
    expect(scrubbedText(lit("1.0"), 2, 10)).toBe("3.0");
    expect(scrubbedText(lit("1.0"), 2, 0.1)).toBe("1.02");
  });
  test("u stays at 0 or above; a negative is bracketed where a bare minus is unsafe", () => {
    expect(scrubbedText(lit("2u"), -5)).toBe("0u");
    expect(scrubbedText(lit("0.5"), -8, 1, "*")).toBe("-0.3");
    expect(scrubbedText(lit("0.5"), -8, 1, "-")).toBe("(-0.3)");
    expect(scrubbedText(lit("0.5"), -8, 1, "a")).toBe("(-0.3)");
    expect(scrubbedText(lit("0.5"), -5)).toBe("0.0");
  });
});
