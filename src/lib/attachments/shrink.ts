/*
 * Images are made smaller as they're added, so a repository kept in the browser doesn't fill
 * up with full-size photos: at most 2000 pixels on the long side, saved as WebP (JPEG where
 * the browser can't write WebP). The original isn't kept. Re-encoding also drops the photo's
 * hidden details (camera, place taken); a JPEG kept as it is has them stripped too.
 * GIFs (which may move), SVGs and anything the browser can't open are kept as they are.
 */

/** The longest side, in pixels, an added image is kept at. */
export const MAX_SIDE = 2000;
/** Smaller files are left as they are unless they're larger than MAX_SIDE. */
export const SMALL_BYTES = 200 * 1024;

const PHOTO_TYPES = new Set(["image/jpeg", "image/heic", "image/heif", "image/avif"]);
const LOSSLESS_TYPES = new Set(["image/png", "image/bmp", "image/webp", "image/tiff"]);

/** Whether an image of this type can be re-encoded (GIF and SVG never are). */
export const canShrink = (type: string) => PHOTO_TYPES.has(type) || LOSSLESS_TYPES.has(type);

/** WebP quality: photos can take more compression than screenshots and diagrams (sharp text). */
export const qualityFor = (type: string) => (PHOTO_TYPES.has(type) ? 0.82 : 0.9);

/** The size to draw an image at: within MAX_SIDE, keeping its proportions. */
export function fitWithin(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The file name with a new extension ("Photo.jpeg" → "Photo.webp"). */
export function withExtension(name: string, ext: string): string {
  const dot = name.lastIndexOf(".");
  return `${dot > 0 ? name.slice(0, dot) : name || "image"}.${ext}`;
}

/**
 * A JPEG without its metadata segments: APP1 (Exif, with the camera and GPS location, and
 * XMP) and APP13 (IPTC). The picture, its colour profile (APP2) and JFIF header are kept.
 * Bytes that aren't a well-formed JPEG come back unchanged.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const keep: Array<[number, number]> = [[0, 2]];
  let i = 2;
  let dropped = false;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return bytes;
    const marker = bytes[i + 1];
    // Start of scan: the rest is picture data.
    if (marker === 0xda) {
      keep.push([i, bytes.length]);
      i = bytes.length;
      break;
    }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    const end = i + 2 + length;
    if (length < 2 || end > bytes.length) return bytes;
    if (marker === 0xe1 || marker === 0xed) dropped = true;
    else keep.push([i, end]);
    i = end;
  }
  if (!dropped || i < bytes.length) return bytes;
  const out = new Uint8Array(keep.reduce((n, [a, b]) => n + b - a, 0));
  let at = 0;
  for (const [a, b] of keep) {
    out.set(bytes.subarray(a, b), at);
    at += b - a;
  }
  return out;
}

async function stripped(file: File): Promise<File> {
  if (file.type !== "image/jpeg") return file;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const clean = stripJpegMetadata(bytes);
  return clean === bytes ? file : new File([clean as BlobPart], file.name, { type: file.type, lastModified: file.lastModified });
}

async function encode(source: ImageBitmap, width: number, height: number, type: string, quality: number): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, width, height);
    return canvas.convertToBlob({ type, quality }).catch(() => null);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  return new Promise((done) => canvas.toBlob(done, type, quality));
}

/**
 * The image as it should be kept: smaller (and without hidden details) when that helps,
 * otherwise as it was. Never throws: anything unexpected keeps the file as it is.
 */
export async function shrinkImage(file: File): Promise<File> {
  if (!canShrink(file.type) || typeof createImageBitmap === "undefined") return stripped(file);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return stripped(file); // e.g. HEIC outside Safari
  }
  try {
    const size = fitWithin(bitmap.width, bitmap.height);
    if (file.size <= SMALL_BYTES && size.width === bitmap.width) return stripped(file);
    let blob = await encode(bitmap, size.width, size.height, "image/webp", qualityFor(file.type));
    // Browsers that can't write WebP hand back PNG: use JPEG for photos (no transparency to lose).
    if (blob && blob.type !== "image/webp" && PHOTO_TYPES.has(file.type)) {
      blob = await encode(bitmap, size.width, size.height, "image/jpeg", 0.85);
    }
    if (!blob || blob.size >= file.size) return stripped(file);
    const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/jpeg" ? "jpg" : "png";
    return new File([blob], withExtension(file.name, ext), { type: blob.type, lastModified: file.lastModified });
  } catch {
    return stripped(file);
  } finally {
    bitmap.close();
  }
}
