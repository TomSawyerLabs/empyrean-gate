# Gate network redesign

> V2 hardware planning (power, networking, compute, weatherproofing, expansion)
> now lives in `../Empyrean Upgrades`. This plan stays the detailed record of
> the network reasoning; that repo's `plans/networking.md` tracks what V2 still
> needs.

## Goal

Replace the single central switch with switches daisy-chained around the ring, so
cable runs stay short and the WAN can plug in at whichever node is closest to
whatever uplink the site offers (Starlink, the Burning Man uplink, a local
Ethernet cabinet).

## Environment / context

- 16× **Advatek PixLite E4-S Mk3**, 4 spokes each, 64 spokes, 192 data universes.
  Datasheet (2025-02-25): **1 × 10/100 Ethernet port** (no pass-through port),
  4 outputs × 6 universes (8 × 3 in expanded mode), 24 universes, 5–24 V DC input,
  2.5 W, −20 to 70 °C. Answers Advatek DiscProt discovery (the Mk3+ path).
- **Each PixLite lives in its own "node" box, and each box gets its own switch** —
  the ring is 16 switches in series.
- Node boxes have a 12 V supply today; a **48 V supply is being added** to each box
  for PoE.
- **PoE is injected at each node box, ideally by the box's managed switch.**
- Gateway: a **UniFi Cloud Gateway (UCG)** — it runs the UniFi Network application
  on-prem, so the gate is self-contained with no internet. Exact UCG model not yet
  recorded; every UCG supports multi-WAN.
- Show traffic: about 52 Mbps on the wire at 60 fps (128 full universes × ~702 B +
  64 partial × ~302 B per frame), sent as one unpaced burst per frame (`sacn.rs`).
- Site conditions: playa — heat, dust, uplink varies per event.

## Decisions already made (don't re-ask)

- Daisy-chained switches around the ring, one per node box, UniFi family, ring
  closed so RSTP routes around a dead box.
- The WAN must be pluggable at any node, carried to the gateway on a dedicated VLAN
  (UniFi has no native "WAN on a switch port" feature; a VLAN-only network plus
  port profiles is the supported way).
- sACN goes **unicast** to each controller.
- Empyrean will support **both** fixed controller IPs **and** MAC-keyed discovery
  that resolves IPs automatically — see `plans/controller-addressing.md`.
- Foreign-STP handling on the WAN port is deferred ("eventually/later").

## Design (current proposal)

### sACN: unicast to each controller

Empyrean's controller-unicast mode routes each spoke's universes to just the
controller that owns it (`geometry::controller_for_spoke`, by list position and
`strings_per_controller`). With unicast the switches only do MAC learning; IGMP
snooping and queriers stop mattering, and each PixLite receives only its own
~3 Mbps.

### Node-box switch

Each box needs: ring in, ring out, PixLite, WAN (labelled), PoE out for the box's
device(s), ideally a spare. Powered from the box's 48 V rail.

| Option (×16) | Total | Notes |
|---|---|---|
| **USW-Industrial-DIN-8-PoE** | ~$5,300 | Native 44–57 V DC terminal input (dual, redundant) — wires straight to the 48 V rail. 8× PoE++ (480 W), full L2 incl. IGMP querier, 2× SFP, aluminium, −30 to 70 °C. Ships Nov 2026. The only option that fits power, PoE and heat without caveats. |
| USW-Lite-8-PoE | ~$1,750 | 4× PoE+ (52 W), full L2. DC barrel input 50–57 V, so the "48 V" rail must be trimmed up to ~53 V. Rated only to 40 °C. |
| USW-Flex-2.5G-5 + a 48 V DC PoE injector per device | ~$780 + injectors | RSTP + VLANs; 5 V USB-C (buck from 12 V) or PoE in. PoE is unmanaged (no remote power-cycle from UniFi). Rated to 45 °C. |
| **USW-Ultra** ($129) | ~$2,100 + PSUs | **Leading choice** (see below). 8× GbE, 7× PoE+ out (30 W/port), RSTP + loop protection, no IGMP snooping (fine: unicast). DC input 50–57 V on a 5.5 × 2.1 mm barrel; budget up to 202 W. −20/−30 to 60 °C. |

**Run the 48 V rail at ~53–54 V.** PoE+ (802.3at Type 2) PSEs must output 50–57 V;
the Lite 8 PoE's and the Ultra's inputs are specified at 50–57 V. Most 48 V DIN
supplies trim that high.

**Leading choice: USW-Ultra, fed from the box's own rail** (user, 2026-10-20 — the
Industrial DIN is a stretch goal; it roughly doubles the cost).

- Skip the 210 W brick. The official UACC-Adapter-AC-210W is 54 V out on a
  5.5 × 2.1 mm plug, **rated only 0–40 °C** — the weakest part in a sun-baked box.
  Instead run a pigtail with a 5.5 × 2.1 mm plug from the box's 54 V DIN supply.
  **Check the polarity** on a real Ultra/adapter before wiring (expected centre
  positive; not confirmed by any spec page found).
- Size the supply for switch (~8 W) + the PoE load, with derating headroom for
  heat; the switch caps PoE at 202 W.
- Ports: ring in, ring out, PixLite, WAN, 4 left for PoE (the PoE++ *input* port
  is the eighth; whether it carries data when the switch is DC-powered is
  unverified — plan on it as a ring port only after a bench check).
- Heat: rated to 60 °C on the 210 W/PoE-in ratings (the 60 W adapter rating of
  45 °C is the adapter's). The boxes stay powered all day in a sealed outer box in
  the sun, with the lights off — so the load is small but solar gain is not.
  A sealed box in desert sun can pass 60 °C inside. Shade the box (a lid a few cm
  above the real lid), light colour, switch on the shaded wall; log one box's
  inside temperature on the playa before trusting it.

### WAN anywhere on the ring

- A VLAN-only network for the WAN, e.g. VLAN 4000 ("WAN transport").
- On **every** node switch, one designated port (same port number everywhere,
  physically labelled red) gets a port profile with native VLAN 4000 and nothing
  tagged. The upstream plugs into whichever red port is closest.
- The UCG's WAN port plugs into any red port and its LAN port into any ordinary
  port, so the gateway can also sit at any node.
- VLAN 4000 is tagged on the switch-to-switch links only, and explicitly removed
  from the gateway's LAN uplink port.
- Only one upstream per WAN VLAN at a time: two upstreams in two red ports would
  bridge two foreign networks together. A second WAN for failover needs its own
  VLAN (e.g. 4001) and a second label colour.
- The gate LAN uses an unusual subnet so it cannot collide with whatever subnet
  the upstream hands the gateway.

## Findings / gotchas

- **Unpaced bursts vs. FE ports.** One frame is ~109 KB arriving at gigabit speed in
  ~0.9 ms; a 100 Mbps port needs ~9 ms to drain it. Flooded multicast therefore
  needs ~100 KB of buffer per PixLite port every frame — small switches drop it.
  This is why multicast without snooping is ruled out with FE PixLites.
- **Snooping without a querier** is the classic "multicast works, then stops after a
  few minutes" failure. The GS305E ships exactly like that.
- **The repo used to call the boxes "PixLite Mk4-S"** — no such product exists.
  Corrected to E4-S Mk3 in `8ad289e`.
- **Foreign STP on the WAN port (untested, deferred).** UniFi runs one RSTP instance
  across all VLANs, so BPDUs from an upstream that runs STP (a cabinet switch, the
  event network) join the gate's tree; if that network uses BPDU guard, our BPDUs
  could err-disable *their* port and kill the uplink. Starlink does not run STP.
  Need to find out whether UniFi port profiles can disable STP / filter BPDUs on
  the WAN port.
- **RSTP hop limit.** Default Max Age is 20; a broken ring of 16 switches is a
  15-hop chain — inside the limit, with little headroom for more in series.
- Non-STP switches (Netgear GS305E, original Flex Mini) can only ever be leaves.
  The GS305E's "loop detection" just blinks LEDs.

## Progress log

- [x] sACN requirements for a daisy chain worked out (unicast)
- [x] Switch candidates compared from Ubiquiti spec pages
- [x] WAN-anywhere VLAN design
- [x] Node count: one switch per PixLite node box (16)
- [x] PixLite model confirmed: E4-S Mk3, 10/100 (repo corrected, `8ad289e`)
- [x] Gateway confirmed: UCG, Network app on-prem
- [ ] Choose the node-box switch — leaning USW-Ultra on the 54 V rail; needs the
      PoE load, and a heat check of a sealed box in the sun
- [x] Controller addressing: fixed IPs + MAC-keyed discovery (built; awaiting
      a first run on the real boxes)
      (`plans/controller-addressing.md`)
- [ ] Later: UniFi per-port STP / BPDU options for the WAN port profile

## Open questions for the user

1. What does each box's PoE power, and how many watts? (Sizes the 54 V supply.)
2. ~~Powered and in the sun during the day?~~ Answered: powered all day, sealed
   outer box in the sun, lights off by day.
3. ~~Budget?~~ Answered: Industrial DIN is a stretch goal (~2× cost); leaning
   USW-Ultra.

## Things not to do

- Don't put any non-STP switch inside the ring.
- Don't run multicast sACN to FE PixLites through non-snooping switches.
- Don't enable snooping on a network with no querier.
- Don't let VLAN 4000 reach any port other than the red WAN ports and the ring
  links.
- Don't run the PoE rail at a nominal 48 V — PoE+ needs ≥ 50 V at the PSE.
