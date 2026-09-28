import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginScreen from '../LoginScreen';
import { readLoginNames } from '@/lib/auth/loginDirectory';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/auth/loginDirectory', async importOriginal => ({
    ...await importOriginal<typeof import('@/lib/auth/loginDirectory')>(), readLoginNames: vi.fn(),
}));
const props = { loginData: { username: 'Sales A', pin: '1234' }, setLoginData: vi.fn(), handleLogin: vi.fn() };

describe('separate public login screen', () => {
    beforeEach(() => { vi.resetAllMocks(); });
    it('waits for names, then allows the existing PIN login', async () => {
        let resolve!: (value: { username: string }[]) => void;
        vi.mocked(readLoginNames).mockReturnValue(new Promise(accept => { resolve = accept; }));
        render(<LoginScreen {...props} />);
        expect(screen.getByRole('combobox')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Sign In' })).toBeDisabled();
        await act(async () => { resolve([{ username: 'Sales A' }]); });
        expect(screen.getByRole('option', { name: 'Sales A' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
        expect(props.handleLogin).toHaveBeenCalledOnce();
    });
    it('masks backend details, retries only the name reader, and preserves PIN input', async () => {
        vi.mocked(readLoginNames).mockRejectedValueOnce(new Error('secret database details'))
            .mockResolvedValueOnce([{ username: 'Sales A' }]);
        render(<LoginScreen {...props} />);
        expect(await screen.findByRole('alert')).not.toHaveTextContent('secret');
        expect(screen.getByRole('button', { name: 'Sign In' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'ลองโหลดรายชื่ออีกครั้ง' }));
        await screen.findByRole('option', { name: 'Sales A' });
        expect(readLoginNames).toHaveBeenCalledTimes(2);
        expect(screen.getByLabelText(/PIN Code/i)).toHaveValue('1234');
    });
    it('a late result from the previous login screen cannot replace the new list', async () => {
        let resolveOld!: (value: { username: string }[]) => void;
        vi.mocked(readLoginNames).mockReturnValueOnce(new Promise(accept => { resolveOld = accept; }))
            .mockResolvedValueOnce([{ username: 'Sales A' }]);
        const old = render(<LoginScreen {...props} />);
        old.unmount();
        render(<LoginScreen {...props} />);
        await screen.findByRole('option', { name: 'Sales A' });
        await act(async () => { resolveOld([{ username: 'Old user' }]); });
        expect(screen.queryByRole('option', { name: 'Old user' })).not.toBeInTheDocument();
        await waitFor(() => expect(readLoginNames).toHaveBeenCalledTimes(2));
    });
});
