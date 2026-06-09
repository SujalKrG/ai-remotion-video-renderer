import { describe, it, expect } from "@jest/globals";
import {
  StaticSlotRequestSchema,
  FinalMergeRequestSchema,
  VideoFrameSchema,
  TimelineItemSchema,
} from "../schemas/validation.js";

describe("VideoFrameSchema", () => {
  it("validates a valid video frame", () => {
    const validFrame = {
      id: 1,
      component_name: "F21022026_01",
      config: {},
      variables: { firstName: "John", secondName: "Doe" },
    };
    
    const result = VideoFrameSchema.safeParse(validFrame);
    expect(result.success).toBe(true);
  });

  it("rejects empty component_name", () => {
    const invalidFrame = {
      id: 1,
      component_name: "",
      config: {},
      variables: {},
    };
    
    const result = VideoFrameSchema.safeParse(invalidFrame);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toContain("cannot be empty");
    }
  });

  it("rejects missing component_name", () => {
    const invalidFrame = {
      id: 1,
      config: {},
      variables: {},
    };
    
    const result = VideoFrameSchema.safeParse(invalidFrame);
    expect(result.success).toBe(false);
  });
});

describe("StaticSlotRequestSchema", () => {
  it("validates a complete valid request", () => {
    const validRequest = {
      render_type: "static_slot",
      order_uuid: "order-123",
      slot: {
        slot_no: 1,
        purpose: "intro",
        duration_seconds: 5,
        video_frame: {
          id: 1,
          component_name: "F21022026_01",
          config: {},
          variables: { firstName: "John", secondName: "Doe" },
        },
      },
    };
    
    const result = StaticSlotRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
  });

  it("rejects missing order_uuid", () => {
    const invalidRequest = {
      render_type: "static_slot",
      order_uuid: "",
      slot: {
        slot_no: 1,
        video_frame: {
          id: 1,
          component_name: "F21022026_01",
          config: {},
          variables: {},
        },
      },
    };
    
    const result = StaticSlotRequestSchema.safeParse(invalidRequest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors.some(e => e.path.includes("order_uuid"))).toBe(true);
    }
  });

  it("rejects negative slot_no", () => {
    const invalidRequest = {
      render_type: "static_slot",
      order_uuid: "order-123",
      slot: {
        slot_no: -1,
        video_frame: {
          id: 1,
          component_name: "F21022026_01",
          config: {},
          variables: {},
        },
      },
    };
    
    const result = StaticSlotRequestSchema.safeParse(invalidRequest);
    expect(result.success).toBe(false);
  });

  it("sets default duration_seconds to 4", () => {
    const request = {
      render_type: "static_slot",
      order_uuid: "order-123",
      slot: {
        slot_no: 1,
        video_frame: {
          id: 1,
          component_name: "F21022026_01",
          config: {},
          variables: {},
        },
      },
    };
    
    const result = StaticSlotRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slot.duration_seconds).toBe(4);
    }
  });
});

describe("TimelineItemSchema", () => {
  it("validates a valid timeline item", () => {
    const validItem = {
      slot_no: 1,
      slot_type: "static",
      clip_url: "https://s3.amazonaws.com/bucket/clip.mp4",
      duration_seconds: 5,
    };
    
    const result = TimelineItemSchema.safeParse(validItem);
    expect(result.success).toBe(true);
  });

  it("rejects invalid clip_url", () => {
    const invalidItem = {
      slot_no: 1,
      slot_type: "static",
      clip_url: "not-a-url",
      duration_seconds: 5,
    };
    
    const result = TimelineItemSchema.safeParse(invalidItem);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toContain("valid URL");
    }
  });

  it("rejects empty clip_url", () => {
    const invalidItem = {
      slot_no: 1,
      slot_type: "static",
      clip_url: "",
      duration_seconds: 5,
    };
    
    const result = TimelineItemSchema.safeParse(invalidItem);
    expect(result.success).toBe(false);
  });
});

describe("FinalMergeRequestSchema", () => {
  it("validates a complete valid request", () => {
    const validRequest = {
      render_type: "final_merge",
      order_uuid: "order-123",
      render_plan: {
        version: 1,
        fps: 30,
        timeline: [
          {
            slot_no: 1,
            slot_type: "static",
            clip_url: "https://s3.amazonaws.com/bucket/clip1.mp4",
            duration_seconds: 5,
          },
          {
            slot_no: 2,
            slot_type: "ai",
            clip_url: "https://s3.amazonaws.com/bucket/clip2.mp4",
            duration_seconds: 6,
          },
        ],
      },
    };
    
    const result = FinalMergeRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
  });

  it("rejects empty timeline", () => {
    const invalidRequest = {
      render_type: "final_merge",
      order_uuid: "order-123",
      render_plan: {
        version: 1,
        fps: 30,
        timeline: [],
      },
    };
    
    const result = FinalMergeRequestSchema.safeParse(invalidRequest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toContain("at least one item");
    }
  });

  it("rejects timeline with invalid clip URLs", () => {
    const invalidRequest = {
      render_type: "final_merge",
      order_uuid: "order-123",
      render_plan: {
        version: 1,
        fps: 30,
        timeline: [
          {
            slot_no: 1,
            slot_type: "static",
            clip_url: "not-a-url",
            duration_seconds: 5,
          },
        ],
      },
    };
    
    const result = FinalMergeRequestSchema.safeParse(invalidRequest);
    expect(result.success).toBe(false);
  });

  it("validates music URL if present", () => {
    const requestWithMusic = {
      render_type: "final_merge",
      order_uuid: "order-123",
      render_plan: {
        version: 1,
        fps: 30,
        music: {
          url: "https://s3.amazonaws.com/bucket/music.mp3",
          duration_seconds: 30,
        },
        timeline: [
          {
            slot_no: 1,
            slot_type: "static",
            clip_url: "https://s3.amazonaws.com/bucket/clip1.mp4",
            duration_seconds: 5,
          },
        ],
      },
    };
    
    const result = FinalMergeRequestSchema.safeParse(requestWithMusic);
    expect(result.success).toBe(true);
  });

  it("validates full music render contract if present", () => {
    const requestWithMusic = {
      render_type: "final_merge",
      order_uuid: "order-123",
      render_plan: {
        version: 1,
        fps: 30,
        music: {
          music_library_id: 77,
          source: "music_library",
          url: "https://s3.amazonaws.com/bucket/music.mp3",
          duration_seconds: 180,
          start_seconds: 12,
          end_seconds: 47,
          volume: 0.4,
          fade_in_seconds: 1,
          fade_out_seconds: 2,
          loop: true,
        },
        timeline: [
          {
            slot_no: 1,
            slot_type: "static",
            clip_url: "https://s3.amazonaws.com/bucket/clip1.mp4",
            duration_seconds: 5,
          },
        ],
      },
    };

    const result = FinalMergeRequestSchema.safeParse(requestWithMusic);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.render_plan.music?.end_seconds).toBe(47);
      expect(result.data.render_plan.music?.loop).toBe(true);
    }
  });

  it("accepts custom-upload music with null library id", () => {
    const requestWithMusic = {
      render_type: "final_merge",
      order_uuid: "order-123",
      render_plan: {
        version: 1,
        fps: 30,
        music: {
          music_library_id: null,
          source: "custom_upload",
          url: "https://s3.amazonaws.com/bucket/custom.mp3",
          duration_seconds: 120,
          start_seconds: 0,
          end_seconds: null,
          volume: 0.4,
          fade_in_seconds: 1,
          fade_out_seconds: 2,
          loop: true,
        },
        timeline: [
          {
            slot_no: 1,
            slot_type: "static",
            clip_url: "https://s3.amazonaws.com/bucket/clip1.mp4",
            duration_seconds: 5,
          },
        ],
      },
    };

    const result = FinalMergeRequestSchema.safeParse(requestWithMusic);
    expect(result.success).toBe(true);
  });

  it("rejects music trim window when end is before start", () => {
    const invalidRequest = {
      render_type: "final_merge",
      order_uuid: "order-123",
      render_plan: {
        version: 1,
        fps: 30,
        music: {
          url: "https://s3.amazonaws.com/bucket/music.mp3",
          start_seconds: 12,
          end_seconds: 10,
        },
        timeline: [
          {
            slot_no: 1,
            slot_type: "static",
            clip_url: "https://s3.amazonaws.com/bucket/clip1.mp4",
            duration_seconds: 5,
          },
        ],
      },
    };

    const result = FinalMergeRequestSchema.safeParse(invalidRequest);
    expect(result.success).toBe(false);
  });

  it("rejects invalid music URL", () => {
    const invalidRequest = {
      render_type: "final_merge",
      order_uuid: "order-123",
      render_plan: {
        version: 1,
        fps: 30,
        music: {
          url: "not-a-url",
        },
        timeline: [
          {
            slot_no: 1,
            slot_type: "static",
            clip_url: "https://s3.amazonaws.com/bucket/clip1.mp4",
            duration_seconds: 5,
          },
        ],
      },
    };
    
    const result = FinalMergeRequestSchema.safeParse(invalidRequest);
    expect(result.success).toBe(false);
  });

  it("sets default fps to 30", () => {
    const request = {
      render_type: "final_merge",
      order_uuid: "order-123",
      render_plan: {
        version: 1,
        timeline: [
          {
            slot_no: 1,
            slot_type: "static",
            clip_url: "https://s3.amazonaws.com/bucket/clip1.mp4",
            duration_seconds: 5,
          },
        ],
      },
    };
    
    const result = FinalMergeRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.render_plan.fps).toBe(30);
    }
  });
});
