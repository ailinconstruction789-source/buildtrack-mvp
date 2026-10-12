export interface ConstructionPreviewFile { file: File; previewUrl: string }

/** Do not create object URLs for rejected files: those URLs otherwise retain blobs. */
export function appendConstructionPreviewFiles(
  existing: readonly ConstructionPreviewFile[], files: readonly File[], limit: number,
): ConstructionPreviewFile[] {
  const remaining = Math.max(0, limit - existing.length);
  return [...existing, ...files.slice(0, remaining).map(file => ({ file, previewUrl: URL.createObjectURL(file) }))];
}
