/**
 * Browser download trigger and photo-finish PNG export orchestration (issue #18).
 *
 * DOM access is isolated behind {@link DownloadEnv} so headless tests can inject
 * fakes without jsdom.
 */

/** Minimal anchor surface used to trigger a file download. */
export type DownloadAnchor = { href: string; download: string; click(): void };

/** Injectable browser ports for {@link triggerDownload}. */
export type DownloadEnv = {
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  createAnchor: () => DownloadAnchor;
};

/**
 * Resolve the default browser download environment.
 *
 * @throws When `URL.createObjectURL` or `document` is unavailable.
 */
function defaultDownloadEnv(): DownloadEnv {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("URL.createObjectURL is unavailable");
  }
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    throw new Error("document is unavailable");
  }

  return {
    createObjectURL: (blob: Blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url: string) => {
      URL.revokeObjectURL(url);
    },
    createAnchor: () => {
      const el = document.createElement("a");
      return {
        get href() {
          return el.href;
        },
        set href(value: string) {
          el.href = value;
        },
        get download() {
          return el.download;
        },
        set download(value: string) {
          el.download = value;
        },
        click: () => {
          el.click();
        },
      };
    },
  };
}

/**
 * Trigger a one-shot file download for `blob` using a temporary object URL.
 *
 * @param blob - Payload to download.
 * @param filename - Suggested filename (must be non-empty; extension optional).
 * @param env - Optional injectable DOM ports (defaults to global `URL` + `document`).
 * @throws When `filename` is empty or required browser APIs are missing.
 */
export function triggerDownload(blob: Blob, filename: string, env?: DownloadEnv): void {
  if (filename.length === 0) {
    throw new Error("filename must be non-empty");
  }

  const ports = env ?? defaultDownloadEnv();
  const url = ports.createObjectURL(blob);
  const anchor = ports.createAnchor();
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  ports.revokeObjectURL(url);
}

/**
 * Capture a PNG from a canvas via {@link HTMLCanvasElement.toBlob}.
 *
 * @param canvas - Source canvas element.
 * @returns PNG blob from the browser encoder.
 * @throws When `toBlob` yields a null blob.
 */
export function captureCanvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error("canvas.toBlob returned null"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

/**
 * Orchestrate photo-finish export: capture PNG, validate, then download.
 *
 * @param options.filename - Target download name (non-empty).
 * @param options.capturePng - Async PNG capture (typically sheet render + canvas).
 * @param options.download - Invoked with the captured blob and filename.
 * @throws When `filename` is empty or the captured blob has size zero.
 */
export async function exportPhotoFinish(options: {
  filename: string;
  capturePng: () => Promise<Blob>;
  download: (blob: Blob, filename: string) => void;
}): Promise<void> {
  const { filename, capturePng, download } = options;

  if (filename.length === 0) {
    throw new Error("filename must be non-empty");
  }

  const blob = await capturePng();
  if (blob.size === 0) {
    throw new Error("captured PNG blob is empty");
  }

  download(blob, filename);
}

/**
 * Run {@link exportPhotoFinish} only when the export sheet painted successfully.
 *
 * @param painted - False when sheet layout/draw failed (caller already showed status).
 * @param options - Same options as {@link exportPhotoFinish}.
 */
export async function exportPhotoFinishWhenPainted(
  painted: boolean,
  options: {
    filename: string;
    capturePng: () => Promise<Blob>;
    download: (blob: Blob, filename: string) => void;
  },
): Promise<void> {
  if (!painted) {
    return;
  }
  await exportPhotoFinish(options);
}
