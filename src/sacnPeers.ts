// Reading the sACN contention watcher's output. One place decides what counts as
// a problem, so the ring chip, the app-wide banner and the Test tab can never
// disagree about whether the show is being fought over.

import type { SacnPeer } from "./types";

export type Severity = "clear" | "present" | "merging" | "overridden";

/** Sources actually competing for universes we drive. */
export function contenders(peers: SacnPeer[]): SacnPeer[] {
  return peers.filter((p) => p.overlapping.length > 0 && !p.preview_only);
}

/**
 * Worst thing happening right now.
 *
 * - `overridden` — someone outranks us; the receiver is discarding our frames.
 * - `merging` — equal priority. E1.31 merges the two sources HTP, so the rig
 *   does what neither of them says. Worse to debug than being overridden, and
 *   easy to mistake for a bug in the show.
 * - `present` — another source shares our universes but loses the arbitration.
 *   Not breaking anything yet; still someone else's console in our patch.
 */
export function severity(peers: SacnPeer[]): Severity {
  const rivals = contenders(peers);
  if (rivals.some((p) => p.wins)) return "overridden";
  if (rivals.some((p) => p.ties)) return "merging";
  return rivals.length > 0 ? "present" : "clear";
}

/** A name worth showing. Source names are operator-set and often blank. */
export function peerLabel(peer: SacnPeer): string {
  return peer.source_name || peer.from_ip || "unnamed source";
}

/** "12–19" / "12, 14, 19" / "12 (+40 more)" — universes without a wall of digits. */
export function universeRange(universes: number[]): string {
  if (universes.length === 0) return "";
  const lo = Math.min(...universes);
  const hi = Math.max(...universes);
  if (universes.length === 1) return String(lo);
  // Contiguous is by far the common case for a patched console.
  if (hi - lo + 1 === universes.length) return `${lo}–${hi}`;
  if (universes.length <= 4) return universes.join(", ");
  return `${universes.slice(0, 3).join(", ")} (+${universes.length - 3} more)`;
}

/** One line describing what a peer is doing to us. */
export function peerVerdict(peer: SacnPeer): string {
  const where = peer.overlapping.length
    ? `universe${peer.overlapping.length === 1 ? "" : "s"} ${universeRange(peer.overlapping)}`
    : "no universes of ours";
  if (peer.preview_only) return `preview data only on ${where} — not driving lights`;
  if (peer.overlapping.length === 0) return `on ${universeRange(peer.universes) || "other universes"}`;
  if (peer.priority === null) {
    return `sharing ${where} — it announces them but we have not heard its data, so its priority is unknown`;
  }
  if (peer.wins) {
    return `priority ${peer.priority} beats ours (${peer.our_priority}) on ${where} — the rig is following it, not us`;
  }
  if (peer.ties) {
    return `same priority (${peer.priority}) on ${where} — receivers merge both sources highest-takes-precedence, so the rig follows neither`;
  }
  return `priority ${peer.priority}, below ours (${peer.our_priority}), on ${where} — we still win`;
}
