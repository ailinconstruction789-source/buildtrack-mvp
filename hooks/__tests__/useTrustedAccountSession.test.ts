import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTrustedAccountSession, type TrustedSessionClient } from '../useTrustedAccountSession';
import { readTrustedActor, type ActorSession, type TrustedActor } from '@/lib/auth/trustedActor';
vi.mock('@/lib/supabase',()=>({supabase:{}}));
vi.mock('@/lib/auth/trustedActor',async original=>({
    ...await original<typeof import('@/lib/auth/trustedActor')>(),readTrustedActor:vi.fn(),
}));
const actor:TrustedActor={contract:'buildtrack.actor.v1',authUserId:'a0250000-0000-4000-8000-000000000002',legacyUserId:2,username:'Sales A',role:'Sales',canManageAccounts:false};
const session:ActorSession={access_token:'synthetic',user:{id:actor.authUserId}};
const restoreStamp=()=>localStorage.setItem('buildtrack_last_active',Date.now().toString());
async function flush(){await act(async()=>{await vi.advanceTimersByTimeAsync(1);});}
function fixture(initial:ActorSession|null=null){
    let activeSession=initial;
    let callback:(event:string,session:ActorSession|null)=>void=()=>{};
    let insideEvent=false;
    const emit=(event:string)=>{insideEvent=true;callback(event,activeSession);insideEvent=false;};
    const unsubscribe=vi.fn();
    const assertOutsideEvent=()=>{expect(insideEvent).toBe(false);};
    const client={auth:{
        getSession:vi.fn(async()=>{assertOutsideEvent();return {data:{session:activeSession},error:null};}),
        getUser:vi.fn(async()=>({data:{user:activeSession?.user??null},error:null})),
        signInWithPassword:vi.fn(async()=>{activeSession=session;emit('SIGNED_IN');return {data:{session},error:null};}),
        signOut:vi.fn(async()=>{activeSession=null;emit('SIGNED_OUT');return {error:null};}),
        onAuthStateChange:vi.fn((cb:typeof callback)=>{callback=cb;return {data:{subscription:{unsubscribe}}};}),
    },rpc:vi.fn(async()=>{assertOutsideEvent();return {data:null,error:null};})};
    return {client,emit,unsubscribe,setSession:(next:ActorSession|null)=>{activeSession=next;}};
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-25T10:00:00Z'));localStorage.clear();vi.mocked(readTrustedActor).mockReset().mockResolvedValue(actor);});
afterEach(()=>{cleanup();vi.useRealTimers();});
describe('trusted session lifecycle',()=>{
    it('does nothing while default-off mode is disabled',async()=>{
        const f=fixture(session);renderHook(()=>useTrustedAccountSession(false,f.client));await flush();
        expect(f.client.auth.getSession).not.toHaveBeenCalled();expect(f.client.auth.onAuthStateChange).not.toHaveBeenCalled();
    });
    it('restores only a verified actor and touches only the caller without username arguments',async()=>{
        restoreStamp();const f=fixture(session);const {result}=renderHook(()=>useTrustedAccountSession(true,f.client));await flush();
        expect(result.current.actor).toEqual(actor);expect(f.client.rpc).toHaveBeenCalledExactlyOnceWith('app_touch_current_user');
    });
    it('logs in with the existing username/PIN transformation then resolves trusted role',async()=>{
        const f=fixture();const {result}=renderHook(()=>useTrustedAccountSession(true,f.client));await flush();
        await act(async()=>{await result.current.login('Sales A','1234');});
        expect(f.client.auth.signInWithPassword).toHaveBeenCalledWith({email:'salesa@buildtrack.local',password:'1234BT!'});
        expect(result.current.actor?.role).toBe('Sales');expect(result.current.isLoggingIn).toBe(false);
    });
    it('missing role RPC never falls back to legacy metadata',async()=>{
        restoreStamp();vi.mocked(readTrustedActor).mockRejectedValue(new Error('missing RPC'));
        const f=fixture(session);const {result}=renderHook(()=>useTrustedAccountSession(true,f.client));await flush();
        expect(result.current.actor).toBeNull();expect(result.current.error).toContain('ยืนยันสิทธิ์');
        expect(f.client.rpc).not.toHaveBeenCalled();
    });
    it('deferred Auth event refresh does not call the SDK inside its callback',async()=>{
        restoreStamp();const f=fixture(session);const {result}=renderHook(()=>useTrustedAccountSession(true,f.client));await flush();
        vi.mocked(readTrustedActor).mockResolvedValue({...actor,role:'Owner'});
        await act(async()=>{f.emit('TOKEN_REFRESHED');});await flush();
        expect(result.current.actor?.role).toBe('Owner');
    });
    it('sign-out invalidates an in-flight actor response immediately',async()=>{
        restoreStamp();let resolve!:(value:TrustedActor)=>void;
        vi.mocked(readTrustedActor).mockReturnValueOnce(new Promise(accept=>{resolve=accept;}));
        const f=fixture(session);const {result}=renderHook(()=>useTrustedAccountSession(true,f.client));await flush();
        await act(async()=>{f.setSession(null);f.emit('SIGNED_OUT');resolve(actor);});
        expect(result.current.actor).toBeNull();expect(f.client.rpc).not.toHaveBeenCalled();
    });
    it('an Auth event during a pending restore triggers a fresh check after it settles',async()=>{
        restoreStamp();let resolve!:(value:TrustedActor)=>void;
        vi.mocked(readTrustedActor).mockReturnValueOnce(new Promise(accept=>{resolve=accept;}))
            .mockResolvedValue({...actor,role:'Owner'});
        const f=fixture(session);const {result}=renderHook(()=>useTrustedAccountSession(true,f.client));await flush();
        await act(async()=>{f.emit('TOKEN_REFRESHED');});await flush();
        await act(async()=>{resolve(actor);});await flush();
        expect(result.current.actor?.role).toBe('Owner');expect(readTrustedActor).toHaveBeenCalledTimes(2);
    });
    it('permission revocation on the next periodic check locks the app',async()=>{
        restoreStamp();const f=fixture(session);const {result}=renderHook(()=>useTrustedAccountSession(true,f.client));await flush();
        vi.mocked(readTrustedActor).mockRejectedValue(new Error('revoked'));
        await act(async()=>{await vi.advanceTimersByTimeAsync(60_001);});
        expect(result.current.actor).toBeNull();expect(result.current.error).toContain('ยืนยันสิทธิ์');
    });
    it('preserves actor identity on unchanged checks so data hooks do not reload every minute',async()=>{
        restoreStamp();const f=fixture(session);const {result}=renderHook(()=>useTrustedAccountSession(true,f.client));await flush();
        const initial=result.current.actor;
        vi.mocked(readTrustedActor).mockResolvedValue({...actor});
        await act(async()=>{await vi.advanceTimersByTimeAsync(60_001);});
        expect(readTrustedActor).toHaveBeenCalledTimes(2);expect(result.current.actor).toBe(initial);
    });
    it('expired or missing local activity never restores an old session',async()=>{
        localStorage.setItem('buildtrack_last_active',String(Date.now()-3_600_000));
        const f=fixture(session);const {result}=renderHook(()=>useTrustedAccountSession(true,f.client));await flush();
        expect(result.current.actor).toBeNull();expect(readTrustedActor).not.toHaveBeenCalled();expect(f.client.auth.signOut).toHaveBeenCalled();
        expect(result.current.error).toContain('60 นาที');
        await act(async()=>{await vi.advanceTimersByTimeAsync(60_001);});
        expect(result.current.error).toContain('60 นาที');
        act(()=>result.current.dismissError());expect(result.current.error).toBeNull();
    });
    it('stops subscriptions and timers on unmount',async()=>{
        restoreStamp();const f=fixture(session);const {unmount}=renderHook(()=>useTrustedAccountSession(true,f.client));await flush();
        unmount();expect(f.unsubscribe).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
    });
    it('serializes double login requests',async()=>{
        const f=fixture();let complete!:(value:{data:{session:ActorSession};error:null})=>void;
        f.client.auth.signInWithPassword.mockReturnValueOnce(new Promise(accept=>{complete=accept;}));
        const {result}=renderHook(()=>useTrustedAccountSession(true,f.client));await flush();
        let first!:Promise<void>;
        await act(async()=>{first=result.current.login('Sales A','1234');await result.current.login('Sales A','1234');});
        expect(f.client.auth.signInWithPassword).toHaveBeenCalledTimes(1);
        await act(async()=>{f.setSession(session);complete({data:{session},error:null});await first;});
        expect(result.current.actor).toEqual(actor);
    });
    it.each([false,true])('a late login cannot undo logout or revoke a newer different session (newer=%s)',async newer=>{
        const f=fixture();let complete!:(value:{data:{session:ActorSession};error:null})=>void;
        f.client.auth.signInWithPassword.mockReturnValueOnce(new Promise(accept=>{complete=accept;}));
        const {result}=renderHook(()=>useTrustedAccountSession(true,f.client));await flush();
        let pending!:Promise<void>;
        await act(async()=>{pending=result.current.login('Sales A','1234');});
        await act(async()=>{await result.current.logout();});
        f.client.auth.signOut.mockClear();
        await act(async()=>{
            f.setSession(newer ? {...session,access_token:'newer-session'} : session);
            complete({data:{session},error:null});await pending;
        });
        expect(result.current.actor).toBeNull();expect(result.current.isLoggingIn).toBe(false);
        expect(readTrustedActor).not.toHaveBeenCalled();
        expect(f.client.auth.signOut).toHaveBeenCalledTimes(newer ? 0 : 1);
    });
});
// Compile-time shape check against the interface used by the real Supabase client.
const shape:TrustedSessionClient=fixture().client;
void shape;
