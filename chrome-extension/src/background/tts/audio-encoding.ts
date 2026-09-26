/** Encode ArrayBuffer as base64 (ArrayBuffer is not JSON-serializable via port messages) */
const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  // Chunked to stay under the argument-count limit of String.fromCharCode spread
  const CHUNK_SIZE = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE)));
  }
  return btoa(chunks.join(''));
};

export { arrayBufferToBase64 };
