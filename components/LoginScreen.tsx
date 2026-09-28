'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { LOGIN_DIRECTORY_ERROR, readLoginNames, type LoginName } from '@/lib/auth/loginDirectory';
import LoginView, { type LoginViewProps } from './LoginView';

type Props = Omit<LoginViewProps, 'loginNames' | 'namesLoading' | 'namesError' | 'onRetryNames'>;

/** Mounted only on the signed-out screen; never consumes the staff/admin directory. */
export default function LoginScreen(props: Props) {
    const [attempt, setAttempt] = useState(0);
    const [directory, setDirectory] = useState<{ names: LoginName[]; loading: boolean; error: string | null }>({
        names: [], loading: true, error: null,
    });
    useEffect(() => {
        let active = true;
        void readLoginNames(supabase).then(names => {
            if (active) setDirectory({ names, loading: false, error: null });
        }).catch(() => {
            // Do not expose database error details or retry with SELECT *.
            if (active) setDirectory({ names: [], loading: false, error: LOGIN_DIRECTORY_ERROR });
        });
        return () => { active = false; };
    }, [attempt]);

    return <LoginView {...props} loginNames={directory.names} namesLoading={directory.loading}
        namesError={directory.error} onRetryNames={() => {
            setDirectory({ names: [], loading: true, error: null });
            setAttempt(previous => previous + 1);
        }} />;
}
