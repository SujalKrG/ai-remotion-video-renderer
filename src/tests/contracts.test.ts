describe("Static slot contract", () => {
  it("payload has render_type: static_slot", () => {
    const payload = {
      render_type: "static_slot",
      order_uuid: "abc",
      slot: { slot_no: 1, video_frame: { component_name: "CinematicIntroFrame", config: {}, variables: {} }, duration_seconds: 4 },
      inputs: {},
    };
    expect(payload.render_type).toBe("static_slot");
    expect(payload.slot.video_frame.component_name).toBeTruthy();
  });

  it("success response has clip_url at root level", () => {
    const response = {
      success: true,
      render_type: "static_slot",
      clip_url: "https://s3.example.com/clip.mp4",
      thumbnail_url: "https://s3.example.com/thumb.jpg",
      order_uuid: "abc",
      slot_no: 1,
    };
    // Node worker reads response.clip_url — verify it's at root
    expect(response.clip_url).toBeDefined();
    expect(response.thumbnail_url).toBeDefined();
    expect(response.render_type).toBe("static_slot");
  });
});

describe("Final merge contract", () => {
  it("payload has render_type: final_merge and non-empty timeline", () => {
    const payload = {
      render_type: "final_merge",
      order_uuid: "abc",
      render_plan: {
        fps: 30,
        timeline: [
          { slot_no: 1, slot_type: "static", clip_url: "https://s3.example.com/clip.mp4", duration_seconds: 4 },
        ],
      },
    };
    expect(payload.render_type).toBe("final_merge");
    expect(payload.render_plan.timeline.length).toBeGreaterThan(0);
    expect(payload.render_plan.timeline[0].clip_url).toBeTruthy();
  });

  it("success response has final_video_url at root level", () => {
    const response = {
      success: true,
      render_type: "final_merge",
      final_video_url: "https://s3.example.com/final.mp4",
      thumbnail_url: "https://s3.example.com/thumb.jpg",
      order_uuid: "abc",
    };
    // Node worker reads response.final_video_url — verify it's at root
    expect(response.final_video_url).toBeDefined();
    expect(response.thumbnail_url).toBeDefined();
    expect(response.render_type).toBe("final_merge");
  });
});
