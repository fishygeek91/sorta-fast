import { describe, expect, it, vi } from "vitest";

import {
  exportPhotoFinish,
  exportPhotoFinishWhenPainted,
  triggerDownload,
  type DownloadAnchor,
  type DownloadEnv,
} from "../src/ui/exportDownload.ts";

describe("issue #18 export download", () => {
  describe("triggerDownload", () => {
    it("uses injected env to create url, click anchor, and revoke", () => {
      const blob = new Blob(["png-bytes"], { type: "image/png" });
      const filename = "sorta-fast-maze-5000-seed-1729.png";
      const objectUrl = "blob:fake-url";

      let createObjectURLArg: Blob | undefined;
      let revokeObjectURLArg: string | undefined;
      let clickCount = 0;

      const anchor: DownloadAnchor = {
        href: "",
        download: "",
        click: () => {
          clickCount += 1;
        },
      };

      const env: DownloadEnv = {
        createObjectURL: (received) => {
          createObjectURLArg = received;
          return objectUrl;
        },
        revokeObjectURL: (url) => {
          revokeObjectURLArg = url;
        },
        createAnchor: () => anchor,
      };

      triggerDownload(blob, filename, env);

      expect(createObjectURLArg).toBe(blob);
      expect(anchor.href).toBe(objectUrl);
      expect(anchor.download).toBe(filename);
      expect(clickCount).toBe(1);
      expect(revokeObjectURLArg).toBe(objectUrl);
    });

    it("throws on empty filename", () => {
      const blob = new Blob(["x"], { type: "image/png" });
      const env: DownloadEnv = {
        createObjectURL: () => "blob:unused",
        revokeObjectURL: () => {},
        createAnchor: () => ({
          href: "",
          download: "",
          click: () => {},
        }),
      };

      expect(() => triggerDownload(blob, "", env)).toThrow(/filename must be non-empty/);
    });
  });

  describe("exportPhotoFinish", () => {
    it("captures png then downloads with blob and filename", async () => {
      const blob = new Blob(["png"], { type: "image/png" });
      const filename = "sorta-fast-maze-5000-seed-1729.png";
      const capturePng = vi.fn(async () => blob);
      const download = vi.fn();

      await exportPhotoFinish({ filename, capturePng, download });

      expect(capturePng).toHaveBeenCalledOnce();
      expect(download).toHaveBeenCalledOnce();
      expect(download).toHaveBeenCalledWith(blob, filename);
    });

    it("throws on empty filename", async () => {
      const capturePng = vi.fn(async () => new Blob(["png"], { type: "image/png" }));
      const download = vi.fn();

      await expect(
        exportPhotoFinish({
          filename: "",
          capturePng,
          download,
        }),
      ).rejects.toThrow(/filename must be non-empty/);

      expect(capturePng).not.toHaveBeenCalled();
      expect(download).not.toHaveBeenCalled();
    });

    it("throws when capture returns empty blob", async () => {
      const emptyBlob = new Blob([]);
      const capturePng = vi.fn(async () => emptyBlob);
      const download = vi.fn();

      await expect(
        exportPhotoFinish({
          filename: "sorta-fast-maze-5000-seed-1729.png",
          capturePng,
          download,
        }),
      ).rejects.toThrow(/captured PNG blob is empty/);

      expect(capturePng).toHaveBeenCalledOnce();
      expect(download).not.toHaveBeenCalled();
    });
  });

  describe("exportPhotoFinishWhenPainted", () => {
    it("skips capture and download when the sheet did not paint", async () => {
      const capturePng = vi.fn(async () => new Blob(["png"], { type: "image/png" }));
      const download = vi.fn();

      await exportPhotoFinishWhenPainted(false, {
        filename: "sorta-fast-maze-5000-seed-1729.png",
        capturePng,
        download,
      });

      expect(capturePng).not.toHaveBeenCalled();
      expect(download).not.toHaveBeenCalled();
    });

    it("exports when the sheet painted", async () => {
      const blob = new Blob(["png"], { type: "image/png" });
      const capturePng = vi.fn(async () => blob);
      const download = vi.fn();
      const filename = "sorta-fast-maze-5000-seed-1729.png";

      await exportPhotoFinishWhenPainted(true, {
        filename,
        capturePng,
        download,
      });

      expect(capturePng).toHaveBeenCalledOnce();
      expect(download).toHaveBeenCalledWith(blob, filename);
    });
  });
});
