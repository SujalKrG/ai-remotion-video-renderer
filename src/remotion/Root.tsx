import React from "react";
import { Composition } from "remotion";
import { MergeComposition } from "../compositions/MergeComposition.js";
import { StaticSlot } from "../compositions/StaticSlot.js";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="MergeComposition"
      component={MergeComposition as any}
      durationInFrames={1}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ clips: [], music: undefined }}
    />
    <Composition
      id="StaticSlot"
      component={StaticSlot as any}
      durationInFrames={120}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ component_name: "", config: {}, variables: {}, duration_seconds: 4, purpose: "" }}
    />
  </>
);
