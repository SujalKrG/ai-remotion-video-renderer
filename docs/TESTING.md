# Testing

Jest, run in ESM mode (`node --experimental-vm-modules`) since the project is `"type": "module"`. `jest.config.js` + `ts-jest` handle the TypeScript/ESM interop.

```bash
npm test          # run once
npm run test:watch
```

All 5 suites live in `src/tests/`. As of this writing: **45 passing, 2 skipped** (skipped tests require an actual Remotion render and are meant for manual/integration runs, not CI).

| File | Covers |
|---|---|
| `validation.test.ts` | Zod schemas in `schemas/validation.ts` — video frame, slot, timeline item, music (including the `end_seconds > start_seconds` refinement), full static-slot and final-merge request shapes, and default values (`duration_seconds`, `fps`) |
| `contracts.test.ts` | The wire contract's shape stays stable — e.g. `clip_url`/`final_video_url` appear at the response root, not nested |
| `lambda.test.ts` | `handler()` end-to-end for both render types against invalid input (missing `render_type`, missing required fields, empty timeline) and unknown `render_type`. The two skipped tests are the full success path (real render + callback delivery) |
| `staticSlot.test.ts` | `buildComponentRegistry()` — mapping a `frameRegistry`-shaped object to components by `displayName`/`name`, with edge cases (no component field, no name, empty registry, null input) — plus a guard test asserting importing `StaticSlot.tsx` does **not** trigger the video package's `registerRoot()` side effect (see `src/tests/__mocks__` for the `frameRegistry` mock) |
| `callbackDelivery.test.ts` | `deliverRenderCallback()` posts the expected payload shape to a callback URL |

## What's intentionally not covered

- `renderer.ts`'s actual `renderMedia`/`renderStill` calls — these require a real Chrome + Remotion bundle and are exercised via the skipped integration tests and manual Docker/local runs, not unit tests.
- `s3Storage.ts`/`thumbnailStorage.ts`'s retry logic against a real S3 endpoint — the retry helper's branching (retryable vs. non-retryable error codes) is straightforward enough that it hasn't been given dedicated unit tests; if this logic changes, add tests alongside the change.
- The webpack override in `renderer.ts`'s `getBundleLocation()` — implicitly covered by any successful build/render, not directly unit-tested.

## Adding tests

Match the existing pattern: one `describe` per schema/function, `it` blocks for both the valid case and each rejection reason. `src/tests/__mocks__` holds the `frameRegistry` mock used by `staticSlot.test.ts` — extend it there if a new frame type needs coverage.
