import { useEffect, useRef, useState } from "react";
import { defaultLayer } from "./types";
import { useGate } from "./state";
import type { ResolvedMedia } from "./ws";

const FRAME_RATES = [10, 15, 24];
const TEXTURE_SIZES = [64, 96, 128];

export default function Media() {
  const { client, config, connected, status } = useGate();
  const [url, setUrl] = useState("");
  const [media, setMedia] = useState<ResolvedMedia | null>(null);
  const [resolving, setResolving] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transportFps, setTransportFps] = useState(15);
  const [textureSize, setTextureSize] = useState(96);
  const [sent, setSent] = useState(0);
  const [dropped, setDropped] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const localObjectUrl = useRef<string | null>(null);
  const claimStartedAt = useRef(0);

  const replaceMedia = (next: ResolvedMedia) => {
    if (localObjectUrl.current && localObjectUrl.current !== next.playbackUrl) {
      URL.revokeObjectURL(localObjectUrl.current);
      localObjectUrl.current = null;
    }
    setBroadcasting(false);
    setSent(0);
    setDropped(0);
    setError(null);
    setMedia(next);
  };

  const resolveUrl = async () => {
    if (!url.trim() || !connected) return;
    setResolving(true);
    setError(null);
    try {
      replaceMedia(await client.resolveMedia(url.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResolving(false);
    }
  };

  const loadFile = (file: File | undefined) => {
    if (!file) return;
    const playbackUrl = URL.createObjectURL(file);
    localObjectUrl.current = playbackUrl;
    replaceMedia({
      playbackUrl,
      title: file.name,
      sourceUrl: `local file: ${file.name}`,
      resolvedBy: "this device",
    });
  };

  const goLive = () => {
    const video = videoRef.current;
    if (!video || !media) return;
    // Calling play synchronously from this tap matters on iPadOS.
    void video
      .play()
      .then(() => {
        if (!config?.layers.some((layer) => layer.kind === "video")) {
          client.addLayer(defaultLayer("video"));
        }
        setBroadcasting(true);
      })
      .catch((e) => setError(`Playback could not start: ${e instanceof Error ? e.message : e}`));
  };

  const stop = () => {
    setBroadcasting(false);
    client.stopVideo();
  };

  useEffect(() => {
    if (!broadcasting || !media || !connected) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    if (!video || !canvas || !ctx) return;
    claimStartedAt.current = performance.now();
    client.startVideo(media.title, media.sourceUrl);
    canvas.width = textureSize;
    canvas.height = textureSize;
    let cancelled = false;
    let callbackId = 0;
    let timer = 0;
    let lastSent = 0;
    const interval = 1000 / transportFps;

    const capture = (now: number) => {
      if (cancelled) return;
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && now - lastSent >= interval) {
        const sw = video.videoWidth;
        const sh = video.videoHeight;
        if (sw > 0 && sh > 0) {
          // Center-crop to a square before the GPU's radial/kaleidoscope mapping.
          const side = Math.min(sw, sh);
          const sx = (sw - side) / 2;
          const sy = (sh - side) / 2;
          try {
            ctx.drawImage(video, sx, sy, side, side, 0, 0, textureSize, textureSize);
            const rgba = ctx.getImageData(0, 0, textureSize, textureSize).data;
            if (client.sendVideoFrame(textureSize, textureSize, rgba)) {
              setSent((n) => n + 1);
            } else {
              setDropped((n) => n + 1);
            }
            lastSent = now;
          } catch {
            setError("The browser blocked access to this video's pixels. Reload it through the Gate URL resolver.");
            setBroadcasting(false);
            client.stopVideo();
            return;
          }
        }
      }
      schedule();
    };

    const schedule = () => {
      if ("requestVideoFrameCallback" in video) {
        callbackId = video.requestVideoFrameCallback((now) => capture(now));
      } else {
        timer = window.setTimeout(() => capture(performance.now()), interval);
      }
    };
    schedule();
    return () => {
      cancelled = true;
      if (callbackId && "cancelVideoFrameCallback" in video) {
        video.cancelVideoFrameCallback(callbackId);
      }
      clearTimeout(timer);
      client.stopVideo();
    };
  }, [broadcasting, client, connected, media, textureSize, transportFps]);

  // If another device takes over, stop doing local capture once the status
  // round-trip confirms it. Cleanup is owner-scoped, so it cannot stop the winner.
  useEffect(() => {
    if (
      broadcasting &&
      status?.video.active &&
      status.video.owner_id !== client.clientId &&
      performance.now() - claimStartedAt.current > 1500
    ) {
      setBroadcasting(false);
    }
  }, [broadcasting, client.clientId, status]);

  useEffect(
    () => () => {
      if (localObjectUrl.current) URL.revokeObjectURL(localObjectUrl.current);
    },
    [],
  );

  const active = status?.video;
  const ownedHere = active?.active && active.owner_id === client.clientId;

  return (
    <div className="media-page">
      <section className="panel media-source-panel">
        <div className="media-heading">
          <div>
            <h2>Video source</h2>
            <p className="hint">
              Paste a direct video or publisher-page URL. The Gate resolves it to a same-origin
              stream, your device decodes it, and only a tiny live texture crosses the show LAN.
            </p>
          </div>
          {active?.active && (
            <span className="media-live-pill">
              LIVE · {active.width}×{active.height} · {active.fps.toFixed(1)} fps
            </span>
          )}
        </div>

        <form
          className="media-url-row"
          onSubmit={(e) => {
            e.preventDefault();
            void resolveUrl();
          }}
        >
          <input
            type="url"
            inputMode="url"
            placeholder="https://… video or page URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button type="submit" disabled={!connected || resolving || !url.trim()}>
            {resolving ? "Finding video…" : "Load URL"}
          </button>
        </form>
        <div className="media-or"><span>or</span></div>
        <label className="media-file-button">
          Choose a video on this device
          <input type="file" accept="video/*" onChange={(e) => loadFile(e.target.files?.[0])} />
        </label>
        {error && <p className="media-error">{error}</p>}
      </section>

      {media && (
        <section className="panel media-player-panel">
          <div className="media-stage">
            <video
              ref={videoRef}
              key={media.playbackUrl}
              src={media.playbackUrl}
              controls
              playsInline
              muted
              loop
              preload="metadata"
              crossOrigin="anonymous"
            />
            <canvas ref={canvasRef} className="media-texture-preview" aria-label="Texture sent to the Gate" />
          </div>
          <div className="media-info">
            <div>
              <strong>{media.title}</strong>
              <span>resolved by {media.resolvedBy}</span>
            </div>
            <div className="media-transport-controls">
              <label>
                Texture
                <select value={textureSize} onChange={(e) => setTextureSize(Number(e.target.value))}>
                  {TEXTURE_SIZES.map((n) => <option key={n} value={n}>{n}×{n}</option>)}
                </select>
              </label>
              <label>
                Send rate
                <select value={transportFps} onChange={(e) => setTransportFps(Number(e.target.value))}>
                  {FRAME_RATES.map((n) => <option key={n} value={n}>{n} fps</option>)}
                </select>
              </label>
            </div>
          </div>
          <div className="media-actions">
            {!broadcasting ? (
              <button className="primary" onClick={goLive} disabled={!connected}>Play on Gate</button>
            ) : (
              <button className="danger" onClick={stop}>Stop Gate video</button>
            )}
            <span className="hint">
              {broadcasting
                ? `${sent.toLocaleString()} frames sent${dropped ? ` · ${dropped} dropped to stay live` : ""}`
                : "Playback is local until you tap Play on Gate."}
            </span>
          </div>
        </section>
      )}

      <section className="panel media-treatment-panel">
        <h2>Gate treatment</h2>
        {active?.active ? (
          <p>
            <strong>{active.title || "Untitled video"}</strong> is coming from {active.owner_name || "a connected device"}.
            {ownedHere ? " This device owns the live feed." : " Starting another source will take it over cleanly."}
          </p>
        ) : (
          <p className="hint">No video frames are live. The last frame is removed immediately when its source stops or disconnects.</p>
        )}
        <p className="hint">
          Add or edit a <strong>Video</strong> layer in Settings to shape it: Zoom, Kaleidoscope,
          Contrast, Rotation, saturation, tint/original-color mix, brightness, blend, opacity,
          speed, and audio response all remain live and composable with the other patterns.
        </p>
        {active?.active && !broadcasting && (
          <button className="danger" onClick={() => client.stopVideo(true)}>Stop current source</button>
        )}
      </section>
    </div>
  );
}
