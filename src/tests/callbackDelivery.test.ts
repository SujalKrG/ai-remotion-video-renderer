import http from "http";
import { describe, expect, it } from "@jest/globals";
import { deliverRenderCallback } from "../callbacks/callbackDelivery.js";

const startServer = async (
  onRequest: (body: unknown, headers: http.IncomingHttpHeaders) => void,
): Promise<{ url: string; close: () => Promise<void> }> => {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      onRequest(body, req.headers);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to start callback test server");
  }

  return {
    url: `http://127.0.0.1:${address.port}/callback`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
};

describe("deliverRenderCallback", () => {
  it("posts render callback payloads", async () => {
    let receivedBody: unknown;
    let receivedHeaders: http.IncomingHttpHeaders = {};
    const server = await startServer((body, headers) => {
      receivedBody = body;
      receivedHeaders = headers;
    });

    try {
      await deliverRenderCallback(server.url, {
        correlation_id: "corr-1",
        idempotency_key: "idem-1",
        order_uuid: "order-abc",
        render_type: "static_slot",
        status: "completed",
        clip_url: "https://s3.example.com/video.mp4",
        thumbnail_url: "https://s3.example.com/thumb.jpg",
        timestamp: "2026-06-04T00:00:00.000Z",
      });

      expect(receivedHeaders["x-correlation-id"]).toBe("corr-1");
      expect(receivedBody).toEqual(
        expect.objectContaining({
          correlation_id: "corr-1",
          idempotency_key: "idem-1",
          order_uuid: "order-abc",
          render_type: "static_slot",
          status: "completed",
          clip_url: "https://s3.example.com/video.mp4",
          thumbnail_url: "https://s3.example.com/thumb.jpg",
        }),
      );
    } finally {
      await server.close();
    }
  });
});
