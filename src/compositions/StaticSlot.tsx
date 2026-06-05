import React, { useEffect, useState } from "react";
import { AbsoluteFill, delayRender, continueRender } from "remotion";
// @ts-ignore — direct subpath avoids remotionRoot.jsx which calls registerRoot as a side effect
import { frameRegistry } from "@evatrilvideo/ai-video-package/src/frameRegistry.js";
// @ts-ignore
import { registerFonts } from "@evatrilvideo/ai-video-package/src/fonts/registerFonts.js";

export interface StaticSlotProps {
  component_name: string;
  config: Record<string, unknown>;
  variables: Record<string, unknown>;
  duration_seconds: number;
  purpose?: string;
  fps?: number;
}

/** Builds a name→component map from a frameRegistry object. Exported for testing. */
export function buildComponentRegistry(
  registry: Record<string, any>,
): Record<string, React.ComponentType<any>> {
  const map: Record<string, React.ComponentType<any>> = {};
  if (!registry || typeof registry !== "object") return map;
  for (const entry of Object.values(registry) as any[]) {
    if (entry?.component) {
      const name: string | undefined = entry.component.displayName || entry.component.name;
      if (name) map[name] = entry.component;
    }
  }
  return map;
}

const componentByName = buildComponentRegistry(frameRegistry);

export const StaticSlot: React.FC<StaticSlotProps> = ({
  component_name,
  config: frameConfig,
  variables,
  duration_seconds,
  purpose,
}) => {
  const [fontHandle] = useState(() => delayRender("Loading fonts"));

  useEffect(() => {
    registerFonts().finally(() => continueRender(fontHandle));
  }, [fontHandle]);

  const FrameComponent = componentByName[component_name];

  if (!FrameComponent) {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: "#000",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ color: "#fff", fontSize: 32, fontFamily: "sans-serif" }}>
          {purpose || component_name}
        </span>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill>
      <FrameComponent
        {...frameConfig}
        {...variables}
        duration_seconds={duration_seconds}
        purpose={purpose}
      />
    </AbsoluteFill>
  );
};
