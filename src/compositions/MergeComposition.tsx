import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  Audio,
  Sequence,
  interpolate,
  useVideoConfig,
} from "remotion";

export interface MergeClip {
  url: string;
  durationInFrames: number;
}

export interface MergeCompositionProps {
  clips: MergeClip[];
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

export const MergeComposition: React.FC<MergeCompositionProps> = ({
  clips = [],
  music,
}) => {
  let startFrame = 0;
  const { fps } = useVideoConfig();
  const durationInFrames = clips.reduce(
    (sum, clip) => sum + clip.durationInFrames,
    0,
  );
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
      {clips.map((clip, index) => {
        const from = startFrame;
        startFrame += clip.durationInFrames;
        return (
          <Sequence key={index} from={from} durationInFrames={clip.durationInFrames}>
            <AbsoluteFill>
              <OffthreadVideo
                src={clip.url}
                style={{ width: "100%", height: "100%" }}
              />
            </AbsoluteFill>
          </Sequence>
        );
      })}

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
