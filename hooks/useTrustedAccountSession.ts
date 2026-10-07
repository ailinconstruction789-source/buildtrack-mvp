'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { readTrustedActor, TRUSTED_AUTH_ERROR, type ActorClient, type ActorSession, type TrustedActor } from '@/lib/auth/trustedActor';

export interface TrustedSessionClient extends ActorClient {
    auth: ActorClient['auth'] & {
        signInWithPassword(input: { email: string; password: string }): PromiseLike<{
            data: { session: ActorSession | null }; error: unknown;
        }>;
        signOut(options: { scope: 'local' }): PromiseLike<{ error: unknown }>;
        onAuthStateChange(callback: (event: string, session: ActorSession | null) => void): {
            data: { subscription: { unsubscribe(): void } }
        };
    };
}
const ACTIVITY_KEY = 'buildtrack_last_active';
const IDLE_MS = 60 * 60 * 1000;
const IDLE_ERROR = 'ไม่ได้ใช้งานเกิน 60 นาที กรุณาเข้าสู่ระบบใหม่';

/** UI session only. Every database operation still needs independent authorization. */
export function useTrustedAccountSession(enabled: boolean, client: TrustedSessionClient = supabase) {
    const [state, setState] = useState<{ actor: TrustedActor | null; error: string | null; isLoggingIn: boolean }>({
        actor: null, error: null, isLoggingIn: false,
    });
    const controls = useRef<{ login(username: string, pin: string): Promise<void>; logout(): Promise<void> } | null>(null);

    useEffect(() => {
        if (!enabled) return;
        let active = true, generation = 0, loggingIn = false, refreshing = false, refreshAgain = false;
        let actor: TrustedActor | null = null;
        let scheduled: ReturnType<typeof setTimeout> | undefined;
        let lastPresence = 0;
        const current = (ticket: number) => active && ticket === generation;
        const publish = (patch: Partial<typeof state>) => { if (active) setState(previous => ({ ...previous, ...patch })); };
        const clear = (message?: string | null) => {
            generation++; actor = null; lastPresence = 0;
            localStorage.removeItem(ACTIVITY_KEY);
            // A SIGNED_OUT event must not erase the reason we just locked the UI.
            publish({ actor: null, ...(message === undefined ? {} : { error: message }) });
        };
        const validate = async (ticket: number) => {
            const next = await readTrustedActor(client);
            if (!current(ticket)) return;
            if (Date.now() - lastPresence >= 180_000) {
                const touch = await client.rpc('app_touch_current_user');
                if (touch.error) throw new Error(TRUSTED_AUTH_ERROR);
                if (!current(ticket)) return;
                lastPresence = Date.now();
            }
            // Keep a stable identity when a periodic verification changes nothing:
            // legacy data hooks depend on this object and otherwise reload all data.
            if (!actor || actor.authUserId !== next.authUserId || actor.legacyUserId !== next.legacyUserId
                || actor.username !== next.username || actor.role !== next.role || actor.canManageAccounts !== next.canManageAccounts) actor = next;
            publish({ actor, error: null });
        };
        const refresh = async () => {
            if (!active || loggingIn) return;
            if (refreshing) { refreshAgain = true; return; }
            refreshing = true;
            const ticket = generation;
            try {
                const session = await client.auth.getSession();
                if (!current(ticket)) return;
                if (session.error) throw new Error(TRUSTED_AUTH_ERROR);
                if (!session.data.session) { clear(); return; }
                const stamp = Number(localStorage.getItem(ACTIVITY_KEY));
                if (!Number.isFinite(stamp) || stamp <= 0 || stamp > Date.now() || Date.now() - stamp >= IDLE_MS) {
                    clear(stamp > 0 ? IDLE_ERROR : undefined);
                    // UI inactivity is NOT a substitute for server session expiry.
                    await client.auth.signOut({ scope: 'local' });
                    return;
                }
                await validate(ticket);
            } catch {
                if (current(ticket)) clear(TRUSTED_AUTH_ERROR);
            } finally {
                refreshing = false;
                if (active && refreshAgain) { refreshAgain = false; schedule(); }
            }
        };
        const schedule = () => {
            if (scheduled) clearTimeout(scheduled);
            // Never await/call Supabase from inside its Auth event callback.
            scheduled = setTimeout(() => { scheduled = undefined; void refresh(); }, 0);
        };
        const login = async (username: string, pin: string) => {
            if (!active || loggingIn) return;
            if (!username.trim() || !/^\d{4}$/.test(pin)) { publish({ error: 'กรุณาเลือกชื่อและกรอก PIN 4 หลัก' }); return; }
            const ticket = ++generation;
            loggingIn = true; actor = null; lastPresence = 0;
            publish({ actor: null, error: null, isLoggingIn: true });
            try {
                const signedIn = await client.auth.signInWithPassword({
                    email: `${username.toLowerCase().replace(/\s/g,'')}@buildtrack.local`, password: `${pin}BT!`,
                });
                if (!current(ticket)) {
                    // A late login must not undo logout. Never sign out a newer,
                    // different session that another tab may have established.
                    if (active && signedIn.data.session) {
                        const latest = await client.auth.getSession();
                        if (latest.data.session?.access_token === signedIn.data.session.access_token) await client.auth.signOut({ scope: 'local' });
                    }
                    return;
                }
                if (signedIn.error || !signedIn.data.session) throw new Error(TRUSTED_AUTH_ERROR);
                localStorage.setItem(ACTIVITY_KEY,Date.now().toString());
                await validate(ticket);
            } catch { if (current(ticket)) clear(TRUSTED_AUTH_ERROR); }
            finally { loggingIn = false; publish({ isLoggingIn: false }); }
        };
        const logout = async () => {
            clear(null);
            try {
                const result = await client.auth.signOut({ scope: 'local' });
                if (result.error) publish({ error: 'ออกจากระบบบนเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองอีกครั้ง' });
            } catch { publish({ error: 'ออกจากระบบบนเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองอีกครั้ง' }); }
        };
        controls.current = { login, logout };
        const subscription = client.auth.onAuthStateChange((event, session) => {
            if (!active) return;
            if (event === 'SIGNED_OUT') { clear(); return; }
            if (loggingIn) return; // The explicit login path performs its own verified read.
            if (['INITIAL_SESSION','SIGNED_IN','TOKEN_REFRESHED','USER_UPDATED'].includes(event)) {
                generation++;
                if (actor && actor.authUserId !== session?.user.id) { actor = null; publish({ actor: null }); }
                schedule();
            }
        }).data.subscription;
        const activity = () => {
            if (!actor) return;
            const stamp = Number(localStorage.getItem(ACTIVITY_KEY));
            const elapsed = Date.now() - stamp;
            if (stamp > 0 && elapsed >= 30_000 && elapsed < IDLE_MS) localStorage.setItem(ACTIVITY_KEY,Date.now().toString());
        };
        const visibility = () => { if (document.visibilityState === 'visible') schedule(); };
        for (const name of ['mousemove','keydown','click','touchstart']) window.addEventListener(name,activity);
        window.addEventListener('focus',schedule);
        document.addEventListener('visibilitychange',visibility);
        const interval = setInterval(schedule,60_000);
        schedule();
        return () => {
            active = false; generation++; controls.current = null;
            if (scheduled) clearTimeout(scheduled);
            clearInterval(interval); subscription.unsubscribe();
            for (const name of ['mousemove','keydown','click','touchstart']) window.removeEventListener(name,activity);
            window.removeEventListener('focus',schedule);
            document.removeEventListener('visibilitychange',visibility);
        };
    }, [enabled,client]);

    return { ...state,
        login: async (username: string,pin: string) => { await controls.current?.login(username,pin); },
        logout: async () => { await controls.current?.logout(); },
        dismissError: () => setState(previous => ({ ...previous,error:null })),
    };
}
