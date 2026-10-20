# Controller addressing: fixed IPs and MAC-keyed discovery

## Goal

Unicast sACN (see `plans/gate-network.md`) needs to know each PixLite's IP. Support
both ways of getting it:

- **Fixed IP** — what exists today: `output.controllers` holds IPv4 addresses in
  spoke order.
- **MAC-keyed** — a controller entry may instead be the box's MAC address. Empyrean
  finds the box's current IP with Advatek discovery, keeps it current in the
  background, and remembers it across restarts. No static IPs or DHCP
  reservations needed.

Entries can be mixed freely in one list.

## Environment / context

- 16× PixLite E4-S Mk3, answering Advatek DiscProt (Mk3+) discovery — already
  implemented read-only in `src-tauri/src/discovery.rs` (the Test tab's Scan).
- Routing today: `geometry::controller_for_spoke` picks list entry
  `spoke / strings_per_controller`; `SacnSender::configure` parses it as an IPv4
  address. Anything unparsable silently gets no destination.
- The engine rebuilds the sender plan when `(geometry, output)` changes
  (`engine/mod.rs`, the `output_cfg_key` check). `configure` carries sequence
  numbers across rebuilds and only terminates universes the new plan drops.

## Decisions already made (don't re-ask)

- Both modes supported, mixable per entry (user, 2026-10-19).
- One list, one field: `output.controllers` stays `Vec<String>`; each entry is
  classified as empty / IPv4 / MAC / invalid. No config migration, no new UI
  concept beyond "you may type a MAC here".
- MAC, not the Advatek nickname, is the identity: it is unique and permanent,
  and needs no setup on the box. (A replacement box has a new MAC, so swapping a
  box means editing one entry, exactly as with fixed IPs.)

## Design

### Resolution

- New module `src-tauri/src/addressing.rs`:
  - `parse_entry` → `Empty | Ip(Ipv4Addr) | Mac([u8; 6]) | Invalid`. MAC accepts
    `aa:bb:…`, `aa-bb-…`, `aabb.ccdd.eeff` and bare 12 hex digits, any case.
  - `AddressBook`: MAC → (IP, when last seen, where from: scan / cache).
  - Cache persisted next to the config file (`controller-addresses.json`), so a
    restart sends to the last-known IP immediately instead of waiting on a scan.
  - Resolver thread (`addressing::spawn`, started beside `sacnwatch::spawn`):
    runs a controller-only probe (DiscProt + legacy, no sACN listen) whenever the
    config is in unicast mode and has at least one MAC entry. Every ~5 s while any
    MAC is unresolved, every ~30 s once all are. Skips a round while a manual scan
    holds the probe ports.
  - A manual Test-tab scan also feeds the book.
  - Any change bumps `SharedState.address_epoch`; the engine folds that into
    its reconfigure check, so the sender re-plans only when an address actually
    changes.
- `SacnSender::configure` takes the book. A MAC entry that resolves → unicast to
  its IP. **A MAC entry that has never resolved → that controller's universes go
  multicast** until it is found (12 universes ≈ 3 Mbps flood: harmless, and
  better than dark spokes). IP entries are never touched by discovery.
- Sync packets go to every resolved controller IP, plus the sync multicast group
  if any controller is on fallback.

### Visibility

- `RuntimeStatus.controller_addresses`: per entry — index, entry text, kind,
  current IP, source (configured / discovered / cached / multicast fallback /
  invalid / empty), seconds since last seen.
- Test tab: per-controller address table; found controllers show their MAC with
  a one-tap "use as controller N" to write it into the list.
- Settings: the controller textarea says "IP or MAC address, one per line" and
  flags invalid lines.
- Scan reconciliation (`found / missing / unexpected`) matches MAC entries by MAC.

## Plan / steps

1. [ ] `addressing.rs`: entry parsing + MAC normalisation + unit tests
2. [ ] Address book + cache file + resolver thread
3. [ ] `SacnSender::configure` uses the book; fallback multicast; tests
4. [ ] Engine reconfigure on `address_epoch`; status publishing
5. [ ] Discovery reconciliation by MAC; manual scan feeds the book
6. [ ] UI: Settings hint/validation, Test tab address table + "use as"
7. [ ] E2E against `scripts/fake-pixlite.ts`: a MAC entry resolves and sACN
       reaches the fake's address
8. [ ] README

## Findings / gotchas

- Windows drops discovery replies without the inbound UDP firewall rule
  (49150/49151/5568, `firewall.rs`) — the resolver silently finds nothing without
  it. The status must say "not found", not pretend.
- Legacy-protocol replies on 49150 are broadcast; two sockets bound to the same
  port on Windows get ambiguous delivery. That is why the resolver and the manual
  scan must not probe at the same time.

## Open questions for the user

(none yet)

## Things not to do

- Don't let discovery overwrite or second-guess an IP entry.
- Don't wait for a scan before sending at startup — use the cache.
- Don't go dark on an unresolved MAC; fall back to multicast for that controller.
