import { useEffect, useRef, useState } from "react";
import { startAudioFeatures } from "./sensors";
import { defaultLayer, type PlaylistEntry } from "./types";
import { useGate } from "./state";
import type { ResolvedMedia } from "./ws";

function newEntryId(): string {
  return (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/-/g, "");
}

const FRAME_RATES = [10, 15, 24];
const TEXTURE_SIZES = [64, 96, 128];
type AudioMode = "none" | "video" | `source:${number}`;

interface SoundtrackGraph {
  element: HTMLVideoElement;
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  analyser: AnalyserNode;
  output: GainNode;
  stopFeatures: (() => void) | null;
}

export default function Media() {
  const { client, config, connected, status } = useGate();
  const [url, setUrl] = useState("");
  const [media, setMedia] = useState<ResolvedMedia | null>(null);
  const [resolving, setResolving] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transportFps, setTransportFps] = useState(15);
  const [textureSize, setTextureSize] = useState(96);
  const [audioMode, setAudioMode] = useState<AudioMode>("video");
  const [audioAmount, setAudioAmount] = useState(0.7);
  const [monitorSoundtrack, setMonitorSoundtrack] = useState(false);
  const [sent, setSent] = useState(0);
  const [dropped, setDropped] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const localObjectUrl = useRef<string | null>(null);
  const claimStartedAt = useRef(0);
  const soundtrackRef = useRef<SoundtrackGraph | null>(null);

  const pauseSoundtrack = () => {
    const graph = soundtrackRef.current;
    if (!graph) return;
    graph.stopFeatures?.();
    graph.stopFeatures = null;
    graph.output.gain.value = 0;
  };

  const destroySoundtrack = () => {
    const graph = soundtrackRef.current;
    if (!graph) return;
    pauseSoundtrack();
    graph.source.disconnect();
    graph.analyser.disconnect();
    graph.output.disconnect();
    void graph.context.close();
    soundtrackRef.current = null;
  };

  const startSoundtrack = (video: HTMLVideoElement) => {
    let graph = soundtrackRef.current;
    if (!graph || graph.element !== video) {
      destroySoundtrack();
      const context = new AudioContext();
      const source = context.createMediaElementSource(video);
      const analyser = context.createAnalyser();
      const output = context.createGain();
      source.connect(analyser);
      analyser.connect(output);
      output.connect(context.destination);
      graph = { element: video, context, source, analyser, output, stopFeatures: null };
      soundtrackRef.current = graph;
    }
    // createMediaElementSource reroutes playback through this graph. Keep the
    // element itself unmuted so the analyser receives samples; the output gain
    // independently controls whether this iPad/laptop is audible.
    video.muted = false;
    graph.output.gain.value = monitorSoundtrack ? 1 : 0;
    graph.stopFeatures ??= startAudioFeatures(client, graph.context, graph.analyser, "video");
    void graph.context.resume();
  };

  const configureVideoReaction = (mode: AudioMode, amount: number): boolean => {
    if (!config) return false;
    const sources = [...config.audio.sources];
    let sourceIndex = 0;
    if (mode === "video") {
      sourceIndex = sources.findIndex((source) => source.kind === "video");
      if (sourceIndex < 0) {
        if (sources.length >= 4) {
          setError("All four audio-source slots are in use. Remove one in Settings to analyze the video soundtrack.");
          return false;
        }
        sourceIndex = sources.length;
        sources.push({ id: "video", kind: "video", gain: 1 });
      }
    } else if (mode.startsWith("source:")) {
      sourceIndex = Number(mode.slice(7));
      if (!sources[sourceIndex] || sources[sourceIndex].kind === "video") {
        setError("That live audio source is no longer available. Choose another source.");
        return false;
      }
    }

    const layers = config.layers.map((layer) =>
      layer.kind === "video"
        ? { ...layer, audio_source: sourceIndex, audio_amount: mode === "none" ? 0 : amount }
        : layer,
    );
    if (!layers.some((layer) => layer.kind === "video")) {
      layers.push({
        ...defaultLayer("video"),
        audio_source: sourceIndex,
        audio_amount: mode === "none" ? 0 : amount,
      });
    }
    client.setConfig({ ...config, audio: { sources }, layers });
    return true;
  };

  const replaceMedia = (next: ResolvedMedia) => {
    destroySoundtrack();
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

  const [currentEntryId, setCurrentEntryId] = useState<string | null>(null);
  const playlist = config?.video.playlist ?? [];
  const cacheOf = (id: string) => status?.video_cache.find((c) => c.id === id);

  /// Adding a URL also appends it to the persistent playlist, which starts the
  /// background download into the Gate's media cache.
  const addToPlaylist = (source: string, title: string): string => {
    if (!config) return "";
    const existing = config.video.playlist.find((e) => e.source === source);
    if (existing) return existing.id;
    const entry: PlaylistEntry = {
      id: newEntryId(),
      title,
      source,
      kind: "url",
      from_dir: "",
    };
    client.setConfig({
      ...config,
      video: { ...config.video, playlist: [...config.video.playlist, entry] },
    });
    return entry.id;
  };

  const playEntry = async (entry: PlaylistEntry) => {
    setCurrentEntryId(entry.id);
    const cache = cacheOf(entry.id);
    const cachedOrLocal = entry.kind === "local_file" || cache?.state === "cached";
    if (cachedOrLocal) {
      // Served by the Gate itself — no internet involved.
      replaceMedia({
        playbackUrl: `${client.httpBase}/media/file/${entry.id}`,
        title: entry.title,
        sourceUrl: entry.source,
        resolvedBy: entry.kind === "local_file" ? "Gate machine file" : "Gate media cache",
      });
      return;
    }
    // Not cached yet: stream through the live resolver proxy (needs internet).
    setResolving(true);
    setError(null);
    try {
      replaceMedia(await client.resolveMedia(entry.source));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResolving(false);
    }
  };

  const stepPlaylist = (dir: 1 | -1) => {
    if (playlist.length === 0) return;
    const i = playlist.findIndex((e) => e.id === currentEntryId);
    const next = playlist[(i + dir + playlist.length) % playlist.length];
    void playEntry(next);
  };

  const resolveUrl = async () => {
    if (!url.trim() || !connected) return;
    setResolving(true);
    setError(null);
    try {
      const resolved = await client.resolveMedia(url.trim());
      const id = addToPlaylist(url.trim(), resolved.title);
      setCurrentEntryId(id || null);
      replaceMedia(resolved);
      setUrl("");
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
    if (!configureVideoReaction(audioMode, audioAmount)) return;
    if (audioMode === "video") {
      try {
        startSoundtrack(video);
      } catch (e) {
        setError(`The soundtrack could not be analyzed: ${e instanceof Error ? e.message : e}`);
        return;
      }
    } else {
      pauseSoundtrack();
    }
    claimStartedAt.current = performance.now();
    client.startVideo(media.title, media.sourceUrl);
    // Calling play synchronously from this tap matters on iPadOS.
    void video
      .play()
      .then(() => {
        setBroadcasting(true);
      })
      .catch((e) => {
        pauseSoundtrack();
        client.stopVideo();
        setError(`Playback could not start: ${e instanceof Error ? e.message : e}`);
      });
  };

  const stop = () => {
    setBroadcasting(false);
    pauseSoundtrack();
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
      destroySoundtrack();
      if (localObjectUrl.current) URL.revokeObjectURL(localObjectUrl.current);
    },
    [],
  );

  useEffect(() => {
    const graph = soundtrackRef.current;
    if (graph) graph.output.gain.value = monitorSoundtrack && broadcasting && audioMode === "video" ? 1 : 0;
  }, [audioMode, broadcasting, monitorSoundtrack]);

  const active = status?.video;
  const ownedHere = active?.active && active.owner_id === client.clientId;
  const soundtrackIndex = config?.audio.sources.findIndex((source) => source.kind === "video") ?? -1;
  const soundtrackStatus = soundtrackIndex >= 0 ? status?.audio[soundtrackIndex] : undefined;

  const changeAudioMode = (next: AudioMode) => {
    setAudioMode(next);
    if (!broadcasting) return;
    if (!configureVideoReaction(next, audioAmount)) return;
    if (next === "video" && videoRef.current) {
      try {
        startSoundtrack(videoRef.current);
      } catch (e) {
        setError(`The soundtrack could not be analyzed: ${e instanceof Error ? e.message : e}`);
      }
    } else {
      pauseSoundtrack();
    }
  };

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

      <section className="panel">
        <h2>Playlist</h2>
        <p className="hint">
          URLs you load are added here and downloaded into the Gate's media cache — once
          cached (or from a watched folder), playback needs no internet at all.
        </p>
        {playlist.length === 0 && <p className="hint">Nothing yet — load a URL above or watch a folder below.</p>}
        {playlist.map((entry) => {
          const cache = cacheOf(entry.id);
          const chip =
            entry.kind === "local_file"
              ? cache?.state === "error"
                ? "file missing"
                : "local"
              : cache?.state === "cached"
                ? `cached ✓ ${(cache.bytes / 1e6).toFixed(0)} MB`
                : cache?.state === "downloading"
                  ? `⬇ ${(cache.progress * 100).toFixed(0)}%`
                  : cache?.state === "error"
                    ? "cache failed — will retry"
                    : "waiting to cache";
          return (
            <div
              key={entry.id}
              className={`layer-head client-row ${entry.id === currentEntryId ? "playing" : ""}`}
            >
              <button onClick={() => void playEntry(entry)}>
                {entry.id === currentEntryId ? "▶ " : ""}
                {entry.title || entry.source}
              </button>
              <span className={cache?.state === "error" ? "warn" : "hint"}>{chip}</span>
              <span className="spacer" />
              {entry.from_dir === "" && (
                <button
                  className="danger"
                  onClick={() => {
                    if (!config) return;
                    client.setConfig({
                      ...config,
                      video: {
                        ...config.video,
                        playlist: config.video.playlist.filter((e) => e.id !== entry.id),
                      },
                    });
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
        <div className="add-row">
          <button onClick={() => stepPlaylist(-1)} disabled={playlist.length === 0}>
            ⏮ Previous
          </button>
          <button onClick={() => stepPlaylist(1)} disabled={playlist.length === 0}>
            Next ⏭
          </button>
          <label className="toggle-row" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={config?.video.auto_advance ?? false}
              onChange={(e) => {
                if (config) {
                  client.setConfig({
                    ...config,
                    video: { ...config.video, auto_advance: e.target.checked },
                  });
                }
              }}
            />
            Auto-advance when a video ends
          </label>
        </div>
        <h2 style={{ marginTop: 16 }}>Watched folders on the Gate machine</h2>
        <p className="hint">
          Every video file found in these folders (3 levels deep) joins the playlist
          automatically. Paths are on the machine running the Gate backend.
        </p>
        {(config?.video.dirs ?? []).map((dir) => (
          <div key={dir} className="layer-head client-row">
            <span>{dir}</span>
            <span className="spacer" />
            <button
              className="danger"
              onClick={() => {
                if (!config) return;
                client.setConfig({
                  ...config,
                  video: { ...config.video, dirs: config.video.dirs.filter((d) => d !== dir) },
                });
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <form
          className="add-row"
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.namedItem("dir") as HTMLInputElement;
            const dir = input.value.trim();
            if (dir && config && !config.video.dirs.includes(dir)) {
              client.setConfig({ ...config, video: { ...config.video, dirs: [...config.video.dirs, dir] } });
              input.value = "";
            }
          }}
        >
          <input name="dir" placeholder="e.g. D:\show-videos" style={{ flex: 1 }} />
          <button type="submit">Watch folder</button>
        </form>
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
              muted={audioMode !== "video" || !broadcasting}
              loop={!(config?.video.auto_advance && currentEntryId && playlist.length > 1)}
              preload="metadata"
              crossOrigin="anonymous"
              onEnded={() => {
                if (config?.video.auto_advance && currentEntryId && playlist.length > 1) {
                  stepPlaylist(1);
                }
              }}
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
          <div className="media-audio-controls">
            <label>
              Rhythm source
              <select value={audioMode} onChange={(e) => changeAudioMode(e.target.value as AudioMode)}>
                <option value="video">Video soundtrack</option>
                {(config?.audio.sources ?? []).some((source) => source.kind !== "video") && (
                  <optgroup label="Gate live inputs">
                    {(config?.audio.sources ?? []).map((source, index) =>
                      source.kind !== "video" ? (
                        <option key={`${source.id}-${index}`} value={`source:${index}`}>
                          {source.id}
                        </option>
                      ) : null,
                    )}
                  </optgroup>
                )}
                <option value="none">Visual only</option>
              </select>
            </label>
            <label className="media-audio-amount">
              Response <strong>{Math.round(audioAmount * 100)}%</strong>
              <input
                type="range"
                min="0"
                max="1.5"
                step="0.05"
                value={audioAmount}
                disabled={audioMode === "none"}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setAudioAmount(next);
                  if (broadcasting) configureVideoReaction(audioMode, next);
                }}
              />
            </label>
            {audioMode === "video" && (
              <label className="media-monitor-toggle">
                <input
                  type="checkbox"
                  checked={monitorSoundtrack}
                  onChange={(e) => setMonitorSoundtrack(e.target.checked)}
                />
                Hear soundtrack here
              </label>
            )}
            {audioMode === "video" && broadcasting && (
              <span className={soundtrackStatus?.active ? "ok" : "hint"}>
                {soundtrackStatus?.active
                  ? `Soundtrack live${soundtrackStatus.bpm > 0 && soundtrackStatus.bpm_confidence >= 0.35 ? ` · ${soundtrackStatus.bpm.toFixed(0)} BPM` : " · finding beat…"}`
                  : "Starting soundtrack analysis…"}
              </span>
            )}
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
          speed, and audio response all remain live and composable with the other patterns. The
          rhythm source above can be the video's own soundtrack or any configured Gate input.
        </p>
        {active?.active && !broadcasting && (
          <button className="danger" onClick={() => client.stopVideo(true)}>Stop current source</button>
        )}
      </section>
    </div>
  );
}
