/** Reads pixel dimensions from the header of a JPEG, PNG, GIF or WebP file (no decoding). */
export function imageSize(data: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const ascii = (offset: number, length: number) => String.fromCharCode(...data.subarray(offset, offset + length));
  if (data.length >= 24 && data[0] === 0x89 && ascii(1, 3) === "PNG") {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (data.length >= 10 && ascii(0, 3) === "GIF") {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (data.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8X") {
      const w = 1 + (data[24] | (data[25] << 8) | (data[26] << 16));
      const h = 1 + (data[27] | (data[28] << 8) | (data[29] << 16));
      return { width: w, height: h };
    }
    if (chunk === "VP8L") {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8 ") {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    return null;
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = data[offset + 1];
      if (marker === 0xff) {
        offset++;
        continue;
      }
      const length = view.getUint16(offset + 2);
      // SOF0-SOF15 carry the frame size; C4 (DHT), C8 (JPG) and CC (DAC) share the range but don't.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  return null;
}
