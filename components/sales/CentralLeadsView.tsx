'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { 
  Building2, CheckCircle, ArrowLeft, Bell, Shield, Layers, Loader2
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { CentralApiError, centralApi, type CentralApi } from '@/lib/sales/centralClient';
import { parseCentralSearchFilters, type CentralSearchSnapshot, type CentralSearchFilters, type CentralCreateInput, type CentralCreateResult } from '@/lib/sales/centralContracts';
import CentralLeadForm from './CentralLeadForm';
import CentralLeadTracker from './CentralLeadTracker';
import { LeadTrackerHeader } from './LeadTrackerPresentation';
import { EMPTY_TRACKER_FILTERS } from '@/lib/sales/centralTracker';

const snapshotCache = new Map<string, CentralSearchSnapshot>();

async function fetchCentralLeadsSnapshot(
  page: number,
  filters: CentralSearchFilters,
  customApi?: CentralApi
): Promise<CentralSearchSnapshot> {
  // If a custom mock API is passed for testing (and not centralApi), use it
  if (customApi && customApi !== centralApi) {
    return await customApi.read(page, filters);
  }

  try {
    // 1. Fetch all leads from public.leads
    const { data: rawLeads, error: leadsErr } = await supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false });

    if (leadsErr) throw leadsErr;

    // 2. Fetch projects
    const { data: rawProjects } = await supabase
      .from('projects')
      .select('name')
      .order('name');
    
    const projects = (rawProjects || []).map((p: any) => ({ name: p.name }));
    const projectNames = projects.map(p => p.name);

    // 3. Fetch users / staff for sales owner options
    const { data: rawUsers } = await supabase
      .from('users')
      .select('id, username, role');

    const leads = rawLeads || [];

    // Distinct channels
    const channelsSet = new Set<string>();
    leads.forEach(l => {
      if (l.channel && typeof l.channel === 'string' && l.channel.trim()) {
        channelsSet.add(l.channel.trim());
      }
    });
    const channels = Array.from(channelsSet);

    // Distinct sales owners
    const ownersMap = new Map<string, string>();
    (rawUsers || []).forEach((u: any) => {
      if (u.username) ownersMap.set(u.username, u.username);
    });
    leads.forEach(l => {
      const name = l.agent_name || l.sales_owner || l.created_by_agent || l.closing_agent;
      if (name && typeof name === 'string' && name.trim()) {
        ownersMap.set(name.trim(), name.trim());
      }
    });
    const salesOwners = Array.from(ownersMap.entries()).map(([k, v]) => ({
      userId: k,
      displayName: v
    }));

    // Map each lead into CentralSearchSnapshot format
    const allCustomers = leads.map((lead: any) => {
      const isRented = 
        (lead.status || '').toLowerCase().includes('เช่า') || 
        (lead.deal_type || '').toLowerCase().includes('rent') || 
        (lead.crm_status || '').toLowerCase().includes('เช่า') ||
        (lead.rental_program != null && lead.rental_program !== '') ||
        (lead.notes || '').includes('สัญญาเช่า') ||
        (lead.notes || '').includes('ผู้เช่า');

      const isBooked = 
        (lead.status || '').toLowerCase().includes('จอง') ||
        (lead.crm_status || '').toLowerCase().includes('จอง') ||
        (lead.notes || '').includes('🏷️ บันทึกการจอง') ||
        lead.booking_date != null ||
        lead.booking_amount != null;

      const isLost = 
        ['ยกเลิก', 'ไม่สนใจ', 'ยกเลิกการจอง', 'cancel', 'cancelled', 'lost', 'closed_lost', 'nurture', 'cold', 'unqualified'].some((s: string) => 
          (lead.status || '').toLowerCase().includes(s) || 
          (lead.crm_status || '').toLowerCase().includes(s)
        );

      let intakeStatus = 'follow_up';
      if (isRented) intakeStatus = 'rented';
      else if (isBooked) intakeStatus = 'booked';
      else if (isLost) intakeStatus = 'lost';
      else if (lead.status === 'โอนกรรมสิทธิ์แล้ว' || lead.transferred_date != null) intakeStatus = 'contracted';
      else if (lead.contacted_date || lead.actual_visit_date) intakeStatus = 'contacted';

      const ownerUserId = lead.agent_name || lead.sales_owner || lead.created_by_agent || lead.closing_agent || 'unassigned';

      return {
        id: lead.id,
        name: lead.customer_name || 'ไม่ระบุชื่อ',
        phone: lead.phone || null,
        channel: lead.channel || 'Walk in',
        notes: lead.notes || null,
        ownerUserId,
        leadCreatedAt: lead.lead_date || lead.created_at || new Date().toISOString(),
        intakeStatus,
        interests: lead.project_name ? [
          {
            id: `${lead.id}-int`,
            projectName: lead.project_name,
            ownerUserId,
            workspaceState: 'central_interest' as const,
            engagementStatus: intakeStatus,
            plotId: lead.interested_plot_name || lead.interested_plot_id || lead.interest || null,
          }
        ] : []
      };
    });

    // Apply search and filter conditions
    let filtered = allCustomers;
    if (filters.search) {
      const q = filters.search.toLowerCase().trim();
      filtered = filtered.filter(c => 
        c.name.toLowerCase().includes(q) ||
        (c.phone && c.phone.includes(q)) ||
        (c.notes && c.notes.toLowerCase().includes(q)) ||
        (c.channel && c.channel.toLowerCase().includes(q)) ||
        c.interests.some(i => (i.plotId && i.plotId.toLowerCase().includes(q)) || i.projectName.toLowerCase().includes(q))
      );
    }
    if (filters.project) {
      filtered = filtered.filter(c => c.interests.some(i => i.projectName === filters.project));
    }
    if (filters.channel) {
      filtered = filtered.filter(c => c.channel?.toLowerCase() === filters.channel.toLowerCase());
    }
    if (filters.owner) {
      filtered = filtered.filter(c => c.ownerUserId === filters.owner);
    }
    if (filters.unassignedOnly) {
      filtered = filtered.filter(c => c.interests.length === 0);
    }
    if (filters.status) {
      filtered = filtered.filter(c => c.intakeStatus === filters.status);
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const currentUserId = sessionData?.session?.user?.id || 'admin-user';
    const roleRaw = (sessionData?.session?.user?.user_metadata?.role || 'admin').toLowerCase();
    const userRole = (['sales', 'admin', 'owner'].includes(roleRaw) ? roleRaw : 'admin') as any;

    return {
      actor: {
        userId: currentUserId,
        role: userRole
      },
      projects,
      salesOwners,
      customers: filtered,
      page: 0,
      hasMore: false,
      search: {
        contractVersion: 'central_search_v1',
        filters,
        projects: projectNames,
        owners: salesOwners,
        channels,
        hasMoreChannels: false
      }
    };
  } catch (err) {
    // If direct Supabase fetch fails, fallback to centralApi.read
    return await centralApi.read(page, filters);
  }
}

export default function CentralLeadsView({ 
  api = centralApi, 
  visitsEnabled = false, 
  leadWorkEnabled = false, 
  workScheduleEnabled = false, 
  notificationsEnabled = false, 
  slaPreviewEnabled = false, 
  queueMonitorEnabled = false, 
  bookingEnabled = false, 
  projectSalesEnabled = false, 
  reportsEnabled = projectSalesEnabled,
  embedded = false,
  onBack
}: { 
  api?: CentralApi; 
  visitsEnabled?: boolean; 
  leadWorkEnabled?: boolean; 
  workScheduleEnabled?: boolean; 
  notificationsEnabled?: boolean; 
  slaPreviewEnabled?: boolean; 
  queueMonitorEnabled?: boolean; 
  bookingEnabled?: boolean; 
  projectSalesEnabled?: boolean; 
  reportsEnabled?: boolean;
  embedded?: boolean;
  onBack?: () => void;
}) {
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [filters, setFilters] = useState({ ...EMPTY_TRACKER_FILTERS });
  const [appliedFilters, setAppliedFilters] = useState({ ...EMPTY_TRACKER_FILTERS });
  const [filterError, setFilterError] = useState('');
  const identityEpoch = useRef(0);
  const [formEpoch, setFormEpoch] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState('');
  const key = `${page}:${revision}:${JSON.stringify(appliedFilters)}`;
  const [state, setState] = useState<{ key: string; api?: CentralApi; data: CentralSearchSnapshot | null; error: Error | null }>(() => {
    const cached = snapshotCache.get(key);
    return cached ? { key, api, data: cached, error: null } : { key: '', data: null, error: null };
  });
  const current = state.key === key && state.api === api;
  const snapshot = current ? state.data : null;
  const error = current ? state.error : null;

  const handleCreateLead = async (input: CentralCreateInput, expectedActor: string): Promise<CentralCreateResult> => {
    try {
      const { data, error } = await supabase.from('leads').insert([{
        customer_name: input.name,
        phone: input.phone,
        channel: input.channel,
        notes: input.notes,
        project_name: input.interests?.[0]?.projectName || null,
        interested_plot_name: input.interests?.[0]?.plotId || null,
        agent_name: input.assignedSalesUserId || 'Sales',
        status: 'Lead เข้า',
        crm_status: 'Follow-up — อยู่ระหว่างติดตาม',
        created_at: new Date().toISOString()
      }]).select('id').single();

      if (error) throw error;
      return { customerId: data.id, replayed: false };
    } catch {
      return await api.create(input, expectedActor);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const epoch = identityEpoch.current;
    fetchCentralLeadsSnapshot(page, appliedFilters, api).then(data => {
      if (!cancelled && epoch === identityEpoch.current) {
        snapshotCache.set(key, data);
        setState({ key, api, data, error: null });
      }
    }).catch(failure => {
      if (!cancelled && epoch === identityEpoch.current) {
        setState({ key, api, data: null, error: failure instanceof Error ? failure : new Error('โหลดรายการไม่สำเร็จ') });
      }
    });
    return () => { cancelled = true; };
  }, [api, page, key, appliedFilters]);

  useEffect(() => api.watchIdentity?.(() => {
    snapshotCache.clear();
    identityEpoch.current += 1;
    setShowForm(false); setNotice('บัญชีเปลี่ยนแล้ว แบบฟอร์มที่ยังไม่ส่งถูกปิด หากเคยส่งคำขอค้าง ให้กลับบัญชีเดิมและเปิดบันทึก Lead ใหม่เพื่อตรวจคำขอเดิม'); setFilterError(''); setFilters({ ...EMPTY_TRACKER_FILTERS });
    setAppliedFilters({ ...EMPTY_TRACKER_FILTERS }); setPage(0); setRevision(n => n + 1);
  }), [api]);

  const applyFilters = (next: CentralSearchFilters) => {
    if (showForm) return;
    try {
      const normalized = parseCentralSearchFilters(next);
      setFilters(normalized); setAppliedFilters(normalized); setPage(0); setFilterError(''); setRevision(n => n + 1);
    } catch (failure) { setFilterError(failure instanceof Error ? failure.message : 'ตัวกรองไม่ถูกต้อง'); }
  };

  const needsLogin = error instanceof CentralApiError && error.status === 401;
  const needsSetup = error instanceof CentralApiError && ['SETUP_REQUIRED', 'FEATURE_DISABLED'].includes(error.code);
  const forbidden = error instanceof CentralApiError && error.status === 403;

  return (
    <main className="min-h-screen bg-slate-50/70 pb-16">
      {/* 🌟 Modern BuildTrack Navigation Header */}
      <header className="border-b border-slate-200/90 bg-white shadow-2xs">
        <div className="mx-auto max-w-screen-2xl px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm font-black">
                <Building2 size={22} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-black text-slate-900 tracking-tight sm:text-xl">Lead ส่วนกลาง</h1>
                  <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-700 border border-blue-100 uppercase">
                    BuildTrack CRM
                  </span>
                </div>
                <p className="text-xs text-slate-500 font-medium">ศูนย์กลางข้อมูลลูกค้าและติดตามงานขายทุกโครงการ</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {!embedded && (
                showForm ? (
                  <span aria-disabled="true" className="text-xs font-semibold text-slate-400 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50">
                    ← กลับ BuildTrack (ปิดแบบฟอร์มก่อน)
                  </span>
                ) : onBack ? (
                  <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 hover:text-blue-700 transition-colors shadow-2xs cursor-pointer">
                    <ArrowLeft size={14} /> ← กลับ BuildTrack
                  </button>
                ) : (
                  <Link href="/" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 hover:text-blue-700 transition-colors shadow-2xs">
                    <ArrowLeft size={14} /> ← กลับ BuildTrack
                  </Link>
                )
              )}

              {snapshot && notificationsEnabled && !showForm && (
                <Link href="/sales-crm/notifications" prefetch={false} className="inline-flex items-center gap-1 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100 transition-colors shadow-2xs">
                  <Bell size={13} /> การแจ้งเตือนของฉัน →
                </Link>
              )}

              {snapshot && (
                <span className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100/80 px-2.5 py-1 text-[11px] font-bold text-slate-700">
                  <Shield size={12} className="text-slate-500" />
                  {snapshot.actor.role.toUpperCase()}
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-screen-2xl px-4 py-5 sm:px-6 space-y-4">
        <LeadTrackerHeader subtitle="ลูกค้าคนเดียว · สนใจได้หลายโครงการ · เก็บประวัติต่อเนื่อง" actions={
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={!snapshot || snapshot.actor.role === 'owner' || showForm}
                  onClick={() => { setNotice(''); setFormEpoch(identityEpoch.current); setShowForm(true); }} className="rounded-xl bg-blue-700 hover:bg-blue-800 text-white px-5 py-2.5 text-xs font-black shadow-sm disabled:opacity-40 transition-colors flex items-center gap-1.5">
                  + บันทึก Lead ใหม่
                </button>
              </div>
            } />

            {notice && <p role="status" className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-xs font-bold text-emerald-800 flex items-center gap-2 animate-in fade-in"><CheckCircle size={16} /> {notice}</p>}
            {!current && (
              <div role="status" className="rounded-2xl border border-slate-200 bg-white p-8 shadow-2xs space-y-6">
                <div className="flex items-center justify-center gap-3 py-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                    <Loader2 size={20} className="animate-spin text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-800">กำลังตรวจสิทธิ์และโหลดข้อมูล Lead ส่วนกลาง…</p>
                    <p className="text-xs text-slate-400 font-medium">ดึงข้อมูลสถานะล่าสุดจากฐานข้อมูลระบบ</p>
                  </div>
                </div>
                <div className="space-y-3 animate-pulse">
                  <div className="h-10 bg-slate-100 rounded-xl w-full"></div>
                  <div className="h-14 bg-slate-50 border border-slate-100 rounded-xl w-full"></div>
                  <div className="h-14 bg-slate-50 border border-slate-100 rounded-xl w-full"></div>
                  <div className="h-14 bg-slate-50 border border-slate-100 rounded-xl w-full"></div>
                </div>
              </div>
            )}
            {error && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 space-y-3">
              <h2 className="font-bold text-lg text-amber-950">{needsLogin ? 'เข้าสู่ระบบก่อนใช้งาน' : needsSetup ? 'ยังไม่เปิดการบันทึก Lead ส่วนกลาง' : forbidden ? 'บัญชีนี้ยังไม่มีสิทธิ์ใช้งาน' : 'โหลดรายการ Lead ไม่สำเร็จ'}</h2>
              <p role="alert" className="text-sm text-amber-900">{error.message}</p>
              {needsSetup && <p className="text-sm text-amber-900">หน้านี้ไม่สร้างข้อมูลลงระบบเก่าแทนเมื่อระบบใหม่ยังไม่พร้อม ต้องตรวจข้อมูลเดิม ติดตั้งฐานข้อมูล และยืนยันสิทธิ์ก่อนเปิดใช้</p>}
              <div className="flex flex-wrap gap-4 text-sm items-center">
                <button type="button" onClick={() => setRevision(n => n + 1)} className="font-semibold underline">ตรวจสอบอีกครั้ง</button>
                <Link href="/" className="underline">กลับหน้าหลัก{needsLogin ? 'เพื่อเข้าสู่ระบบ' : ''}</Link>
              </div>
            </section>}

            {snapshot && <>


              {/* 🌟 Admin Tools Panel (เฉพาะ Admin) */}
              {!showForm && snapshot.actor.role === 'admin' && (queueMonitorEnabled || slaPreviewEnabled || workScheduleEnabled) && (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-3 text-xs">
                  <span className="font-bold text-slate-600 flex items-center gap-1"><Shield size={14} className="text-blue-600" /> เครื่องมือผู้ดูแล (Admin):</span>
                  {queueMonitorEnabled && <Link href="/sales-crm/queue-monitor" prefetch={false} className="rounded-lg border border-slate-300 bg-white hover:bg-slate-100 px-2.5 py-1 text-xs font-bold text-blue-700 transition-colors">ตรวจคิวแจ้งเตือน (Admin) →</Link>}
                  {slaPreviewEnabled && <Link href="/sales-crm/sla-processing" prefetch={false} className="rounded-lg border border-slate-300 bg-white hover:bg-slate-100 px-2.5 py-1 text-xs font-bold text-blue-700 transition-colors">ประมวลผลและตรวจใบรับ (Admin) →</Link>}
                  {slaPreviewEnabled && <Link href="/sales-crm/sla-preview" prefetch={false} className="rounded-lg border border-slate-300 bg-white hover:bg-slate-100 px-2.5 py-1 text-xs font-bold text-blue-700 transition-colors">ตรวจแผนแจ้งเตือน (Admin) →</Link>}
                  {workScheduleEnabled && <Link href="/sales-crm/work-schedule" prefetch={false} className="rounded-lg border border-slate-300 bg-white hover:bg-slate-100 px-2.5 py-1 text-xs font-bold text-blue-700 transition-colors">จัดเวรฝ่ายขาย (Admin) →</Link>}
                </div>
              )}

              {snapshot.actor.role === 'owner' && <p className="text-xs text-slate-500 font-medium px-1">สิทธิ์ Owner: อ่านข้อมูลทุกโครงการ ไม่มีสิทธิ์สร้างหรือแก้ Lead</p>}

              {/* 🌟 Modal Dialog for "+ บันทึก Lead ใหม่" */}
              {showForm && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center p-3 sm:p-5 bg-slate-950/70 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-200">
                  <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[90vh] my-auto animate-in zoom-in-95 duration-200">
                    <CentralLeadForm snapshot={snapshot} save={handleCreateLead} onClose={() => setShowForm(false)} onSaved={() => {
                      if (formEpoch !== identityEpoch.current) return;
                      setShowForm(false); setNotice('บันทึก Lead ส่วนกลางแล้ว ผู้ดูแลและโครงการที่สนใจถูกบันทึกในคำขอเดียวกัน'); setFilters({ ...EMPTY_TRACKER_FILTERS }); setAppliedFilters({ ...EMPTY_TRACKER_FILTERS }); setPage(0); setRevision(n => n + 1);
                    }} />
                  </div>
                </div>
              )}

              <section>
                {filterError && <p role="alert" className="mb-3 text-xs font-bold text-red-700">{filterError}</p>}
                <CentralLeadTracker snapshot={snapshot} filters={filters} onFilterChange={setFilters} onApply={applyFilters} visitsEnabled={visitsEnabled} leadWorkEnabled={leadWorkEnabled} bookingEnabled={bookingEnabled} disabled={showForm} />
                <div className="border-t border-slate-200 p-4 flex items-center justify-between text-xs font-bold text-slate-700">
                  <button type="button" disabled={page === 0 || showForm} onClick={() => setPage(n => n - 1)} className="rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3 py-1.5 disabled:opacity-30 transition-colors">← ก่อนหน้า</button>
                  <span className="text-slate-500 font-medium">หน้า {page + 1} · หน้าละ 50 รายการ</span>
                  <button type="button" disabled={!snapshot.hasMore || showForm} onClick={() => setPage(n => n + 1)} className="rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3 py-1.5 disabled:opacity-30 transition-colors">ถัดไป →</button>
                </div>
              </section>
            </>}
      </div>
    </main>
  );
}
