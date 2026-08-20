// Remote inputs from THIS device (typically a phone on the LAN): microphone audio
// features and IMU orientation, streamed to the backend over the WebSocket.

import type { GateClient } from "./ws";

export type BrowserAudioStream = "microphone" | "video";

/** Analyze an AudioNode and send compact features (~40 Hz) to the Gate. */
export function startAudioFeatures(
  client: GateClient,
  ctx: AudioContext,
  analyser: AnalyserNode,
  stream: BrowserAudioStream,
): () => void {
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0;

  const bins = analyser.frequencyBinCount;
  const freq = new Uint8Array(bins);
  const time = new Uint8Array(analyser.fftSize);
  const prev = new Float32Array(bins);
  const binHz = ctx.sampleRate / analyser.fftSize;

  const band = (lo: number, hi: number) => {
    const a = Math.floor(lo / binHz);
    const b = Math.min(bins - 1, Math.floor(hi / binHz));
    let sum = 0;
    for (let i = a; i <= b; i++) sum += freq[i];
    return sum / ((b - a + 1) * 255);
  };

  const interval = window.setInterval(() => {
    analyser.getByteFrequencyData(freq);
    analyser.getByteTimeDomainData(time);
    let rms = 0;
    for (let i = 0; i < time.length; i++) {
      const v = (time[i] - 128) / 128;
      rms += v * v;
    }
    rms = Math.sqrt(rms / time.length);
    let flux = 0;
    for (let i = 0; i < bins; i++) {
      const magnitude = freq[i] / 255;
      const delta = magnitude - prev[i];
      if (delta > 0) flux += delta;
      prev[i] = magnitude;
    }
    client.sendAudioFrame(
      {
        level: Math.min(1, rms * 3),
        bass: band(20, 150),
        mid: band(150, 2000),
        treble: band(2000, 8000),
        flux,
      },
      stream,
    );
  }, 25);

  return () => window.clearInterval(interval);
}

/** Stream mic features (~40 Hz). Returns a stop function. */
export async function startMic(client: GateClient): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  src.connect(analyser);
  await ctx.resume();
  const stopFeatures = startAudioFeatures(client, ctx, analyser, "microphone");

  return () => {
    stopFeatures();
    void ctx.close();
    stream.getTracks().forEach((t) => t.stop());
  };
}

/** Stream device orientation + shake (~30 Hz). Returns a stop function. */
export async function startImu(client: GateClient): Promise<() => void> {
  // iOS requires an explicit permission request from a user gesture.
  const doe = DeviceOrientationEvent as unknown as {
    requestPermission?: () => Promise<string>;
  };
  if (typeof doe.requestPermission === "function") {
    const res = await doe.requestPermission();
    if (res !== "granted") throw new Error("motion permission denied");
  }

  let yaw = 0;
  let pitch = 0;
  let roll = 0;
  let shake = 0;

  const onOrient = (e: DeviceOrientationEvent) => {
    yaw = ((e.alpha ?? 0) * Math.PI) / 180;
    pitch = Math.max(-1, Math.min(1, (e.beta ?? 0) / 90));
    roll = Math.max(-1, Math.min(1, (e.gamma ?? 0) / 90));
  };
  const onMotion = (e: DeviceMotionEvent) => {
    const a = e.acceleration;
    if (a) {
      const mag = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
      if (mag > 4) shake = Math.min(3, mag / 10);
    }
  };
  window.addEventListener("deviceorientation", onOrient);
  window.addEventListener("devicemotion", onMotion);

  const interval = setInterval(() => {
    client.sendImu({ yaw, pitch, roll, shake });
    shake = 0;
  }, 33);

  return () => {
    clearInterval(interval);
    window.removeEventListener("deviceorientation", onOrient);
    window.removeEventListener("devicemotion", onMotion);
  };
}
