import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  Audio,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export interface MergeClip {
  url: string;
  durationInFrames: number;
}

export interface MergeCompositionProps {
  clips: MergeClip[];
  /** Crossfade length between consecutive clips, in seconds. Default 0.4s. */
  transitionSeconds?: number;
  music?: {
    url: string;
    durationSeconds?: number;
    startSeconds?: number;
    endSeconds?: number | null;
    volume?: number;
    fadeInSeconds?: number;
    fadeOutSeconds?: number;
    loop?: boolean;
  };
}

const CrossfadeVideo: React.FC<{ src: string; fadeInFrames: number }> = ({
  src,
  fadeInFrames,
}) => {
  const frame = useCurrentFrame();
  const opacity =
    fadeInFrames > 0
      ? interpolate(frame, [0, fadeInFrames], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;
  return (
    <AbsoluteFill style={{ opacity }}>
      <OffthreadVideo src={src} style={{ width: "100%", height: "100%" }} />
    </AbsoluteFill>
  );
};

export const MergeComposition: React.FC<MergeCompositionProps> = ({
  clips = [],
  transitionSeconds = 0.4,
  music,
}) => {
  const { fps } = useVideoConfig();
  const transitionFrames = Math.max(0, Math.round(transitionSeconds * fps));

  // Overlap each clip with the previous one so it can crossfade in, instead
  // of hard-cutting — capped to the shorter of the two adjacent clips so a
  // very short clip can't produce a negative remaining duration.
  let cursor = 0;
  const placedClips = clips.map((clip, index) => {
    const overlap =
      index === 0
        ? 0
        : Math.min(
            transitionFrames,
            clip.durationInFrames,
            clips[index - 1].durationInFrames,
          );
    cursor -= overlap;
    const from = cursor;
    cursor += clip.durationInFrames;
    return { clip, from, overlap };
  });
  const durationInFrames = cursor;
  const musicStartFrom = Math.round((music?.startSeconds ?? 0) * fps);
  const requestedMusicEndAt =
    music?.endSeconds != null ? Math.round(music.endSeconds * fps) : undefined;
  const musicEndAt =
    requestedMusicEndAt !== undefined && requestedMusicEndAt > musicStartFrom
      ? requestedMusicEndAt
      : undefined;
  const fadeInFrames = Math.round((music?.fadeInSeconds ?? 0) * fps);
  const fadeOutFrames = Math.round((music?.fadeOutSeconds ?? 0) * fps);
  const clampOpts = {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  } as const;
  const volume = (frame: number): number => {
    const fadeIn =
      fadeInFrames > 0
        ? interpolate(frame, [0, fadeInFrames], [0, 1], clampOpts)
        : 1;
    const fadeOut =
      fadeOutFrames > 0
        ? interpolate(
            frame,
            [durationInFrames - fadeOutFrames, durationInFrames],
            [1, 0],
            clampOpts,
          )
        : 1;

    return (music?.volume ?? 0.4) * Math.min(fadeIn, fadeOut);
  };

  return (
    <AbsoluteFill>
      {placedClips.map(({ clip, from, overlap }, index) => (
        <Sequence key={index} from={from} durationInFrames={clip.durationInFrames}>
          <CrossfadeVideo src={clip.url} fadeInFrames={overlap} />
        </Sequence>
      ))}

      {music?.url && (
        <Audio
          src={music.url}
          startFrom={musicStartFrom}
          endAt={musicEndAt}
          loop={music.loop ?? true}
          volume={volume}
        />
      )}
    </AbsoluteFill>
  );
};
