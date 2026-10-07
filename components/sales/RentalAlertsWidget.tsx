"use client";

import React, { useState, useEffect } from 'react';
import { 
  AlertTriangle, 
  Clock, 
  Calendar, 
  CreditCard, 
  Phone, 
  Key, 
  CheckCircle2, 
  ArrowRight, 
  Sparkles, 
  RefreshCw,
  Home,
  User,
  ExternalLink,
  ChevronRight,
  ShieldAlert,
  BellRing
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { RentalAlertItem, RentalContract } from '@/types/sales';
import { parseDateParts } from '@/lib/rentalHelper';

interface RentalAlertsWidgetProps {
  projectName?: string;
  onOpenContractAction?: (contractId: string, plotId: string, leadId?: string) => void;
  onOpenPaymentLedger?: (contractId: string, plotId: string, leadId?: string) => void;
  onRefreshParent?: () => void;
}

export default function RentalAlertsWidget({
  projectName,
  onOpenContractAction,
  onOpenPaymentLedger,
  onRefreshParent
}: RentalAlertsWidgetProps) {
  const [alerts, setAlerts] = useState<RentalAlertItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'all' | 'expiry' | 'overdue'>('all');

  const fetchAlerts = async (isCancelled = false) => {
    setLoading(true);
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const todayDate = new Date(todayStr);

      const items: RentalAlertItem[] = [];

      // 1. Fetch Active Rental Contracts for Expiry Check
      let contractsQuery = supabase
        .from('rental_contracts')
        .select('*')
        .eq('status', 'Active');

      if (projectName && projectName !== 'all') {
        contractsQuery = contractsQuery.eq('project_name', projectName);
      }

      const { data: contracts } = await contractsQuery;

      if (contracts && contracts.length > 0) {
        contracts.forEach((c: RentalContract) => {
          if (!c.lease_end_date) return;
          const endDate = new Date(c.lease_end_date);
          const diffMs = endDate.getTime() - todayDate.getTime();
          const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

          if (diffDays <= 30 && diffDays >= 0) {
            items.push({
              id: `exp-30-${c.id}`,
              type: 'lease_expiring_30',
              title: `สัญญาจะหมดอายุในอีก ${diffDays} วัน`,
              description: `แปลง ${c.plot_name || c.plot_id} • แนะนำติดต่อเสนอ "ต่อสัญญา" หรือ "เปลี่ยนเป็นซื้อ (Rent to Own)"`,
              plotId: c.plot_id,
              plotName: c.plot_name || c.plot_id,
              projectName: c.project_name,
              tenantName: c.tenant_name,
              tenantPhone: c.tenant_phone || undefined,
              leadId: c.lead_id || undefined,
              contractId: c.id,
              dueDateOrExpiry: c.lease_end_date,
              amount: Number(c.monthly_rent || 0),
              severity: 'danger'
            });
          } else if (diffDays <= 60 && diffDays > 30) {
            items.push({
              id: `exp-60-${c.id}`,
              type: 'lease_expiring_60',
              title: `สัญญาจะหมดอายุใน ${diffDays} วัน (เตือนล่วงหน้า)`,
              description: `แปลง ${c.plot_name || c.plot_id} • เตรียมติดตามความประสงค์ของผู้เช่า`,
              plotId: c.plot_id,
              plotName: c.plot_name || c.plot_id,
              projectName: c.project_name,
              tenantName: c.tenant_name,
              tenantPhone: c.tenant_phone || undefined,
              leadId: c.lead_id || undefined,
              contractId: c.id,
              dueDateOrExpiry: c.lease_end_date,
              amount: Number(c.monthly_rent || 0),
              severity: 'warning'
            });
          }
        });
      }

      // 2. Fetch Overdue Rental Payments
      let paymentsQuery = supabase
        .from('rental_payments')
        .select('*')
        .or(`payment_status.eq.Overdue,and(payment_status.eq.Pending,due_date.lt.${todayStr})`);

      if (projectName && projectName !== 'all') {
        paymentsQuery = paymentsQuery.eq('project_name', projectName);
      }

      const { data: overduePayments } = await paymentsQuery.order('due_date', { ascending: true });

      if (overduePayments && overduePayments.length > 0) {
        overduePayments.forEach((p: any) => {
          items.push({
            id: `overdue-${p.id || `${p.plot_id}-${p.period_month}`}`,
            type: 'rent_overdue',
            title: `ค้างชำระค่าเช่า ${p.period_label || `งวดที่ ${p.period_month}`}`,
            description: `ครบกำหนดเมื่อ ${p.due_date} • ยอดค้าง ฿${Number(p.amount_due || 0).toLocaleString()} บาท`,
            plotId: p.plot_id,
            plotName: p.plot_name || p.plot_id,
            projectName: p.project_name,
            tenantName: p.tenant_name,
            tenantPhone: p.tenant_phone || undefined,
            leadId: p.lead_id || undefined,
            contractId: p.contract_id || undefined,
            dueDateOrExpiry: p.due_date,
            amount: Number(p.amount_due || 0),
            severity: 'danger'
          });
        });
      }

      if (!isCancelled) {
        setAlerts(items);
      }
    } catch (err) {
      console.error('Error fetching rental alerts:', err);
    } finally {
      if (!isCancelled) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    let isCancelled = false;
    fetchAlerts(isCancelled);
    return () => {
      isCancelled = true;
    };
  }, [projectName]);

  const expiryCount = alerts.filter(a => a.type.startsWith('lease_expiring')).length;
  const overdueCount = alerts.filter(a => a.type === 'rent_overdue').length;

  const filteredAlerts = alerts.filter(a => {
    if (selectedTab === 'expiry') return a.type.startsWith('lease_expiring');
    if (selectedTab === 'overdue') return a.type === 'rent_overdue';
    return true;
  });

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4 space-y-3.5">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-amber-50 text-amber-600 border border-amber-200/60">
            <BellRing size={17} className="animate-bounce" />
          </div>
          <div>
            <h3 className="font-black text-sm text-slate-800 flex items-center gap-2">
              🚨 ศูนย์แจ้งเตือนสัญญาเช่า & ค่างวด (Rental Alerts)
            </h3>
            <p className="text-[11px] text-slate-500">
              แจ้งเตือนสัญญาใกล้หมดอายุ & ค้างชำระค่าเช่า เพื่อให้ทีมขายติดตามได้ทันเวลา
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 self-end sm:self-auto">
          <button
            type="button"
            onClick={() => fetchAlerts()}
            disabled={loading}
            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            title="รีเฟรชการแจ้งเตือน"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Filter Tabs & Counters */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setSelectedTab('all')}
          className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
            selectedTab === 'all'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          ทั้งหมด ({alerts.length})
        </button>

        <button
          type="button"
          onClick={() => setSelectedTab('expiry')}
          className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
            selectedTab === 'expiry'
              ? 'bg-amber-600 text-white shadow-xs'
              : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200/60'
          }`}
        >
          <Clock size={13} /> สัญญาใกล้หมด ({expiryCount})
        </button>

        <button
          type="button"
          onClick={() => setSelectedTab('overdue')}
          className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
            selectedTab === 'overdue'
              ? 'bg-rose-600 text-white shadow-xs'
              : 'bg-rose-50 text-rose-800 hover:bg-rose-100 border border-rose-200/60'
          }`}
        >
          <CreditCard size={13} /> ค้างชำระ ({overdueCount})
        </button>
      </div>

      {/* Alert Items List */}
      <div className="space-y-2">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            <RefreshCw size={18} className="animate-spin mx-auto mb-2 text-slate-300" />
            กำลังตรวจสอบสัญญาและงวดที่ค้างชำระ...
          </div>
        ) : filteredAlerts.length === 0 ? (
          <div className="p-6 bg-emerald-50/50 border border-emerald-200/60 rounded-2xl text-center space-y-1">
            <CheckCircle2 size={24} className="text-emerald-600 mx-auto" />
            <div className="font-bold text-xs text-emerald-900">ไม่มีรายการแจ้งเตือนด่วน</div>
            <div className="text-[10px] text-emerald-700">สัญญาเช่าและค่างวดทุกแปลงอยู่ในสถานะปกติเรียบร้อย</div>
          </div>
        ) : (
          filteredAlerts.map((alert) => {
            const isExpiry = alert.type.startsWith('lease_expiring');
            return (
              <div 
                key={alert.id}
                className={`p-3 sm:p-3.5 rounded-2xl border transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                  alert.severity === 'danger'
                    ? 'bg-rose-50/70 border-rose-200 text-slate-800'
                    : 'bg-amber-50/70 border-amber-200 text-slate-800'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
                      alert.severity === 'danger'
                        ? 'bg-rose-600 text-white'
                        : 'bg-amber-600 text-white'
                    }`}>
                      {isExpiry ? '⏳ หมดอายุ' : '⚠️ ค้างจ่าย'}
                    </span>
                    <span className="font-bold text-xs text-slate-900">
                      {alert.title}
                    </span>
                    <span className="text-[10px] bg-white px-2 py-0.5 rounded-full border border-slate-200 font-bold text-slate-700">
                      แปลง {alert.plotName}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-600">
                    ผู้เช่า: <b className="text-slate-900">{alert.tenantName}</b> {alert.tenantPhone && <span className="text-slate-500 font-mono">({alert.tenantPhone})</span>} • {alert.description}
                  </p>
                </div>

                {/* Quick Action Buttons */}
                <div className="flex items-center gap-1.5 self-end sm:self-auto shrink-0 text-xs">
                  {alert.tenantPhone && (
                    <a
                      href={`tel:${alert.tenantPhone}`}
                      className="p-1.5 sm:px-2.5 sm:py-1 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold flex items-center gap-1 transition-colors"
                      title="โทรหาผู้เช่า"
                    >
                      <Phone size={13} className="text-emerald-600" />
                      <span className="hidden sm:inline">โทร</span>
                    </a>
                  )}

                  {isExpiry ? (
                    <button
                      type="button"
                      onClick={() => onOpenContractAction && onOpenContractAction(alert.contractId || '', alert.plotId, alert.leadId)}
                      className="px-3 py-1 rounded-xl bg-gradient-to-r from-blue-700 to-indigo-700 hover:from-blue-800 hover:to-indigo-800 text-white font-bold flex items-center gap-1 shadow-xs transition-colors cursor-pointer"
                    >
                      <Key size={13} /> จัดการสัญญา
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpenPaymentLedger && onOpenPaymentLedger(alert.contractId || '', alert.plotId, alert.leadId)}
                      className="px-3 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1 shadow-xs transition-colors cursor-pointer"
                    >
                      <CreditCard size={13} /> รับชำระ
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

    </div>
  );
}
