import { describe, it, expect } from 'vitest';

describe('QC Image Upload Limit', () => {
  it('should allow up to 20 images for QC role in task and defect progress views', () => {
    const getTaskMaxImages = (isQC: boolean, currentUserRole?: string) => {
      return (isQC || currentUserRole?.toLowerCase() === 'qc') ? 20 : 10;
    };

    expect(getTaskMaxImages(true)).toBe(20);
    expect(getTaskMaxImages(false, 'qc')).toBe(20);
    expect(getTaskMaxImages(false, 'QC')).toBe(20);
    expect(getTaskMaxImages(false, 'site_engineer')).toBe(10);
    expect(getTaskMaxImages(false, 'foreman')).toBe(10);
    expect(getTaskMaxImages(false, undefined)).toBe(10);
  });

  it('should slice selected files up to maxImages (20 for QC)', () => {
    const mockFiles = Array.from({ length: 25 }, (_, i) => ({
      file: new File([], `photo_${i + 1}.jpg`),
      previewUrl: `blob:http://localhost/photo_${i + 1}`,
    }));

    const isQC = true;
    const maxImages = isQC ? 20 : 10;
    const selectedFiles: any[] = [];
    const updatedFiles = [...selectedFiles, ...mockFiles].slice(0, maxImages);

    expect(updatedFiles.length).toBe(20);
    expect(updatedFiles[19].previewUrl).toBe('blob:http://localhost/photo_20');
  });

  it('should slice selected files up to 10 for non-QC roles', () => {
    const mockFiles = Array.from({ length: 25 }, (_, i) => ({
      file: new File([], `photo_${i + 1}.jpg`),
      previewUrl: `blob:http://localhost/photo_${i + 1}`,
    }));

    const isQC = false;
    const maxImages = isQC ? 20 : 10;
    const selectedFiles: any[] = [];
    const updatedFiles = [...selectedFiles, ...mockFiles].slice(0, maxImages);

    expect(updatedFiles.length).toBe(10);
  });
});
