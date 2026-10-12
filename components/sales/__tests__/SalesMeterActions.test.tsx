import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminDocsManager from '../AdminDocsManager';
import type { Plot } from '@/types/database.types';
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../../MeterPhotoConfirmationModal', () => ({ default: () => null }));
afterEach(cleanup);
function open(status: string, image?: string) {
  render(<AdminDocsManager plots={[{ id: 'P1', project_name: 'Project A', plot_name: '1', water_meter_status: status, water_meter_image_url: image } as Plot]} onUpdate={vi.fn()} />);
}
describe('one meter action per state', () => {
  it('offers photo confirmation for Paid without a photo', () => { open('Paid'); expect(screen.getByRole('button', { name: 'ถ่ายรูปยืนยันติดตั้ง' })).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'แก้ไข' })).not.toBeInTheDocument(); });
  it('offers only edit when a Paid meter already has a photo', () => { open('Paid', 'https://example.com/meter.jpg'); expect(screen.getByRole('button', { name: 'แก้ไข' })).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'ถ่ายรูปยืนยันติดตั้ง' })).not.toBeInTheDocument(); });
  it('still allows attaching a missing installed-meter photo', () => { open('Installed'); expect(screen.getByRole('button', { name: 'แนบรูปถ่ายมิเตอร์' })).toBeInTheDocument(); });
});
