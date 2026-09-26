/**
 * Tests for image-sanitization.ts
 * Verifies image resize/compress via mocked OffscreenCanvas.
 */
import { sanitizeImage, blobToBase64, base64ToBlob } from './image-sanitization';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock globals ──────────────────────────────────────

const mockClose = vi.fn();
const mockDrawImage = vi.fn();
const mockConvertToBlob = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockConvertToBlob.mockResolvedValue(new Blob(['fake-jpeg-data'], { type: 'image/jpeg' }));
});

// Mock createImageBitmap — returns a fake bitmap with given dimensions
vi.stubGlobal(
  'createImageBitmap',
  vi.fn(async () => ({
    width: 1920,
    height: 1080,
    close: mockClose,
  })),
);

// Mock OffscreenCanvas — must be a class (used with `new`)
class MockOffscreenCanvas {
  getContext() {
    return { drawImage: mockDrawImage };
  }
  convertToBlob = mockConvertToBlob;
}
vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas);

describe('image-sanitization', () => {
  describe('base64ToBlob', () => {
    it('converts base64 string to Blob with correct type', () => {
      // btoa('hello') = 'aGVsbG8='
      const blob = base64ToBlob('aGVsbG8=', 'image/png');
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('image/png');
      expect(blob.size).toBe(5); // 'hello' is 5 bytes
    });

    it('handles empty base64 string', () => {
      const blob = base64ToBlob('', 'image/png');
      expect(blob.size).toBe(0);
    });
  });

  describe('blobToBase64', () => {
    it('converts a Blob back to base64 string', async () => {
      const original = 'Hello, World!';
      const blob = new Blob([original], { type: 'text/plain' });
      const base64 = await blobToBase64(blob);
      expect(base64).toBe(btoa(original));
    });

    it('handles empty Blob', async () => {
      const blob = new Blob([], { type: 'text/plain' });
      const base64 = await blobToBase64(blob);
      expect(base64).toBe('');
    });

    it('round-trips correctly', async () => {
      const data = 'Test data for round-trip';
      const base64Input = btoa(data);
      const blob = base64ToBlob(base64Input, 'text/plain');
      const base64Output = await blobToBase64(blob);
      expect(base64Output).toBe(base64Input);
    });
  });

  describe('sanitizeImage', () => {
    it('resizes image that exceeds max dimension', async () => {
      const result = await sanitizeImage('aGVsbG8=', 'image/png', 1200);

      // createImageBitmap mock returns 1920x1080, which exceeds 1200
      // Scale factor: min(1200/1920, 1200/1080) = 0.625
      expect(result.width).toBe(Math.round(1920 * (1200 / 1920)));
      expect(result.height).toBe(Math.round(1080 * (1200 / 1920)));
      expect(result.mimeType).toBe('image/jpeg');
      expect(mockClose).toHaveBeenCalled();
      expect(mockDrawImage).toHaveBeenCalled();
    });

    it('does not upscale small images', async () => {
      vi.mocked(createImageBitmap).mockResolvedValueOnce({
        width: 800,
        height: 600,
        close: mockClose,
      } as unknown as ImageBitmap);

      const result = await sanitizeImage('aGVsbG8=', 'image/png', 1200);

      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
    });

    it('converts to JPEG output', async () => {
      const result = await sanitizeImage('aGVsbG8=', 'image/png');
      expect(result.mimeType).toBe('image/jpeg');
      expect(mockConvertToBlob).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'image/jpeg', quality: 0.8 }),
      );
    });

    it('retries with lower quality when output exceeds max bytes', async () => {
      // First call returns a very large blob
      const largeBlobData = 'x'.repeat(6 * 1024 * 1024); // > 5MB base64
      mockConvertToBlob
        .mockResolvedValueOnce(new Blob([largeBlobData], { type: 'image/jpeg' }))
        .mockResolvedValueOnce(new Blob(['small'], { type: 'image/jpeg' }));

      const result = await sanitizeImage('aGVsbG8=', 'image/png');

      // Should have called convertToBlob twice (initial + reduced quality)
      expect(mockConvertToBlob).toHaveBeenCalledTimes(2);
      expect(mockConvertToBlob).toHaveBeenLastCalledWith(expect.objectContaining({ quality: 0.5 }));
      expect(result.base64).toBeTruthy();
    });

    it('maintains aspect ratio when width > height', async () => {
      vi.mocked(createImageBitmap).mockResolvedValueOnce({
        width: 2400,
        height: 600,
        close: mockClose,
      } as unknown as ImageBitmap);

      const result = await sanitizeImage('aGVsbG8=', 'image/png', 1200);

      // Scale: 1200/2400 = 0.5
      expect(result.width).toBe(1200);
      expect(result.height).toBe(300);
    });

    it('maintains aspect ratio when height > width', async () => {
      vi.mocked(createImageBitmap).mockResolvedValueOnce({
        width: 600,
        height: 2400,
        close: mockClose,
      } as unknown as ImageBitmap);

      const result = await sanitizeImage('aGVsbG8=', 'image/png', 1200);

      // Scale: 1200/2400 = 0.5
      expect(result.width).toBe(300);
      expect(result.height).toBe(1200);
    });

    it('closes the bitmap after processing', async () => {
      await sanitizeImage('aGVsbG8=', 'image/png');
      expect(mockClose).toHaveBeenCalledTimes(1);
    });
  });
});
