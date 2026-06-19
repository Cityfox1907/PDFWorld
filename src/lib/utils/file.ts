/** Read a File/Blob into a Uint8Array. */
export async function readFileBytes(file: Blob): Promise<Uint8Array> {
  const buffer = await file.arrayBuffer();
  return new Uint8Array(buffer);
}

/** Trigger a browser download for the given bytes. */
export function downloadBytes(bytes: Uint8Array, fileName: string, mime = 'application/pdf'): void {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([ab], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Load an image file as a data URL that PDFWorld can embed at FULL, original quality.
 *
 * PNG and JPEG are kept byte-for-byte (the export embeds the exact original bytes — no
 * re-compression, no quality loss). Every other format the browser can decode (WebP,
 * GIF, BMP, AVIF…) is re-encoded to **PNG**, which is lossless in pixels and — unlike
 * the raw bytes — something pdf-lib can embed, so such an image is never silently
 * dropped on export. Returns the data URL plus the image's intrinsic pixel size, or
 * null when the file can't be read/decoded.
 */
export function loadEmbeddableImage(file: Blob): Promise<{ src: string; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const raw = reader.result as string;
      const img = new Image();
      img.onerror = () => resolve(null);
      img.onload = () => {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        const semi = raw.indexOf(';');
        const mime = semi > 5 ? raw.slice(5, semi).toLowerCase() : '';
        // Already directly embeddable → keep the original bytes, untouched.
        if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/jpg') {
          resolve({ src: raw, width: w, height: h });
          return;
        }
        // Re-encode anything else losslessly to PNG so the pixels survive 1:1.
        const c = document.createElement('canvas');
        c.width = Math.max(1, w);
        c.height = Math.max(1, h);
        const ctx = c.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        try {
          resolve({ src: c.toDataURL('image/png'), width: w, height: h });
        } catch {
          resolve(null);
        }
      };
      img.src = raw;
    };
    reader.readAsDataURL(file);
  });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** Strip a trailing .pdf (case-insensitive) for building output names. */
export function baseName(name: string): string {
  return name.replace(/\.pdf$/i, '');
}
