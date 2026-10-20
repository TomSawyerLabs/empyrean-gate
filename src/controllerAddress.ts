// Controller list entries: an IPv4 address used as written, or a MAC address the
// backend resolves with Advatek discovery. Mirrors `parse_entry` / `parse_mac` in
// src-tauri/src/addressing.rs, so the UI flags exactly what the backend rejects.

export type EntryKind = "empty" | "ip" | "mac" | "invalid";

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** Twelve hex digits in any of the usual spellings, or null. */
function macDigits(text: string): string | null {
  const t = text.trim();
  if (/^[0-9a-f]{2}([:-])[0-9a-f]{2}(\1[0-9a-f]{2}){4}$/i.test(t)) return t.replace(/[:-]/g, "");
  if (/^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i.test(t)) return t.replace(/\./g, "");
  if (/^[0-9a-f]{12}$/i.test(t)) return t;
  return null;
}

/** Canonical `AA:BB:CC:DD:EE:FF`, the form discovery reports, or null. */
export function canonicalMac(text: string): string | null {
  const d = macDigits(text);
  return d ? d.toUpperCase().match(/../g)!.join(":") : null;
}

export function entryKind(entry: string): EntryKind {
  const t = entry.trim();
  if (!t) return "empty";
  if (IPV4.test(t)) return "ip";
  if (macDigits(t)) return "mac";
  return "invalid";
}

/**
 * Text area → controller list. Blank lines in the middle are kept: a controller's
 * position is what assigns its spokes, so an empty line deliberately leaves one
 * controller's spokes without a destination. Trailing blank lines are dropped.
 */
export function parseControllerList(text: string): string[] {
  const lines = text.split("\n").map((s) => s.trim());
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Put `mac` at controller position `index`, padding the list with empty entries
 * as needed. The same box listed anywhere else is cleared, so one box never
 * claims two controllers' spokes.
 */
export function assignMac(list: string[], index: number, mac: string): string[] {
  const canonical = canonicalMac(mac) ?? mac;
  const next = list.map((e) => (canonicalMac(e) === canonical ? "" : e));
  while (next.length <= index) next.push("");
  next[index] = canonical;
  while (next.length > 0 && next[next.length - 1] === "") next.pop();
  return next;
}
