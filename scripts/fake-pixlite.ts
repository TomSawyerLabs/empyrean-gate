// A fake Advatek PixLite Mk3+/Mk4 that answers the "DiscProt" discovery probe.
//
// Exists so the discovery path can be exercised without hardware: the packet
// PARSERS have unit tests against synthetic bytes, but that proves nothing about
// whether the probe actually leaves the machine, whether the multicast groups are
// joined correctly, or whether a reply is matched back to a source address.
// This closes that gap on real sockets.
//
// Speaks the Mk3+ protocol only. Mk1/Mk2 discovery is a broadcast on UDP 49150
// and replies unicast to the same port, so a fake sharing that port with the
// scanner has ambiguous delivery on Windows; that path stays covered by the
// parser unit tests in src-tauri/src/discovery.rs.
//
//   bun scripts/fake-pixlite.ts [count]

import dgram from "node:dgram";

const PORT = 49151;
const REQUEST_GROUP = "239.255.251.1";
const REPLY_GROUP = "239.255.251.2";

const count = Math.max(1, Number(process.argv[2] ?? 1));

const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

socket.on("message", (data, from) => {
  if (data.length < 12 || data.subarray(0, 8).toString() !== "DiscProt") return;
  // 0x12 0x01 is the discovery request; ignore anything else (including the
  // replies we ourselves put on the wire).
  if (data[8] !== 0x12 || data[9] !== 0x01) return;
  console.log(`probe from ${from.address}:${from.port} — answering with ${count} device(s)`);

  for (let i = 0; i < count; i++) {
    const body = JSON.stringify({
      ipAddr: `10.7.0.${10 + i}`,
      prodName: "PixLite 16 Mk4-S",
      fwVer: "1.4.2",
      nickname: `Spokes ${i * 4}-${i * 4 + 3}`,
      macAddr: `00:1D:2E:00:00:${(0x10 + i).toString(16).padStart(2, "0").toUpperCase()}`,
    });
    const header = Buffer.from([...Buffer.from("DiscProt"), 0x21, 0x02, 0x01, 0x01]);
    const packet = Buffer.concat([header, Buffer.from(body)]);
    socket.send(packet, PORT, REPLY_GROUP);
  }
});

socket.bind(PORT, () => {
  socket.addMembership(REQUEST_GROUP);
  socket.setMulticastLoopback(true);
  console.log(`fake PixLite listening on ${REQUEST_GROUP}:${PORT}, replying on ${REPLY_GROUP}`);
});
