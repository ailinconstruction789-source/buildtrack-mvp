// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_ROLES, parseTrustedActor, readTrustedActor, TRUSTED_AUTH_ERROR } from '../trustedActor';
const uid='a0250000-0000-4000-8000-000000000002';
const actor={contract:'buildtrack.actor.v1',authUserId:uid,legacyUserId:2,username:'Sales A',role:'Sales',canManageAccounts:false};
const session={access_token:'synthetic-token',user:{id:uid,user_metadata:{role:'Admin'}}};
function fixture() {
    return { auth:{
        getSession:vi.fn(async()=>({data:{session},error:null})),
        getUser:vi.fn(async()=>({data:{user:{id:uid,user_metadata:{role:'Admin'}}},error:null})),
    },rpc:vi.fn(async()=>({data:actor,error:null})) };
}
afterEach(()=>vi.unstubAllEnvs());
describe('trusted actor contract and verified identity',()=>{
    it.each(APP_ROLES)('supports reviewed %s without carrying extra metadata',role=>{
        expect(parseTrustedActor({...actor,role,user_metadata:{role:'Admin'}},uid)).toEqual({...actor,role});
    });
    it.each([null,{}, {...actor,contract:'v2'}, {...actor,authUserId:'a0250000-0000-4000-8000-000000000003'},
        {...actor,role:'SuperAdmin'},{...actor,legacyUserId:0},{...actor,username:''},
        {...actor,canManageAccounts:true},{...actor,canManageAccounts:'true'}])('rejects invalid snapshot %j',value=>{
        expect(()=>parseTrustedActor(value,uid)).toThrow(TRUSTED_AUTH_ERROR);
    });
    it('verifies with Auth and ignores forged metadata in the cached session and Auth response',async()=>{
        const client=fixture();
        expect(await readTrustedActor(client)).toEqual(actor);
        expect(client.auth.getUser).toHaveBeenCalledWith('synthetic-token');
        expect(client.rpc).toHaveBeenCalledExactlyOnceWith('app_current_actor');
    });
    it('fails closed when the RPC has not been installed',async()=>{
        const client=fixture();
        client.rpc.mockResolvedValueOnce({data:null,error:{code:'PGRST202'}} as never);
        await expect(readTrustedActor(client)).rejects.toThrow(TRUSTED_AUTH_ERROR);
        expect(client.rpc).toHaveBeenCalledTimes(1);
    });
    it('rejects a failed verified identity before calling RPC',async()=>{
        const client=fixture();
        client.auth.getUser.mockResolvedValueOnce({data:{user:null},error:{message:'bad token'}} as never);
        await expect(readTrustedActor(client)).rejects.toThrow(TRUSTED_AUTH_ERROR);
        expect(client.rpc).not.toHaveBeenCalled();
    });
    it('rejects a token/session change during resolution',async()=>{
        const client=fixture();
        client.auth.getSession.mockResolvedValueOnce({data:{session},error:null})
            .mockResolvedValueOnce({data:{session:{...session,access_token:'new-token'}},error:null});
        await expect(readTrustedActor(client)).rejects.toThrow(TRUSTED_AUTH_ERROR);
    });
    it('rejects a verified user mismatch',async()=>{
        const client=fixture();
        client.auth.getUser.mockResolvedValueOnce({data:{user:{id:'other'}},error:null} as never);
        await expect(readTrustedActor(client)).rejects.toThrow(TRUSTED_AUTH_ERROR);
        expect(client.rpc).not.toHaveBeenCalled();
    });
    it.each([undefined,'false','1','TRUE'])('flag is off unless explicitly enabled: %s',async value=>{
        vi.resetModules(); vi.stubEnv('NEXT_PUBLIC_ACCOUNT_TRUSTED_AUTH_ENABLED',value);
        expect((await import('../trustedActor')).TRUSTED_AUTH_ENABLED).toBe(false);
    });
});
