import React from "react";
import { AbsoluteFill } from "remotion";
// @ts-ignore — ESM package, uses exportsFields: [] override in webpack
import { frameRegistry } from "@evatrilvideo/ai-video-package";

export interface StaticSlotProps {
  component_name: string;
  config: Record<string, unknown>;
  variables: Record<string, unknown>;
  duration_seconds: number;
  purpose?: string;
  fps?: number;
}

// Build a name→component lookup from the registry at module load time
const componentByName: Record<string, React.ComponentType<any>> = {};
if (frameRegistry && typeof frameRegistry === "object") {
  for (const entry of Object.values(frameRegistry) as any[]) {
    if (entry?.component) {
      const name: string | undefined =
        entry.component.displayName || entry.component.name;
      if (name) componentByName[name] = entry.component;
    }
  }
}

export const StaticSlot: React.FC<StaticSlotProps> = ({
  component_name,
  config: frameConfig,
  variables,
  duration_seconds,
  purpose,
}) => {
  const FrameComponent = componentByName[component_name];

  if (!FrameComponent) {
    // Fallback: black frame with centered label — never fails the render
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
