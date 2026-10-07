import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notFound } from 'next/navigation';
import Page from '@/app/dev/account-access/page';

vi.mock('next/navigation', () => ({ notFound: vi.fn(() => { throw new Error('NOT_FOUND'); }) }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('development-only account demonstration route', () => {
  it('opens with npm run dev without authentication or CRM feature flags', () => {
    vi.stubEnv('NODE_ENV', 'development'); render(<Page />);
    expect(screen.getByRole('heading', { name: 'ทดลองการคืนสิทธิ์ฝ่ายขาย' })).toBeInTheDocument();
    expect(notFound).not.toHaveBeenCalled();
  });
  it.each(['production', 'test', ''])('refuses the route outside development (%s)', environment => {
    vi.stubEnv('NODE_ENV', environment);
    expect(() => Page()).toThrow('NOT_FOUND'); expect(notFound).toHaveBeenCalledOnce();
  });
});
