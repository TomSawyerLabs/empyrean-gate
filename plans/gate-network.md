# Gate network redesign

## Goal

Replace the single central switch with switches daisy-chained around the ring, so
cable runs stay short and the WAN can plug in at whichever node is closest to
whatever uplink the site offers (Starlink, the Burning Man uplink, a local
Ethernet cabinet).

## Environment / context

- 16× Advatek PixLite (README says "Mk4-S"; see Findings — the model is unconfirmed),
  4 spokes each, 64 spokes, 192 data universes. The user reports the PixLites are
  **Fast Ethernet (100 Mbps)**.
- **Each PixLite lives in its own "node" box, and each box gets its own switch** —
  so the ring is 16 small switches in series (plus a head switch if one is used).
- Show traffic: about 52 Mbps on the wire at 60 fps (128 full universes × ~702 B +
  64 partial × ~302 B per frame), sent as one unpaced burst per frame (`sacn.rs`).
- Gateway: a UniFi UXG, model not yet confirmed (the user thinks it is the cheaper
  one). The UXG line is gateway-only: the UniFi Network application has to run
  somewhere else (see Open questions).
- Site conditions: playa — heat, dust, no guaranteed internet.

## Decisions already made (don't re-ask)

- Daisy-chained switches around the ring, UniFi family.
- The WAN must be pluggable at any node of the ring, carried to the gateway on a
  dedicated VLAN (UniFi has no native "WAN on a switch port" feature; a VLAN-only
  network plus port profiles is the supported way).

## Design (current proposal)

### sACN: unicast to each controller

Empyrean's controller-unicast mode already routes each spoke's universes to just the
controller that owns it (`geometry::controller_for_spoke`, by list position and
`strings_per_controller`). With unicast, the switches only do MAC learning; IGMP
snooping and queriers stop mattering. Each PixLite receives only its own ~3 Mbps.

Needs fixed controller IPs (static on the box, or DHCP reservations) entered in
spoke order. Automatic discovery that resolves IPs by MAC was discussed — see Open
questions.

### Switches

One switch per node box, 5 ports each: ring in, ring out, PixLite, WAN (labelled),
spare. **Proposed: USW-Flex-2.5G-5 ("Flex Mini 2.5G") in every box** — the cheapest
UniFi switch with RSTP and VLANs, about $780 for 16. Powered by 5 V USB-C (≤5 W) from
a small buck converter off the box's supply, or by PoE in. Caveat: rated only to
45 °C, polycarbonate — fine at night in a ventilated box, a real question if the
boxes bake powered-on all day.

Where PoE is wanted (APs, cameras, the show machine end), add **one head switch** in
the ring — Lite 8 PoE, or Industrial DIN 8 PoE for the heat — and make it the RSTP
root (lowest bridge priority).

Industrial DIN at every box would be ~$5,300 plus PSUs; non-UniFi industrial 5-port
RSTP switches with 12–48 V terminal inputs are the alternative if the 45 °C limit
rules out the Flex Mini 2.5G, at the cost of configuring 16 boxes by hand.

**Close the ring.** With 16 boxes in series, one box losing power cuts off every box
downstream of it. With the ring closed, RSTP routes around it and only that box goes
dark.

| Model | Price | Why / why not |
|---|---|---|
| **USW-Industrial-DIN-8-PoE** | $329, ships Nov 2026 | Full L2 feature set incl. IGMP querier, 8× PoE++ (480 W), 2× SFP, aluminium, −30 to 70 °C, dual 44–57 V DC inputs. Needs a 48 V DIN PSU per node. Recommended for the playa. |
| USW-Lite-8-PoE | $109 | Full L2 feature set incl. IGMP querier, 4× PoE+ (52 W). Only rated to 40 °C — viable only shaded and ventilated. |
| USW-Ultra family | $129–199 | RSTP + loop protection, 7× PoE+, but no IGMP snooping in its spec. |
| USW-Flex-2.5G-5 ("Flex Mini 2.5G") | $49 | RSTP, no IGMP snooping, PoE/USB-C powered, no PoE out. Fine with unicast. |
| USW-Flex-Mini (1G) | $29 | No STP, no IGMP. Leaf only, never in a loop. |
| Netgear GS305E | — | No STP (its "loop detection" only blinks LEDs); IGMP snooping on by default with no querier. Leaf only. |

### WAN anywhere on the ring

- A VLAN-only network for the WAN, e.g. VLAN 4000 ("WAN transport").
- On **every** ring switch, one designated port (same port number everywhere,
  physically labelled) gets a port profile with native VLAN 4000 and nothing
  tagged. The upstream (Starlink, cabinet, …) plugs into whichever one is closest.
- The UXG's WAN port plugs into any WAN-labelled port, and its LAN port into any
  ordinary port, so the gateway can also sit at any node.
- VLAN 4000 is tagged on the switch-to-switch links only, and explicitly removed
  from the gateway's LAN uplink port.
- Only one upstream per WAN VLAN at a time: two upstreams in two WAN ports would
  bridge two foreign networks together. A second WAN (only if the UXG has the
  ports for multi-WAN) needs its own VLAN (e.g. 4001) and a second label colour.
- The gate LAN uses an unusual subnet so it cannot collide with whatever subnet
  the upstream hands the gateway.

## Findings / gotchas

- **Unpaced bursts vs. FE ports.** One frame is ~109 KB arriving at gigabit speed in
  ~0.9 ms; a 100 Mbps port needs ~9 ms to drain it. Flooded multicast therefore
  needs ~100 KB of buffer per PixLite port every frame — small switches drop it.
  This is why multicast without snooping is ruled out with FE PixLites.
- **Snooping without a querier** is the classic "multicast works, then stops after a
  few minutes" failure. The GS305E ships exactly like that.
- **PixLite model is uncertain.** No "Mk4-S" product could be found. The Mk3
  datasheets list dual *gigabit* ports, which contradicts "FE". If the boxes are
  Mk2-generation they answer the legacy discovery protocol, which is unit-tested
  only and does not parse the MAC.
- **Foreign STP on the WAN port (untested risk).** UniFi runs one RSTP instance
  across all VLANs, so BPDUs from an upstream that runs STP (a cabinet switch, the
  event network) join the gate's tree; if that network uses BPDU guard, our BPDUs
  could err-disable *their* port and kill the uplink. Starlink does not run STP.
  Need to find out whether UniFi port profiles can disable STP / filter BPDUs on
  the WAN port.
- **The UXG is gateway-only.** Adoption and configuration need a UniFi Network
  application elsewhere; configuration persists on the devices without it.
- **RSTP hop limit.** Default Max Age is 20, so a broken ring of 17 switches (16
  boxes + head) is a 16-hop chain — inside the limit, but there is not much
  headroom for adding more switches in series.
- Do not continue the chain through a PixLite's second Ethernet port (if present):
  that puts a 100 Mbps hop in the backbone.

## Progress log

- [x] sACN requirements for a daisy chain worked out (unicast recommended)
- [x] Switch candidates compared from Ubiquiti spec pages
- [x] WAN-anywhere VLAN design
- [ ] Confirm the UXG model and where the Network application will run
- [ ] Confirm the PixLite model and Ethernet speed (Advatek Assistant or the label)
- [x] Node count: one switch per PixLite node box (16)
- [ ] Decide PoE loads and whether a head switch is needed
- [ ] Check node-box thermal conditions against the Flex Mini 2.5G's 45 °C rating
- [ ] Confirm node-box supply voltage, for the USB-C buck converter
- [ ] Check UniFi per-port STP / BPDU options for the WAN port profile
- [ ] Decide on fixed IPs vs. discovery-resolved unicast

## Open questions for the user

1. Which UXG exactly (Lite = 1 WAN + 1 LAN; Max = 5 ports, up to 4 WANs)? And where
   should the UniFi Network application live for the gate — the home console
   managing it remotely, or self-hosted on the show machine?
2. Which PixLite model is printed on the boxes?
3. What will PoE power, and where? (Decides whether there is a head switch, and
   which one.)
4. Are the node boxes powered (and in the sun) during the day? What is their supply
   voltage?
5. Fixed controller IPs, or build MAC-keyed discovery that resolves IPs
   automatically (recommended only after discovery is validated on the real boxes)?

## Things not to do

- Don't put any non-STP switch (GS305E, Flex Mini 1G) inside a loop.
- Don't run multicast sACN to FE PixLites through non-snooping switches.
- Don't enable snooping on a network with no querier.
- Don't let VLAN 4000 reach any port other than the WAN-labelled ones and the
  ring links.
