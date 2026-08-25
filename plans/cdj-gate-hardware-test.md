# CDJ + Gate hardware test

Use the rekordbox playlist `Derek Plaslaiko Gate Test` on `GATEUSB`.

## Cue map

The letters have the same semantic role on each annotated track:

- A: START
- B: DROP / early jump test
- C: BREAK / late jump test
- D: OUTRO
- Memory loop: `16-BEAT LOOP`

| Playlist track | A | B | C | D | Saved loop |
| --- | ---: | ---: | ---: | ---: | ---: |
| 005 — The Rolling Stones — Sympathy For The Devil | 00:00 | 00:49 | 04:49 | 05:56 | 00:49 |
| 007 — Broadcast — Illumination | 00:00 | 01:03 | 02:29 | 03:05 | 03:05 |
| 008 — Gilb'R & DJ Sotofett — Cham | 00:00 | 00:46 | 09:24 | 11:35 | 11:35 |

All four Hot Cues are quantized and use rekordbox's distinct cue colors. Each
saved loop is 16 beats and carries the comment `16-BEAT LOOP`.

## Test sequence

1. Start the Gate server and client on the laptops.
2. Put the CDJ and Gate laptop on the same wired network.
3. In Gate Settings, choose `Pioneer PRO DJ LINK (global)` and leave the player
   selector on the tempo master/automatic option.
4. Load each annotated track from the USB. Confirm that the CDJ shows A-D and
   the saved memory loop.
5. Start playback and confirm Gate shows the player, LINK source, BPM, and a
   stable beat-driven visual clock.
6. Trigger A, B, C, and D in a nonsequential order. Gate should remain locked to
   the beat after every jump without freezing or falling back to audio.
7. Recall the `16-BEAT LOOP`, let it repeat several times, then exit it. Gate
   should stay phase-stable through loop entry, repetition, and exit.
8. Change pitch/tempo. Gate's reported BPM should follow smoothly.
9. If a second player is available, move tempo master between players and verify
   a clean master handoff. Otherwise change the configured player between Auto
   and the detected deck.
10. Disconnect and reconnect the LINK network once. Verify Gate reports the
    outage, uses its configured fallback, and reacquires the deck.

## Expected scope

Gate currently consumes PRO DJ LINK player discovery, tempo-master status, BPM,
beat position, and beat count. It does not yet consume the track title, Hot Cue
letter/comment, or phrase metadata. A Hot Cue jump or loop is therefore a timing
continuity test: Gate should stay synchronized, but it will not report `DROP`,
`BREAK`, or `OUTRO` as named events.
