import { describe, it, expect, vi } from 'vitest';
import {
  isExternalProject,
  updateProjectExternalStatus,
  createProjectWithSettings
} from '../projectUtils';

describe('projectUtils helper library', () => {
  describe('isExternalProject', () => {
    it('returns false for null, undefined, or empty values', () => {
      expect(isExternalProject(null)).toBe(false);
      expect(isExternalProject(undefined)).toBe(false);
      expect(isExternalProject('')).toBe(false);
    });

    it('identifies บ้านคุณโอ by string name', () => {
      expect(isExternalProject('บ้านคุณโอ')).toBe(true);
      expect(isExternalProject('  บ้านคุณโอ  ')).toBe(true);
      expect(isExternalProject('ไอลิน 6')).toBe(false);
    });

    it('identifies project by is_external property', () => {
      expect(isExternalProject({ name: 'โครงการทดสอบ', is_external: true })).toBe(true);
      expect(isExternalProject({ name: 'โครงการทดสอบ', is_external: false })).toBe(false);
    });

    it('identifies project by layout_data config', () => {
      const projectWithConfig = {
        name: 'งานสั่งสร้าง ก',
        layout_data: [
          { type: 'cell', id: '1' },
          { type: 'config', id: 'GRID_CONFIG', is_external: true }
        ]
      };
      expect(isExternalProject(projectWithConfig)).toBe(true);

      const projectWithFalseConfig = {
        name: 'งานสั่งสร้าง ข',
        layout_data: [
          { type: 'config', id: 'GRID_CONFIG', is_external: false }
        ]
      };
      expect(isExternalProject(projectWithFalseConfig)).toBe(false);
    });

    it('falls back to true for บ้านคุณโอ object even without is_external property', () => {
      expect(isExternalProject({ name: 'บ้านคุณโอ' })).toBe(true);
    });
  });

  describe('updateProjectExternalStatus', () => {
    it('updates is_external column directly when supported', async () => {
      const mockEq = vi.fn().mockResolvedValue({ error: null });
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate });
      const mockClient = { from: mockFrom };

      const res = await updateProjectExternalStatus(mockClient, 'บ้านคุณโอ', true);
      expect(res.success).toBe(true);
      expect(mockFrom).toHaveBeenCalledWith('projects');
      expect(mockUpdate).toHaveBeenCalledWith({ is_external: true });
      expect(mockEq).toHaveBeenCalledWith('name', 'บ้านคุณโอ');
    });

    it('falls back to layout_data config when column does not exist in schema', async () => {
      let callCount = 0;
      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'projects') {
            return {
              update: vi.fn(() => {
                callCount++;
                if (callCount === 1) {
                  // First call fails with column does not exist
                  return {
                    eq: vi.fn().mockResolvedValue({
                      error: { code: '42703', message: 'column projects.is_external does not exist' }
                    })
                  };
                }
                // Second call (layout_data update) succeeds
                return {
                  eq: vi.fn().mockResolvedValue({ error: null })
                };
              }),
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { layout_data: [{ type: 'config', id: 'GRID_CONFIG', cols: 40 }] }
                  })
                }))
              }))
            };
          }
          return {};
        })
      };

      const res = await updateProjectExternalStatus(mockClient as any, 'บ้านคุณโอ', true);
      expect(res.success).toBe(true);
      expect(callCount).toBe(2);
    });
  });

  describe('createProjectWithSettings', () => {
    it('creates project with is_external flag', async () => {
      const mockInsert = vi.fn().mockResolvedValue({ error: null });
      const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });
      const mockClient = { from: mockFrom };

      const res = await createProjectWithSettings(mockClient, 'บ้านคุณโอใหม่', true);
      expect(res.success).toBe(true);
      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          name: 'บ้านคุณโอใหม่',
          is_external: true,
          layout_data: expect.arrayContaining([
            expect.objectContaining({ is_external: true })
          ])
        })
      ]);
    });

    it('gracefully falls back if is_external column does not exist during insert', async () => {
      let insertCount = 0;
      const mockInsert = vi.fn((payload) => {
        insertCount++;
        if (insertCount === 1) {
          return Promise.resolve({
            error: { code: '42703', message: 'column projects.is_external does not exist' }
          });
        }
        return Promise.resolve({ error: null });
      });
      const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });
      const mockClient = { from: mockFrom };

      const res = await createProjectWithSettings(mockClient, 'บ้านคุณโอสำรอง', true);
      expect(res.success).toBe(true);
      expect(insertCount).toBe(2);
    });
  });
});
