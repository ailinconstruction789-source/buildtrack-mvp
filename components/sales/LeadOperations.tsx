'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { LeadWorkSnapshot } from '@/lib/sales/leadWorkReadContracts';
import { LeadWorkApiError, type LeadWorkApi } from '@/lib/sales/leadWorkClient';
import { LeadLifecycleApiError, type LeadLifecycleApi } from '@/lib/sales/leadLifecycleClient';
import type { LeadLifecycleContext } from '@/lib/sales/leadLifecycleReadContracts';
import { readLeadWorkPending } from '@/lib/sales/leadWorkPending';
import { readLeadLifecyclePending } from '@/lib/sales/leadLifecyclePending';
import LeadWorkForm from './LeadWorkForm';
import LeadLifecycleForm from './LeadLifecycleForm';

interface Props {
    snapshot: LeadWorkSnapshot;
    context: LeadLifecycleContext | null;
    lifecycleEnabled: boolean;
    disabled: boolean;
    workApi: LeadWorkApi;
    lifecycleApi: LeadLifecycleApi;
    onSaved: (kind: 'work' | 'lifecycle') => void;
    onLockedChange: (value: boolean) => void;
    onRefreshRequired: () => Promise<void>;
}

type Mode = 'work' | 'lifecycle';
function recovery(snapshot: LeadWorkSnapshot) {
    const actor = snapshot.actor.userId, scope = snapshot.scope;
    try {
        const work = readLeadWorkPending(actor, scope);
        const lifecycle = readLeadLifecyclePending(actor, scope);
        return { work, lifecycle, error: work && lifecycle
            ? 'พบคำขอค้างทั้งการติดตามและการเปลี่ยน Lead กรุณาให้ Admin ตรวจรหัสทั้งสองก่อน ห้ามล้างคำขอหรือเริ่มรายการใหม่' : '' };
    } catch {
        return { work: null, lifecycle: null, error: 'ตรวจคำขอค้างในแท็บไม่ได้ กรุณาหยุดบันทึกและให้ Admin ตรวจสอบ ห้ามล้างข้อมูลแท็บหรือเริ่มรายการใหม่' };
    }
}

const subscribe = () => () => undefined;
const clientReady = () => true;
const serverReady = () => false;

/** One mounted write form per actor/scope. Inspect both queues even when the new
 * feature is disabled, so an uncertain lifecycle command cannot be bypassed. */
export default function LeadOperations(props: Props) {
    const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
    if (!ready) return <p role="status" className="text-sm text-slate-500">กำลังตรวจคำขอค้างในแท็บนี้…</p>;
    return <OperationsSession key={`${props.snapshot.actor.userId}:${props.snapshot.scope.customerId}:${props.snapshot.scope.interestId ?? 'central'}`} {...props} />;
}

function OperationsSession({ snapshot, context, lifecycleEnabled, disabled, workApi, lifecycleApi, onSaved, onLockedChange, onRefreshRequired }: Props) {
    const [initial] = useState(() => recovery(snapshot));
    const [mode, setMode] = useState<Mode>(initial.lifecycle ? 'lifecycle' : 'work');
    const [error, setError] = useState(initial.error);
    const [locked, setLocked] = useState(!!initial.work || !!initial.lifecycle || !!initial.error);
    const lockRef = useRef(locked);
    const savedRef = useRef(false);
    const block = !!error || (mode === 'lifecycle' && (!lifecycleEnabled || !context));
    const actor = snapshot.actor.userId, scope = snapshot.scope;

    const childLocked = useCallback((value: boolean) => {
        const next = value || savedRef.current;
        lockRef.current = next; setLocked(next); onLockedChange(next);
    }, [onLockedChange]);
    useEffect(() => {
        if (block) { lockRef.current = true; onLockedChange(true); }
    }, [block, onLockedChange]);
    useEffect(() => {
        if (!locked && !block) return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [locked, block]);

    function select(next: Mode) {
        if (disabled || lockRef.current || block || next === mode || (next === 'lifecycle' && (!lifecycleEnabled || !context))) return;
        const current = recovery(snapshot);
        if (current.error || current.work || current.lifecycle) {
            // A newly discovered external queue must never be silently overwritten.
            setError(current.error || 'พบคำขอค้างหลังเปิดหน้า กรุณาโหลดแท็บเดิมอีกครั้งเพื่อตรวจคำขอ ห้ามเริ่มรายการใหม่');
            childLocked(true); return;
        }
        setMode(next);
    }
    function saved() {
        // Stay locked until the parent installs a freshly read snapshot/session.
        savedRef.current = true; childLocked(true); onSaved(mode);
    }

    if (block) return <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 space-y-3">
        <h2 className="font-bold text-amber-950">ต้องตรวจคำขอเดิมก่อนทำรายการต่อ</h2>
        <p role="alert" className="text-sm text-amber-900">{error || 'มีคำขอเปลี่ยนผู้ดูแล/ปิด Lead ค้างอยู่ แต่ระบบส่วนนี้ยังไม่เปิดหรืออ่านข้อมูลไม่ได้ ให้ Admin ตรวจผลเดิมก่อน ห้ามเริ่มคำขอติดตามแทน'}</p>
        {initial.work && <p className="break-all text-sm">รหัสคำขอติดตาม: <code>{initial.work.requestId}</code></p>}
        {initial.lifecycle && <p className="break-all text-sm">รหัสคำขอเปลี่ยน Lead: <code>{initial.lifecycle.requestId}</code></p>}
    </section>;

    return <div className="space-y-4">
        {lifecycleEnabled && <div className="flex flex-wrap gap-2" role="group" aria-label="เลือกงานของ Lead">
            <button type="button" aria-pressed={mode === 'work'} disabled={disabled || locked} onClick={() => select('work')}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold aria-pressed:border-blue-500 aria-pressed:bg-blue-50 disabled:opacity-40">บันทึกการติดตาม</button>
            <button type="button" aria-pressed={mode === 'lifecycle'} disabled={disabled || locked || !context} onClick={() => select('lifecycle')}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold aria-pressed:border-blue-500 aria-pressed:bg-blue-50 disabled:opacity-40">เปลี่ยนผู้ดูแล / ปิด Lost</button>
        </div>}
        {mode === 'work' ? <LeadWorkForm snapshot={disabled ? { ...snapshot, canWrite: false } : snapshot}
            save={async input => {
                if (readLeadLifecyclePending(actor, scope)) throw new LeadWorkApiError('OTHER_COMMAND_PENDING', 'มีคำขอเปลี่ยน Lead ค้างอยู่ ให้ Admin ตรวจผลก่อนเริ่มรายการใหม่', 409);
                return workApi.save(input, actor);
            }} onSaved={saved} onLockedChange={childLocked} onRefreshRequired={onRefreshRequired} />
            : context && <LeadLifecycleForm context={context} disabled={disabled || !lifecycleEnabled}
                save={async input => {
                    if (readLeadWorkPending(actor, scope)) throw new LeadLifecycleApiError('OTHER_COMMAND_PENDING', 'มีคำขอติดตามค้างอยู่ ให้ Admin ตรวจผลก่อนเริ่มรายการใหม่', 409);
                    return lifecycleApi.save(input, actor);
                }} onSaved={saved} onLockedChange={childLocked} onRefreshRequired={onRefreshRequired} />}
    </div>;
}
