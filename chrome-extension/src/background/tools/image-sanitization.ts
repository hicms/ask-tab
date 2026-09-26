/**
 * Image sanitization utility for tool results.
 * Resizes and compresses images using OffscreenCanvas (available in service workers).
 */

/** Default max dimension per side (pixels) */
const DEFAULT_MAX_DIMENSION = 1200;

/** Max bytes for the output image (base64 length) */
const MAX_BASE64_BYTES = 5 * 1024 * 1024;

/** Max input base64 length (~20MB decoded) to prevent OOM in the service worker */
const MAX_IMAGE_INPUT_SIZE = 20 * 1024 * 1024;

/** JPEG quality for compression */
const JPEG_QUALITY = 0.8;

/** Reduced JPEG quality if output still exceeds MAX_BASE64_BYTES */
const REDUCED_JPEG_QUALITY = 0.5;

interface SanitizedImage {
  base64: string;
  mimeType: string;
  width: number;
  height: number;
}

/**
 * Convert a Blob to a base64 string.
 * Uses chunked conversion to avoid stack overflow on large images.
 */
const blobToBase64 = async (blob: Blob): Promise<string> => {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 1024) {
    const slice = bytes.subarray(i, i + 1024);
    let s = '';
    for (let j = 0; j < slice.length; j++) {
      s += String.fromCharCode(slice[j]!);
    }
    chunks.push(s);
  }
  return btoa(chunks.join(''));
};

/**
 * Decode a base64 string to a Blob.
 */
const base64ToBlob = (base64: string, mimeType: string): Blob => {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
};

/**
 * Resize and compress a base64-encoded image.
 * - Caps dimensions at maxDimension per side (maintains aspect ratio)
 * - Converts to JPEG for compression
 * - Falls back to lower quality if output exceeds MAX_BASE64_BYTES
 */
const sanitizeImage = async (
  base64: string,
  mimeType: string,
  maxDimension = DEFAULT_MAX_DIMENSION,
): Promise<SanitizedImage | null> => {
  if (base64.length > MAX_IMAGE_INPUT_SIZE) return null;

  const blob = base64ToBlob(base64, mimeType);
  const bitmap = await createImageBitmap(blob);
  const { width: origWidth, height: origHeight } = bitmap;

  // Calculate target dimensions (maintain aspect ratio, cap at maxDimension)
  let targetWidth = origWidth;
  let targetHeight = origHeight;
  if (origWidth > maxDimension || origHeight > maxDimension) {
    const scale = Math.min(maxDimension / origWidth, maxDimension / origHeight);
    targetWidth = Math.round(origWidth * scale);
    targetHeight = Math.round(origHeight * scale);
  }

  // Draw to OffscreenCanvas
  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();

  // Export as JPEG
  let outputBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  let outputBase64 = await blobToBase64(outputBlob);

  // If still too large, reduce quality
  if (outputBase64.length > MAX_BASE64_BYTES) {
    outputBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: REDUCED_JPEG_QUALITY });
    outputBase64 = await blobToBase64(outputBlob);
  }

  return {
    base64: outputBase64,
    mimeType: 'image/jpeg',
    width: targetWidth,
    height: targetHeight,
  };
};

export {
  sanitizeImage,
  blobToBase64,
  base64ToBlob,
  DEFAULT_MAX_DIMENSION,
  MAX_IMAGE_INPUT_SIZE,
  MAX_BASE64_BYTES,
  JPEG_QUALITY,
};
export type { SanitizedImage };
