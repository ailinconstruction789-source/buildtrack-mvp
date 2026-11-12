import { describe, it, expect } from 'vitest';
import {
  generateNextPinLabel,
  calculateNormalizedRatio,
  calculatePixelPosition,
  getPinStatusStyle
} from '../qcDrawingService';
import { QCDrawingAnnotation } from '@/types/qc.types';

describe('qcDrawingService', () => {
  describe('generateNextPinLabel', () => {
    it('returns P01 for empty existing list on page 1', () => {
      expect(generateNextPinLabel([], 1)).toBe('P01');
    });

    it('generates next sequential label on the same page', () => {
      const pins: QCDrawingAnnotation[] = [
        { id: '1', inspection_id: 'i1', page_number: 1, x_ratio: 0.1, y_ratio: 0.1, pin_label: 'P01', status: 'passed' }
      ];
      expect(generateNextPinLabel(pins, 1)).toBe('P02');
    });

    it('isolates pin count per page', () => {
      const pins: QCDrawingAnnotation[] = [
        { id: '1', inspection_id: 'i1', page_number: 1, x_ratio: 0.1, y_ratio: 0.1, pin_label: 'P01', status: 'passed' },
        { id: '2', inspection_id: 'i1', page_number: 2, x_ratio: 0.2, y_ratio: 0.2, pin_label: 'P01', status: 'passed' }
      ];
      // On page 2, there is 1 pin so next is P02
      expect(generateNextPinLabel(pins, 2)).toBe('P02');
      // On page 3, there are 0 pins so next is P01
      expect(generateNextPinLabel(pins, 3)).toBe('P01');
    });
  });

  describe('calculateNormalizedRatio', () => {
    const mockRect = {
      left: 100,
      top: 50,
      width: 200,
      height: 400,
      right: 300,
      bottom: 450,
      x: 100,
      y: 50,
      toJSON: () => {}
    } as DOMRect;

    it('calculates ratio accurately within 0 to 1', () => {
      const ratio = calculateNormalizedRatio(200, 250, mockRect);
      expect(ratio.xRatio).toBe(0.5);
      expect(ratio.yRatio).toBe(0.5);
    });

    it('clamps negative or out-of-bounds coordinates to 0..1', () => {
      const under = calculateNormalizedRatio(50, 20, mockRect);
      expect(under.xRatio).toBe(0);
      expect(under.yRatio).toBe(0);

      const over = calculateNormalizedRatio(500, 600, mockRect);
      expect(over.xRatio).toBe(1);
      expect(over.yRatio).toBe(1);
    });

    it('handles zero dimensions without divide-by-zero errors', () => {
      const zeroRect = { ...mockRect, width: 0, height: 0 } as DOMRect;
      const zero = calculateNormalizedRatio(100, 100, zeroRect);
      expect(zero.xRatio).toBe(0);
      expect(zero.yRatio).toBe(0);
    });
  });

  describe('calculatePixelPosition', () => {
    it('converts ratios back to pixel coordinates accurately', () => {
      const pin: QCDrawingAnnotation = {
        id: '1',
        inspection_id: 'i1',
        page_number: 1,
        x_ratio: 0.25,
        y_ratio: 0.75,
        pin_label: 'P01',
        status: 'passed'
      };
      const pos = calculatePixelPosition(pin, 1000, 500);
      expect(pos.x).toBe(250);
      expect(pos.y).toBe(375);
    });
  });

  describe('getPinStatusStyle', () => {
    it('returns rose styles for failed status', () => {
      const style = getPinStatusStyle('failed');
      expect(style.bgColor).toContain('rose');
      expect(style.badgeText).toBe('ไม่ผ่าน');
    });

    it('returns emerald styles for passed status', () => {
      const style = getPinStatusStyle('passed');
      expect(style.bgColor).toContain('emerald');
      expect(style.badgeText).toBe('ผ่าน');
    });

    it('returns slate styles for na status', () => {
      const style = getPinStatusStyle('na');
      expect(style.bgColor).toContain('slate');
      expect(style.badgeText).toBe('N/A');
    });
  });
});
