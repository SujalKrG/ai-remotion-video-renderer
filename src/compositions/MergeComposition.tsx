import React from "react";
import { AbsoluteFill, OffthreadVideo, Audio, Sequence } from "remotion";

export interface MergeClip {
  url: string;
  durationInFrames: number;
}

export interface MergeCompositionProps {
  clips: MergeClip[];
  music?: {
    url: string;
    volume?: number;
  };
}

export const MergeComposition: React.FC<MergeCompositionProps> = ({
  clips = [],
  music,
}) => {
  let startFrame = 0;

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
        <Audio src={music.url} volume={music.volume ?? 0.5} />
      )}
    </AbsoluteFill>
  );
};
