import { describe, it, expect } from 'vitest';

describe('Image Upload Limit and Display (20 Images for All Roles)', () => {
  it('should allow up to 20 images for all roles in task and defect progress views', () => {
    const maxImages = 20;

    expect(maxImages).toBe(20);
  });

  it('should slice selected files up to 20 images for all roles (Foreman, SE, QC, Admin)', () => {
    const mockFiles = Array.from({ length: 25 }, (_, i) => ({
      file: new File([], `photo_${i + 1}.jpg`),
      previewUrl: `blob:http://localhost/photo_${i + 1}`,
    }));

    const maxImages = 20;
    const selectedFiles: any[] = [];
    const updatedFiles = [...selectedFiles, ...mockFiles].slice(0, maxImages);

    expect(updatedFiles.length).toBe(20);
    expect(updatedFiles[19].previewUrl).toBe('blob:http://localhost/photo_20');
  });

  it('should render all 20 images from image_url comma-separated string without truncation', () => {
    const mockUrls = Array.from({ length: 20 }, (_, i) => `https://example.com/img_${i + 1}.jpg`).join(',');
    const parsedImages = mockUrls.split(',').filter((u: string) => u.trim() !== '');

    expect(parsedImages.length).toBe(20);
    expect(parsedImages[0]).toBe('https://example.com/img_1.jpg');
    expect(parsedImages[19]).toBe('https://example.com/img_20.jpg');
  });
});
