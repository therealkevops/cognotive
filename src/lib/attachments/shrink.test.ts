import { describe, expect, it } from "vitest";
import { MAX_SIDE, canShrink, fitWithin, qualityFor, shrinkImage, stripJpegMetadata, withExtension } from "./shrink";

/** A JPEG-shaped byte string: start, segments, start of scan, picture data, end. */
function jpeg(...segments: Array<[number, number[]]>): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  for (const [marker, payload] of segments) {
    const length = payload.length + 2;
    parts.push(0xff, marker, length >> 8, length & 0xff, ...payload);
  }
  parts.push(0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x11, 0x22, 0x33, 0xff, 0xd9);
  return new Uint8Array(parts);
}

describe("stripJpegMetadata", () => {
  it("drops Exif/XMP and IPTC, keeps the header, colour profile and picture", () => {
    const withExif = jpeg([0xe0, [1, 2]], [0xe1, [0x45, 0x78, 0x69, 0x66, 9, 9, 9]], [0xe2, [7]], [0xed, [5, 5]], [0xdb, [3]]);
    expect([...stripJpegMetadata(withExif)]).toEqual([...jpeg([0xe0, [1, 2]], [0xe2, [7]], [0xdb, [3]])]);
  });

  it("returns the same bytes when there's nothing to drop, or it isn't a JPEG", () => {
    const clean = jpeg([0xe0, [1]]);
    expect(stripJpegMetadata(clean)).toBe(clean);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(stripJpegMetadata(png)).toBe(png);
    const broken = jpeg([0xe1, [1, 2, 3]]).slice(0, 7);
    expect(stripJpegMetadata(broken)).toBe(broken);
  });
});

describe("shrink decisions", () => {
  it("fits within the longest side, keeping proportions", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: MAX_SIDE, height: 1500 });
    expect(fitWithin(1000, 3000)).toEqual({ width: 667, height: MAX_SIDE });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("re-encodes photos and screenshots, never GIFs or SVGs", () => {
    expect(["image/jpeg", "image/png", "image/webp", "image/heic"].every(canShrink)).toBe(true);
    expect(canShrink("image/gif")).toBe(false);
    expect(canShrink("image/svg+xml")).toBe(false);
    expect(qualityFor("image/jpeg")).toBeLessThan(qualityFor("image/png"));
  });

  it("renames to the new format", () => {
    expect(withExtension("IMG_1234.JPG", "webp")).toBe("IMG_1234.webp");
    expect(withExtension("Pasted image 2026.png", "webp")).toBe("Pasted image 2026.webp");
    expect(withExtension("", "webp")).toBe("image.webp");
  });

  it("keeps what it can't open, with a JPEG's hidden details taken out", async () => {
    // No image decoding in the test environment: the fallback path.
    const gif = new File([new Uint8Array([71, 73, 70])], "a.gif", { type: "image/gif" });
    expect(await shrinkImage(gif)).toBe(gif);
    const photo = new File([jpeg([0xe1, [1, 2, 3]]) as BlobPart], "p.jpg", { type: "image/jpeg" });
    const out = await shrinkImage(photo);
    expect(out.name).toBe("p.jpg");
    expect(new Uint8Array(await out.arrayBuffer())).toEqual(jpeg());
  });
});
