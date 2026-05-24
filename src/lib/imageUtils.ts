// Utilities for image storage and storage estimation.

/** Store an image file at full original quality — no resizing, no compression.
 *  Non-image files are also returned as raw base64. Returns a data URL string. */
export async function compressImage(file: File): Promise<string> {
  return await fileToDataUrl(file);
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Estimate IndexedDB / origin storage usage. Returns null if unsupported. */
export async function getStorageEstimate(): Promise<{ usage: number; quota: number; percent: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  const usage = e.usage ?? 0;
  const quota = e.quota ?? 0;
  const percent = quota > 0 ? (usage / quota) * 100 : 0;
  return { usage, quota, percent };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
