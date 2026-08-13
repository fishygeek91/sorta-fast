import { describe, expect, it } from "vitest";

import {
  createCanvasRecorder,
  exportKindFromMime,
  pickRecorderMimeType,
  RECORDER_MIME_CANDIDATES,
  type MediaRecorderLike,
  wrapMediaRecorder,
} from "../src/ui/exportRecorder.ts";

describe("issue #18 export recorder", () => {
  describe("pickRecorderMimeType", () => {
    it("returns first supported candidate", () => {
      const supported = new Set(["video/webm;codecs=vp8", "video/webm", "video/mp4"]);
      const mime = pickRecorderMimeType((type) => supported.has(type));
      expect(mime).toBe("video/webm;codecs=vp8");
    });

    it("returns null when none supported", () => {
      expect(pickRecorderMimeType(() => false)).toBeNull();
    });
  });

  describe("exportKindFromMime", () => {
    it("maps mp4 MIME to mp4", () => {
      expect(exportKindFromMime("video/mp4")).toBe("mp4");
    });

    it("maps webm MIME to webm", () => {
      expect(exportKindFromMime("video/webm;codecs=vp8")).toBe("webm");
    });
  });

  describe("createCanvasRecorder", () => {
    type FakeRecorderOptions = {
      chunkBytes?: Uint8Array;
      emptyChunk?: boolean;
      error?: Error;
    };

    function createFakeRecorderFactory(
      options: FakeRecorderOptions = {},
    ): (mimeType: string) => MediaRecorderLike {
      const chunkBytes = options.chunkBytes ?? new Uint8Array([1, 2, 3, 4]);
      return (mimeType: string) => {
        let timesliceMs: number | undefined;
        const recorder: MediaRecorderLike = {
          ondataavailable: null,
          onstop: null,
          onerror: null,
          start(ms?: number): void {
            timesliceMs = ms;
          },
          stop(): void {
            queueMicrotask(() => {
              if (options.error !== undefined) {
                recorder.onerror?.({ error: options.error });
                return;
              }
              const data = options.emptyChunk
                ? new Blob([], { type: mimeType })
                : new Blob([chunkBytes], { type: mimeType });
              recorder.ondataavailable?.({ data });
              recorder.onstop?.();
            });
          },
        };
        void timesliceMs;
        return recorder;
      };
    }

    it("start+stop concatenates chunks into a blob of the given mimeType", async () => {
      const mimeType = RECORDER_MIME_CANDIDATES[1];
      const recorder = createCanvasRecorder({
        mimeType,
        timesliceMs: 50,
        createRecorder: createFakeRecorderFactory(),
      });

      recorder.start();
      const blob = await recorder.stop();

      expect(blob.type).toBe(mimeType);
      expect(blob.size).toBeGreaterThan(0);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      expect(bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
    });

    it("rejects when stop completes with only empty chunks", async () => {
      const recorder = createCanvasRecorder({
        mimeType: "video/webm",
        createRecorder: createFakeRecorderFactory({ emptyChunk: true }),
      });

      recorder.start();
      await expect(recorder.stop()).rejects.toThrow(/no data/);
    });

    it("rejects when onerror fires", async () => {
      const boom = new Error("encoder failed");
      const recorder = createCanvasRecorder({
        mimeType: "video/webm",
        createRecorder: createFakeRecorderFactory({ error: boom }),
      });

      recorder.start();
      await expect(recorder.stop()).rejects.toThrow("encoder failed");
    });

    it("throws when start is called twice before stop", () => {
      const recorder = createCanvasRecorder({
        mimeType: "video/webm",
        createRecorder: createFakeRecorderFactory(),
      });

      recorder.start();
      expect(() => recorder.start()).toThrow(/already started/);
    });

    it("throws when stop is called before start", () => {
      const recorder = createCanvasRecorder({
        mimeType: "video/webm",
        createRecorder: createFakeRecorderFactory(),
      });

      expect(() => recorder.stop()).toThrow(/not started/);
    });
  });

  describe("wrapMediaRecorder", () => {
    class StubRecorder {
      ondataavailable: ((ev: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;

      start(): void {}

      stop(): void {
        this.ondataavailable?.({ data: new Blob([new Uint8Array([9])]) });
        this.onstop?.();
      }
    }

    it("bridges stub recorder events into createCanvasRecorder", async () => {
      const stub = new StubRecorder();
      const recorder = createCanvasRecorder({
        mimeType: "video/webm",
        createRecorder: () => wrapMediaRecorder(stub),
      });

      recorder.start();
      const blob = await recorder.stop();

      expect(blob.type).toBe("video/webm");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      expect(bytes).toEqual(new Uint8Array([9]));
    });

    it("maps native onerror to like.onerror with Error or fallback message", async () => {
      class ErrorStubRecorder extends StubRecorder {
        override stop(): void {
          const domError = new Error("codec blew up");
          const ev = new Event("error");
          Object.defineProperty(ev, "error", { value: domError });
          this.onerror?.(ev);
        }
      }

      const stub = new ErrorStubRecorder();
      const recorder = createCanvasRecorder({
        mimeType: "video/webm",
        createRecorder: () => wrapMediaRecorder(stub),
      });

      recorder.start();
      await expect(recorder.stop()).rejects.toThrow("codec blew up");
    });
  });
});
