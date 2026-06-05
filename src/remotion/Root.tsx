import React from "react";
import { Composition } from "remotion";
// @ts-ignore — ESM package, no type declarations
import { RemotionRoot as PackageRoot } from "@evatrilvideo/ai-video-package";
// @ts-ignore — registers Great Vibes, Dancing Script, Playfair Display from S3
import "@evatrilvideo/ai-video-package/src/fonts";
import { MergeComposition, type MergeCompositionProps } from "../compositions/MergeComposition.js";
import { StaticSlot, type StaticSlotProps } from "../compositions/StaticSlot.js";

export const RemotionRoot: React.FC = () => (
  <>
    {/* Registers the Video composition from @evatrilvideo/ai-video-package */}
    <PackageRoot />

    {/* Merge composition — stitches pre-rendered slot clips + AI videos with optional music */}
    <Composition
      id="MergeComposition"
      component={MergeComposition as any}
      durationInFrames={1}    // overridden at render time with sum of clip durations
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ clips: [], music: undefined }}
    />

    {/* Static slot — renders a single invitation frame component by name */}
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
