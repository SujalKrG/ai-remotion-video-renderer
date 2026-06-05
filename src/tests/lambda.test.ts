import { jest } from "@jest/globals";

// Set required env vars before any modules load
process.env.AWS_BUCKET = "test-bucket";
process.env.AWS_REGION = "us-east-1";

// Mock all heavy deps before importing the handler
jest.mock("../renderer.js", () => ({
  renderVideo: () => Promise.resolve("/tmp/output.mp4"),
  renderThumbnail: () => Promise.resolve("/tmp/output.jpg"),
}));

jest.mock("../utils/s3Storage.js", () => ({
  uploadToS3: () => Promise.resolve(),
  buildVideoUrl: () => Promise.resolve("https://s3.example.com/video.mp4"),
}));

jest.mock("../utils/thumbnailStorage.js", () => ({
  uploadThumbnailToS3: () => Promise.resolve(),
  buildThumbnailUrl: () => Promise.resolve("https://s3.example.com/thumb.jpg"),
}));

// Also mock fs so cleanup doesn't fail in tests
jest.mock("fs", () => ({
  ...(jest.requireActual("fs") as any),
  existsSync: jest.fn().mockReturnValue(false),
  mkdirSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

import { handler } from "../lambda.js";

describe("handler — static_slot", () => {
  const validStaticPayload = {
    render_type: "static_slot",
    order_uuid: "order-abc",
    slot: {
      slot_no: 1,
      purpose: "cinematic_intro",
      duration_seconds: 4,
      video_frame: {
        id: 5,
        component_name: "CinematicIntroFrame",
        config: {},
        variables: {},
      },
    },
    inputs: {},
  };

  it.skip("returns success shape and delivers callback with clip_url and thumbnail_url", async () => {
    const payload = {
      ...validStaticPayload,
      output: { callback_url: "https://backend.example.com/render-callback" },
    };

    const result = await handler(payload as any);
    expect(result.success).toBe(true);
    expect(result.render_type).toBe("static_slot");
    expect((result as any).clip_url).toBe("https://s3.example.com/video.mp4");
    expect((result as any).thumbnail_url).toBe("https://s3.example.com/thumb.jpg");
    expect((result as any).order_uuid).toBe("order-abc");
    expect((result as any).slot_no).toBe(1);
  }, 30000);

  it("returns failure when render_type is missing", async () => {
    const result = await handler({ order_uuid: "x", slot: { slot_no: 1 } } as any);
    expect(result.success).toBe(false);
    expect((result as any).error).toBeTruthy();
  });

  it("returns failure when slot.video_frame.component_name is missing", async () => {
    const bad = { ...validStaticPayload, slot: { ...validStaticPayload.slot, video_frame: { id: 1, config: {}, variables: {} } } };
    const result = await handler(bad as any);
    expect(result.success).toBe(false);
    expect((result as any).render_type).toBe("static_slot");
  });

  it("returns failure when order_uuid is missing", async () => {
    const bad = { render_type: "static_slot", slot: { slot_no: 1, video_frame: { component_name: "X" } } };
    const result = await handler(bad as any);
    expect(result.success).toBe(false);
  });
});

describe("handler — final_merge", () => {
  const validMergePayload = {
    render_type: "final_merge",
    order_uuid: "order-abc",
    render_plan: {
      version: 1,
      fps: 30,
      music: { url: "https://s3.example.com/music.mp3", duration_seconds: 38 },
      timeline: [
        { slot_no: 1, slot_type: "static", clip_url: "https://s3.example.com/clip1.mp4", duration_seconds: 4 },
        { slot_no: 2, slot_type: "ai",     clip_url: "https://s3.example.com/clip2.mp4", duration_seconds: 6 },
      ],
    },
  };

  it.skip("returns success shape and delivers callback with final_video_url and thumbnail_url", async () => {
    const payload = {
      ...validMergePayload,
      output: { callback_url: "https://backend.example.com/render-callback" },
    };

    const result = await handler(payload as any);
    expect(result.success).toBe(true);
    expect(result.render_type).toBe("final_merge");
    expect((result as any).final_video_url).toBe("https://s3.example.com/video.mp4");
    expect((result as any).thumbnail_url).toBe("https://s3.example.com/thumb.jpg");
    expect((result as any).order_uuid).toBe("order-abc");
  }, 30000);

  it("returns failure when timeline is empty", async () => {
    const bad = { ...validMergePayload, render_plan: { ...validMergePayload.render_plan, timeline: [] } };
    const result = await handler(bad as any);
    expect(result.success).toBe(false);
    expect((result as any).render_type).toBe("final_merge");
  });

  it("returns failure when timeline item is missing clip_url", async () => {
    const bad = {
      ...validMergePayload,
      render_plan: {
        ...validMergePayload.render_plan,
        timeline: [{ slot_no: 1, slot_type: "static", duration_seconds: 4 }],
      },
    };
    const result = await handler(bad as any);
    expect(result.success).toBe(false);
  });

  it("returns failure when order_uuid is missing", async () => {
    const bad = { render_type: "final_merge", render_plan: { timeline: [{ slot_no: 1, clip_url: "x" }] } };
    const result = await handler(bad as any);
    expect(result.success).toBe(false);
  });
});

describe("handler — invalid render_type", () => {
  it("returns failure for unknown render_type", async () => {
    const result = await handler({ render_type: "unknown_type", order_uuid: "x" } as any);
    expect(result.success).toBe(false);
    expect((result as any).error).toMatch(/render_type/i);
  });
});
