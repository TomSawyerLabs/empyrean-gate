export type VideoTempoMode = "fixed" | "pro_dj_link";

export const MIN_VIDEO_PLAYBACK_RATE = 0.5;
export const MAX_VIDEO_PLAYBACK_RATE = 2;

export interface VideoPlaybackRateInput {
  baseRate: number;
  mode: VideoTempoMode;
  referenceBpm: number;
  linkBpm: number;
  linkActive: boolean;
}

const finiteOr = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

export function clampVideoPlaybackRate(rate: number): number {
  return Math.min(
    MAX_VIDEO_PLAYBACK_RATE,
    Math.max(MIN_VIDEO_PLAYBACK_RATE, finiteOr(rate, 1)),
  );
}

/**
 * The base rate is the speed at the video's reference tempo. LINK scaling is
 * deliberately ignored while LINK is unavailable, so losing a deck never
 * freezes or wildly accelerates the video.
 */
export function videoPlaybackRate(input: VideoPlaybackRateInput): number {
  const baseRate = clampVideoPlaybackRate(input.baseRate);
  if (input.mode !== "pro_dj_link" || !input.linkActive) return baseRate;
  const referenceBpm = finiteOr(input.referenceBpm, 0);
  const linkBpm = finiteOr(input.linkBpm, 0);
  if (referenceBpm <= 0 || linkBpm <= 0) return baseRate;
  return clampVideoPlaybackRate(baseRate * linkBpm / referenceBpm);
}
