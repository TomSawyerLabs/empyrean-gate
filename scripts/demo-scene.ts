// Drives a lively scene on a running backend for ~15 s (screenshots / demos):
// a glow spiral being painted, sparkle accents, and periodic bursts.
// Usage: bun scripts/demo-scene.ts [ws://127.0.0.1:9520/ws]

const url = process.argv[2] ?? "ws://127.0.0.1:9520/ws";
const ws = new WebSocket(url);

ws.onopen = () => {
  ws.send(JSON.stringify({ type: "hello", name: "demo-scene", client_id: "demo", token: "" }));
  let t = 0;
  const interval = setInterval(() => {
    t += 0.1;
    const angle = t * 1.8;
    const radius = 0.25 + 0.65 * ((t * 0.13) % 1);
    ws.send(
      JSON.stringify({
        type: "paint",
        pen: "glow",
        points: [{ angle, radius }],
        hue: (0.55 + t * 0.02) % 1,
        size: 0.14,
        intensity: 1,
      }),
    );
    if (Math.abs((t % 2.5) - 0.05) < 0.06) {
      ws.send(
        JSON.stringify({
          type: "trigger_effect",
          effect: { kind: "burst", angle: angle + Math.PI, radius: 0.8, intensity: 1, hue: 0.85, duration: 0 },
        }),
      );
    }
    if (t > 15) {
      clearInterval(interval);
      ws.close();
      process.exit(0);
    }
  }, 100);
};

setTimeout(() => process.exit(0), 20000);
