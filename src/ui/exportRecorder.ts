/**
 * MediaRecorder MIME selection and canvas recording helpers (issue #18).
 *
 * Chrome and Firefox typically produce WebM (vp9, then vp8, then generic
 * `video/webm`). Safari often yields `video/mp4`. When none of
 * {@link RECORDER_MIME_CANDIDATES} pass `MediaRecorder.isTypeSupported`, the
 * UI must keep PNG export working and show a status fallback. GIF export is
 * out of scope.
 */

/** MIME types tried in order when constructing a canvas {@link MediaRecorder}. */
export const RECORDER_MIME_CANDIDATES: readonly string[] = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4",
];

/**
 * Pick the first recorder MIME type supported by the host browser.
 *
 * @param isTypeSupported - Typically `MediaRecorder.isTypeSupported`.
 * @returns The first supported candidate, or `null` when video export is unavailable.
 */
export function pickRecorderMimeType(
  isTypeSupported: (mimeType: string) => boolean,
): string | null {
  for (const candidate of RECORDER_MIME_CANDIDATES) {
    if (isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Map a recorder MIME string to a video export kind (PNG is not produced here).
 *
 * @param mimeType - MIME type passed to {@link MediaRecorder} (e.g. `video/mp4`).
 */
export function exportKindFromMime(mimeType: string): "webm" | "mp4" {
  if (mimeType.includes("mp4")) {
    return "mp4";
  }
  return "webm";
}

/** Minimal {@link MediaRecorder} surface for headless tests and injection. */
export type MediaRecorderLike = {
  start(timesliceMs?: number): void;
  stop(): void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: { error?: Error }) => void) | null;
};

/**
 * Structural recorder surface used by {@link wrapMediaRecorder}.
 *
 * Browser {@link MediaRecorder} is not assigned here directly (its event
 * handler types are not a match). Use {@link createStreamRecorder} to bridge
 * a real `MediaRecorder` via `addEventListener`.
 */
export type NativeRecorder = {
  start(timesliceMs?: number): void;
  stop(): void;
  ondataavailable: ((ev: { data: Blob }) => void) | null;
  onstop: ((ev?: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
};

/**
 * Map a {@link NativeRecorder} (test stub or {@link createStreamRecorder} bridge)
 * onto {@link MediaRecorderLike}.
 *
 * Forwards `start` / `stop`. Native `ondataavailable`, `onstop`, and `onerror`
 * handlers delegate to the **current** callbacks on the returned like object so
 * {@link createCanvasRecorder} can assign handlers after wrapping.
 *
 * @param recorder - Browser recorder or structural stub with the same handlers.
 */
export function wrapMediaRecorder(recorder: NativeRecorder): MediaRecorderLike {
  const like: MediaRecorderLike = {
    ondataavailable: null,
    onstop: null,
    onerror: null,
    start(timesliceMs?: number): void {
      recorder.start(timesliceMs);
    },
    stop(): void {
      recorder.stop();
    },
  };

  recorder.ondataavailable = (ev: { data: Blob }) => {
    like.ondataavailable?.({ data: ev.data });
  };

  recorder.onstop = () => {
    like.onstop?.();
  };

  recorder.onerror = (ev: Event) => {
    const error = errorFromRecorderEvent(ev);
    like.onerror?.({ error });
  };

  return like;
}

/**
 * Construct a browser {@link MediaRecorder} on `stream` and wrap it as
 * {@link MediaRecorderLike}.
 *
 * Native events are forwarded onto a {@link NativeRecorder} bridge so
 * {@link wrapMediaRecorder} can extract `ev.error` from error events.
 *
 * @param stream - Canvas capture stream from {@link HTMLCanvasElement.captureStream}.
 * @param mimeType - Recorder MIME type from {@link pickRecorderMimeType}.
 */
export function createStreamRecorder(stream: MediaStream, mimeType: string): MediaRecorderLike {
  const native = new MediaRecorder(stream, { mimeType });
  const bridge: NativeRecorder = {
    start(timesliceMs?: number): void {
      if (timesliceMs === undefined) {
        native.start();
      } else {
        native.start(timesliceMs);
      }
    },
    stop(): void {
      native.stop();
    },
    ondataavailable: null,
    onstop: null,
    onerror: null,
  };

  native.addEventListener("dataavailable", (event: BlobEvent) => {
    const handler = bridge.ondataavailable;
    if (handler !== null) {
      handler({ data: event.data });
    }
  });
  native.addEventListener("stop", () => {
    const handler = bridge.onstop;
    if (handler !== null) {
      handler();
    }
  });
  native.addEventListener("error", (event: Event) => {
    const handler = bridge.onerror;
    if (handler !== null) {
      handler(event);
    }
  });

  return wrapMediaRecorder(bridge);
}

/** Prefer `ev.error` when the host exposes a real {@link Error}; else a generic message. */
function errorFromRecorderEvent(ev: Event): Error {
  if ("error" in ev) {
    const candidate = ev.error;
    if (candidate instanceof Error) {
      return candidate;
    }
  }
  return new Error("MediaRecorder error");
}

/**
 * Wrap an injected recorder factory for canvas capture export.
 *
 * @param options.mimeType - Blob MIME type for the assembled recording.
 * @param options.timesliceMs - Passed to {@link MediaRecorder.start}; default 100 ms.
 * @param options.createRecorder - Factory (avoids requiring {@link MediaStream} in Node tests).
 */
export function createCanvasRecorder(options: {
  mimeType: string;
  timesliceMs?: number;
  createRecorder: (mimeType: string) => MediaRecorderLike;
}): { start(): void; stop(): Promise<Blob> } {
  const { mimeType, createRecorder } = options;
  const timesliceMs = options.timesliceMs ?? 100;

  let recorder: MediaRecorderLike | null = null;
  const chunks: Blob[] = [];

  return {
    start(): void {
      if (recorder !== null) {
        throw new Error("Canvas recorder already started");
      }

      chunks.length = 0;
      const active = createRecorder(mimeType);
      recorder = active;

      active.ondataavailable = (event: { data: Blob }) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      active.start(timesliceMs);
    },

    stop(): Promise<Blob> {
      if (recorder === null) {
        throw new Error("Canvas recorder not started");
      }

      const active = recorder;

      return new Promise<Blob>((resolve, reject) => {
        active.onstop = () => {
          recorder = null;
          if (chunks.length === 0) {
            reject(new Error("MediaRecorder produced no data"));
            return;
          }
          const blob = new Blob(chunks, { type: mimeType });
          if (blob.size === 0) {
            reject(new Error("MediaRecorder produced empty blob"));
            return;
          }
          resolve(blob);
        };

        active.onerror = (event: { error?: Error }) => {
          recorder = null;
          reject(event.error ?? new Error("MediaRecorder error"));
        };

        active.stop();
      });
    },
  };
}
