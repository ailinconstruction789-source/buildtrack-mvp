import React, { useState, useMemo } from 'react';
import { Calendar, Home, TrendingUp, DollarSign, CalendarDays, Users, Lightbulb, Target, MapIcon, Flame, ClipboardCheck, AlertTriangle } from 'lucide-react';
import { STATUS_CONFIG } from './SalesKanban';
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';

interface SalesReportsProps {
  leads: any[];
  projectName: string;
  viewType?: 'reports' | 'agent';
}

export default function SalesReports({ leads, projectName, viewType = 'reports' }: SalesReportsProps) {
  const [reportType, setReportType] = useState<'booking' | 'transfer' | 'agent'>(viewType === 'agent' ? 'agent' : 'booking');
  const [bookingYear, setBookingYear] = useState<string>(new Date().getFullYear().toString());
  const [transferYear, setTransferYear] = useState<string>(new Date().getFullYear().toString());
  const [selectedAgentForChart, setSelectedAgentForChart] = useState<string>('all');

  // Helper to format currency
  const formatMoney = (val: number) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);

  // Parse and group bookings
  const bookingSummary = useMemo(() => {
    const bookedLeads = leads.filter(l => l.bookingDate && ['Reserved', 'Contracted', 'DownPayment', 'DocumentPrep', 'LoanProcessing', 'Approved', 'Transferred', 'Handover'].includes(l.status));
    
    // Group by YYYY-MM
    const grouped = bookedLeads.reduce((acc, lead) => {
      const date = new Date(lead.bookingDate);
      const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!acc[yearMonth]) acc[yearMonth] = { items: [], totalValue: 0, count: 0 };
      acc[yearMonth].items.push(lead);
      acc[yearMonth].totalValue += (lead.salePrice || 0);
      acc[yearMonth].count += 1;
      return acc;
    }, {} as Record<string, { items: any[], totalValue: number, count: number }>);
    
    // Sort keys descending
    const sortedKeys = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
    
    // Extract unique years
    const uniqueYears = Array.from(new Set(sortedKeys.map(k => k.split('-')[0]))).sort((a, b) => b.localeCompare(a));
    
    return { grouped, sortedKeys, uniqueYears };
  }, [leads]);

  // Parse and group transfers
  const transferSummary = useMemo(() => {
    const transferredLeads = leads.filter(l => ['Transferred', 'Handover'].includes(l.status));
    
    // Group by YYYY-MM
    const grouped = transferredLeads.reduce((acc, lead) => {
      const transferHistory = lead.history?.find((h: any) => h.status === 'Transferred');
      const transferDateStr = transferHistory?.timestamp?.split('T')[0] || lead.expectedTransferDate;
      const date = transferDateStr ? new Date(transferDateStr) : null;
      const yearMonth = date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` : 'Unknown';
      
      if (!acc[yearMonth]) acc[yearMonth] = { items: [], totalValue: 0, count: 0 };
      acc[yearMonth].items.push({ ...lead, actualTransferDate: transferDateStr });
      acc[yearMonth].totalValue += (lead.salePrice || 0);
      acc[yearMonth].count += 1;
      return acc;
    }, {} as Record<string, { items: any[], totalValue: number, count: number }>);

    // Sort keys descending
    const sortedKeys = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
    
    // Extract unique years
    const uniqueYears = Array.from(new Set(sortedKeys.map(k => k === 'Unknown' ? 'Unknown' : k.split('-')[0]))).sort((a, b) => b.localeCompare(a));
    
    return { grouped, sortedKeys, uniqueYears };
  }, [leads]);

  // Parse and group by Agent
  const agentSummary = useMemo(() => {
    const now = new Date();
    const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthPrefix = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;
    
    const grouped = leads.reduce((acc, lead) => {
      const agent = lead.agentName || 'ไม่ระบุ';
      if (!acc[agent]) {
        acc[agent] = {
          name: agent,
          projects: {},
          totalSalesValue: 0,
          soldUnits: 0,
          newLeadsThisMonth: 0,
          transfersThisMonth: 0,
          totalLeads: 0,
          reservedCount: 0,
          transferredCount: 0,
          totalDaysToLoan: 0,
          countToLoan: 0,
          activeLeadsThisMonth: 0,
          cancelledReservationsCount: 0,
          reservedThisMonth: 0,
          reservedLastMonth: 0,
          visitsTotal: 0
        };
      }
      
      const stats = acc[agent];
      stats.totalLeads += 1;
      
      // Is new lead this month?
      const createdDateStr = lead.created_at || (lead.history && lead.history[0]?.timestamp) || '';
      const createdMonth = createdDateStr ? createdDateStr.substring(0, 7) : '';
      if (createdMonth === currentMonthPrefix) {
        stats.newLeadsThisMonth += 1;
      }
      
      // Calculate Days from Reserved to LoanProcessing
      if (lead.history && lead.history.length > 0) {
        let isActiveThisMonth = false;
        
        const reservedEvent = lead.history.find((h: any) => h.status === 'Reserved');
        const loanEvent = lead.history.find((h: any) => h.status === 'LoanProcessing');
        if (reservedEvent && loanEvent) {
          const rDate = new Date(reservedEvent.timestamp);
          const lDate = new Date(loanEvent.timestamp);
          const diffTime = lDate.getTime() - rDate.getTime();
          if (diffTime > 0) {
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            stats.totalDaysToLoan += diffDays;
            stats.countToLoan += 1;
          }
        }
        
        // Track Active Pipeline Movement (Did they push any status forward this month?)
        for (const h of lead.history) {
          if (h.timestamp && h.timestamp.startsWith(currentMonthPrefix)) {
            if (h.status !== 'New') {
              isActiveThisMonth = true;
              break;
            }
          }
        }
        
        if (isActiveThisMonth) {
          stats.activeLeadsThisMonth += 1;
        }
      }
      
      // 1. Check if they EVER reserved (for reservedCount tracking regardless of cancellation)
      const activeSalesStatuses = ['Reserved', 'Contracted', 'DownPayment', 'DocumentPrep', 'LoanProcessing', 'Approved', 'Transferred', 'Handover'];
      const hasReservedInHistory = lead.history && lead.history.some((h: any) => activeSalesStatuses.includes(h.status));
      const isCurrentlyActiveSale = activeSalesStatuses.includes(lead.status);
      const isCancelled = lead.status === 'Cancelled';
      
      // If they are currently active, or have history of being active, OR are currently 'Cancelled' (ยกเลิกจอง - which implies a booking cancellation)
      if (hasReservedInHistory || isCurrentlyActiveSale || isCancelled) {
        stats.reservedCount += 1; // Count ALL reservation attempts
        
        // If they are Cancelled, count them as cancelled reservations
        if (isCancelled) {
          stats.cancelledReservationsCount += 1;
        }

        // Determine when they reserved for MoM and Target metrics
        const reservedEvent = lead.history?.find((h: any) => h.status === 'Reserved') || lead.history?.find((h: any) => activeSalesStatuses.includes(h.status));
        if (reservedEvent && reservedEvent.timestamp) {
          if (reservedEvent.timestamp.startsWith(currentMonthPrefix)) {
            stats.reservedThisMonth += 1;
          } else if (reservedEvent.timestamp.startsWith(lastMonthPrefix)) {
            stats.reservedLastMonth += 1;
          }
        }
      }

      // Count Visits for Visit-to-Booking Rate
      const hasVisited = lead.history?.some((h: any) => h.status === 'Visit') || lead.status === 'Visit';
      // If a lead jumped straight to Reserved without a Visit status, we still consider them a 'Visit' conceptually for the funnel.
      if (hasVisited || hasReservedInHistory || isCurrentlyActiveSale) {
        stats.visitsTotal += 1;
      }

      // 2. Check Active Sales (for sold units and sales value)
      if (isCurrentlyActiveSale) {
        stats.soldUnits += 1;
        stats.totalSalesValue += (lead.salePrice || 0);
        if (lead.project) {
          stats.projects[lead.project] = (stats.projects[lead.project] || 0) + 1;
        }
      }
      
      // 3. Check Transfers
      if (['Transferred', 'Handover'].includes(lead.status)) {
        stats.transferredCount += 1;
        
        // Transferred this month?
        const transferHistory = lead.history?.find((h: any) => h.status === 'Transferred');
        const transferDate = transferHistory?.timestamp?.split('T')[0] || lead.expectedTransferDate || '';
        if (transferDate.startsWith(currentMonthPrefix)) {
          stats.transfersThisMonth += 1;
        }
      }
      
      return acc;
    }, {} as Record<string, any>);
    
    return Object.values(grouped).sort((a: any, b: any) => b.totalSalesValue - a.totalSalesValue);
  }, [leads]);
  // YoY Chart Data
  const { yoyData, availableYears, uniqueAgents } = useMemo(() => {
    // 1. Get unique agents
    const agents = new Set<string>();
    leads.forEach(l => {
      if (l.agentName && l.agentName !== 'ไม่ระบุ') agents.add(l.agentName);
    });

    // 2. Filter leads by selected agent
    let filteredLeads = leads;
    if (selectedAgentForChart !== 'all') {
      filteredLeads = leads.filter(l => l.agentName === selectedAgentForChart);
    }

    // 3. Find all reservations (active or cancelled)
    const reservedLeads = filteredLeads.filter(lead => {
      const activeSalesStatuses = ['Reserved', 'Contracted', 'DownPayment', 'DocumentPrep', 'LoanProcessing', 'Approved', 'Transferred', 'Handover'];
      const hasReservedInHistory = lead.history && lead.history.some((h: any) => activeSalesStatuses.includes(h.status));
      const isCurrentlyActiveSale = activeSalesStatuses.includes(lead.status);
      const isCancelled = lead.status === 'Cancelled';
      return hasReservedInHistory || isCurrentlyActiveSale || isCancelled;
    });

    // 4. Group by Month and Year
    const monthlyData: Record<number, Record<string, number>> = {};
    for (let i = 1; i <= 12; i++) monthlyData[i] = {}; // Initialize 1-12

    const years = new Set<string>();

    reservedLeads.forEach(lead => {
      // Use bookingDate or fallback to created_at
      const dateString = lead.bookingDate || lead.created_at;
      if (!dateString) return;
      
      const date = new Date(dateString);
      const year = date.getFullYear().toString();
      const month = date.getMonth() + 1; // 1-12

      years.add(year);
      monthlyData[month][year] = (monthlyData[month][year] || 0) + 1;
    });

    // 5. Format for Recharts
    const monthNames = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const formattedData = monthNames.map((name, index) => {
      const monthNum = index + 1;
      const dataPoint: any = { name };
      Array.from(years).forEach(y => {
        dataPoint[y] = monthlyData[monthNum][y] || 0;
      });
      return dataPoint;
    });

    return {
      yoyData: formattedData,
      availableYears: Array.from(years).sort(),
      uniqueAgents: Array.from(agents).sort()
    };
  }, [leads, selectedAgentForChart]);

  return (
    <div className="h-full bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col animate-in fade-in slide-in-from-bottom-2">
      {/* Header & Tabs */}
      {viewType !== 'agent' && (
        <div className="border-b border-slate-200 bg-slate-50 p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <TrendingUp className="text-[#d4af37]" />
              รายงานสรุปยอด (Reports)
            </h2>
            <p className="text-xs text-slate-500 mt-1">สรุปข้อมูลการจองและการโอนกรรมสิทธิ์ โครงการ {projectName}</p>
          </div>
          
          <div className="flex bg-slate-200/60 p-1 rounded-xl w-max">
            <button 
              onClick={() => setReportType('booking')}
              className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${reportType === 'booking' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Calendar size={16} /> สรุปยอดจอง
            </button>
            <button 
              onClick={() => setReportType('transfer')}
              className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${reportType === 'transfer' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Home size={16} /> สรุปยอดโอน
            </button>
          </div>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6 bg-[#f8fafc]">
        
        {reportType === 'booking' && (
          <div className="space-y-8 max-w-6xl mx-auto">
            {bookingSummary.sortedKeys.length === 0 ? (
              <div className="text-center py-20 text-slate-400 font-medium">ยังไม่มีข้อมูลการจอง</div>
            ) : (() => {
              const availableBookingYears = bookingSummary.uniqueYears;
              const displayBookingYear = availableBookingYears.includes(bookingYear) ? bookingYear : (availableBookingYears[0] || new Date().getFullYear().toString());
              
              const filteredKeys = bookingSummary.sortedKeys.filter(k => k.split('-')[0] === displayBookingYear);
              
              return (
                <>
                  <div className="flex justify-end mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-600">เลือกปี:</span>
                      <select 
                        value={displayBookingYear}
                        onChange={(e) => setBookingYear(e.target.value)}
                        className="border border-slate-300 rounded-lg px-4 py-2 text-sm font-bold text-blue-700 bg-white cursor-pointer hover:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      >
                        {availableBookingYears.map(year => (
                          <option key={year} value={year}>
                            {parseInt(year) + 543}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  
                  {filteredKeys.length === 0 ? (
                    <div className="text-center py-20 text-slate-400 font-medium">ไม่มีข้อมูลในปีที่เลือก</div>
                  ) : (
                    filteredKeys.map(yearMonth => {
                      const data = bookingSummary.grouped[yearMonth];
                      const [year, month] = yearMonth.split('-');
                      const monthName = new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
                      
                      return (
                  <div key={yearMonth} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="bg-blue-50/50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                      <h3 className="font-bold text-blue-900 flex items-center gap-2 text-lg">
                        <CalendarDays className="text-blue-500" />
                        ยอดจองเดือน {monthName}
                      </h3>
                      <div className="flex gap-6">
                        <div className="text-right">
                          <div className="text-xs font-semibold text-slate-500">จำนวนที่จอง</div>
                          <div className="font-bold text-slate-800">{data.count} ยูนิต</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-semibold text-slate-500">มูลค่ารวม (โดยประมาณ)</div>
                          <div className="font-bold text-blue-600">{formatMoney(data.totalValue)}</div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-50 border-b border-slate-100">
                          <tr>
                            <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">วันที่จอง</th>
                            <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">โครงการ</th>
                            <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">รหัสแปลง</th>
                            <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">ลูกค้า</th>
                            <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">ราคา</th>
                            <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">สถานะ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {data.items.map((lead: any) => {
                            const statusCfg = STATUS_CONFIG[lead.status] || STATUS_CONFIG['Visit'];
                            const StatusIcon = statusCfg.icon;
                            return (
                              <tr key={lead.id} className="hover:bg-slate-50">
                                <td className="px-6 py-4 text-sm font-medium text-slate-700">{new Date(lead.bookingDate).toLocaleDateString('th-TH')}</td>
                                <td className="px-6 py-4 text-sm font-semibold text-slate-900">{lead.project || (projectName === 'ทุกโครงการ' ? 'ไม่ระบุ' : projectName)}</td>
                                <td className="px-6 py-4"><span className="text-xs font-bold bg-slate-100 px-2 py-1 rounded text-slate-700">{lead.plot || '-'}</span></td>
                                <td className="px-6 py-4 text-sm font-medium text-slate-800">{lead.name}</td>
                                <td className="px-6 py-4 text-sm font-semibold text-emerald-600">{formatMoney(lead.salePrice || 0)}</td>
                                <td className="px-6 py-4">
                                  <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold ${statusCfg.bg} ${statusCfg.color}`}>
                                    <StatusIcon size={12} /> {statusCfg.label}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })
            )}
            </>
            );
            })()}
          </div>
        )}

        {reportType === 'transfer' && (
          <div className="space-y-8 max-w-6xl mx-auto">
            {transferSummary.sortedKeys.length === 0 ? (
              <div className="text-center py-20 text-slate-400 font-medium">ยังไม่มีข้อมูลการโอนกรรมสิทธิ์</div>
            ) : (() => {
              const availableTransferYears = transferSummary.uniqueYears;
              const displayTransferYear = availableTransferYears.includes(transferYear) ? transferYear : (availableTransferYears[0] || new Date().getFullYear().toString());
              
              const filteredKeys = transferSummary.sortedKeys.filter(k => (k === 'Unknown' ? 'Unknown' : k.split('-')[0]) === displayTransferYear);
              
              return (
                <>
                  <div className="flex justify-end mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-600">เลือกปี:</span>
                      <select 
                        value={displayTransferYear}
                        onChange={(e) => setTransferYear(e.target.value)}
                        className="border border-slate-300 rounded-lg px-4 py-2 text-sm font-bold text-emerald-700 bg-white cursor-pointer hover:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                      >
                        {availableTransferYears.map(year => (
                          <option key={year} value={year}>
                            {year === 'Unknown' ? 'ไม่ระบุ' : parseInt(year) + 543}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  
                  {filteredKeys.length === 0 ? (
                    <div className="text-center py-20 text-slate-400 font-medium">ไม่มีข้อมูลในปีที่เลือก</div>
                  ) : (
                    filteredKeys.map(yearMonth => {
                      const data = transferSummary.grouped[yearMonth];
                      let title = '';
                      if (yearMonth === 'Unknown') {
                        title = 'ไม่ระบุเดือน/ปี';
                      } else {
                        const [year, month] = yearMonth.split('-');
                        const monthName = new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
                        title = `เดือน ${monthName}`;
                      }
                      
                      return (
                        <div key={yearMonth} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                          <div className="bg-emerald-50/50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                            <h3 className="font-bold text-emerald-900 flex items-center gap-2 text-lg">
                              <Home className="text-emerald-500" />
                              ยอดโอน {title}
                            </h3>
                      <div className="flex gap-6">
                        <div className="text-right">
                          <div className="text-xs font-semibold text-slate-500">จำนวนที่โอน</div>
                          <div className="font-bold text-slate-800">{data.count} ยูนิต</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-semibold text-slate-500">มูลค่ารวม (โดยประมาณ)</div>
                          <div className="font-bold text-emerald-600">{formatMoney(data.totalValue)}</div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-50 border-b border-slate-100">
                          <tr>
                            <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">วันที่โอน</th>
                            <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">โครงการ</th>
                            <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">รหัสแปลง</th>
                            <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">ลูกค้า</th>
                            <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">ราคา</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {data.items.map((lead: any) => {
                            return (
                              <tr key={lead.id} className="hover:bg-slate-50">
                                <td className="px-6 py-4 text-sm font-medium text-slate-700">{lead.actualTransferDate ? new Date(lead.actualTransferDate).toLocaleDateString('th-TH') : '-'}</td>
                                <td className="px-6 py-4 text-sm font-semibold text-slate-900">{lead.project || (projectName === 'ทุกโครงการ' ? 'ไม่ระบุ' : projectName)}</td>
                                <td className="px-6 py-4"><span className="text-xs font-bold bg-slate-100 px-2 py-1 rounded text-slate-700">{lead.plot || '-'}</span></td>
                                <td className="px-6 py-4 text-sm font-medium text-slate-800">{lead.name}</td>
                                <td className="px-6 py-4 text-sm font-semibold text-emerald-600">{formatMoney(lead.salePrice || 0)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })
            )}
            </>
            );
          })()}
          </div>
        )}

        {reportType === 'agent' && (
          <div className="space-y-8 max-w-[1400px] w-full mx-auto">
            {/* AI Executive Insights */}
            {(() => {
              const totalBookingsThisMonth = agentSummary.reduce((sum: number, a: any) => sum + a.reservedThisMonth, 0);
              const totalBookingsLastMonth = agentSummary.reduce((sum: number, a: any) => sum + a.reservedLastMonth, 0);
              const totalReservedCount = agentSummary.reduce((sum: number, a: any) => sum + a.reservedCount, 0);
              const totalCancelledCount = agentSummary.reduce((sum: number, a: any) => sum + a.cancelledReservationsCount, 0);
              const totalVisits = agentSummary.reduce((sum: number, a: any) => sum + a.visitsTotal, 0);
              
              const cancelRate = totalReservedCount > 0 ? Math.round((totalCancelledCount / totalReservedCount) * 100) : 0;
              const visitToBook = totalVisits > 0 ? Math.round((totalReservedCount / totalVisits) * 100) : 0;
              
              const sortedAgents = [...agentSummary].sort((a: any, b: any) => b.reservedThisMonth - a.reservedThisMonth);
              const topAgent: any = sortedAgents[0];
              
              const growth = totalBookingsLastMonth > 0 ? Math.round(((totalBookingsThisMonth - totalBookingsLastMonth) / totalBookingsLastMonth) * 100) : 0;

              return (
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl shadow-sm border border-blue-100 p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Lightbulb className="text-amber-500 fill-amber-100" size={24} />
                    <h3 className="text-lg font-black text-indigo-950 uppercase tracking-tight">Executive Insights</h3>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Momentum */}
                    <div className="bg-white/80 rounded-lg p-4 border border-blue-50">
                      <div className="flex items-center gap-2 text-blue-800 font-bold mb-2">
                        <TrendingUp size={18} /> ภาพรวมยอดจองเดือนนี้
                      </div>
                      <p className="text-sm text-slate-700 leading-relaxed">
                        เดือนนี้มียอดจองรวม <span className="font-bold text-blue-700 text-lg">{totalBookingsThisMonth}</span> หลัง 
                        {totalBookingsLastMonth > 0 ? (
                          totalBookingsThisMonth >= totalBookingsLastMonth ? (
                            <span className="text-emerald-600 font-bold"> (เติบโต {growth}% ▲ จากเดือนก่อน)</span>
                          ) : (
                            <span className="text-rose-500 font-bold"> (ลดลง {Math.abs(growth)}% ▼ จากเดือนก่อน)</span>
                          )
                        ) : null}
                      </p>
                    </div>

                    {/* Top Performer */}
                    <div className="bg-white/80 rounded-lg p-4 border border-blue-50">
                      <div className="flex items-center gap-2 text-emerald-700 font-bold mb-2">
                        <Target size={18} /> พนักงานขายดีเด่น
                      </div>
                      <p className="text-sm text-slate-700 leading-relaxed">
                        {topAgent && topAgent.reservedThisMonth > 0 ? (
                          <>
                            <span className="font-bold text-emerald-700">{topAgent.name}</span> ทำผลงานโดดเด่นสุดด้วยยอดจอง <span className="font-bold text-emerald-700">{topAgent.reservedThisMonth}</span> หลัง 
                            (คิดเป็น <span className="font-bold">{Math.round((topAgent.reservedThisMonth / 2) * 100)}%</span> ของเป้าหมาย)
                          </>
                        ) : (
                          <span className="text-slate-500">ยังไม่มียอดจองในเดือนนี้</span>
                        )}
                      </p>
                    </div>

                    {/* Risk & Bottleneck */}
                    <div className="bg-white/80 rounded-lg p-4 border border-blue-50">
                      <div className="flex items-center gap-2 text-rose-700 font-bold mb-2">
                        <AlertTriangle size={18} /> จุดที่ควรระวัง
                      </div>
                      <p className="text-sm text-slate-700 leading-relaxed">
                        {cancelRate > 15 ? (
                          <>อัตรายกเลิกจองอยู่ที่ <span className="font-bold text-rose-600">{cancelRate}%</span> ซึ่งค่อนข้างสูง ควรตรวจสอบสาเหตุการกู้ไม่ผ่านหรือความพร้อมของลูกค้าก่อนจอง</>
                        ) : visitToBook < 10 ? (
                          <>อัตราปิดการขายหน้างาน (Visit to Book) อยู่ที่ <span className="font-bold text-rose-600">{visitToBook}%</span> ควรเน้นเทรนนิ่งการปิดการขายให้กับทีมเซลส์</>
                        ) : (
                          <span className="text-emerald-600 font-bold">ภาพรวมคุณภาพลูกค้าและอัตราการปิดการขายอยู่ในเกณฑ์ดีเยี่ยม!</span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="bg-purple-50/50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <h3 className="font-bold text-purple-900 flex items-center gap-2 text-lg">
                  <Users className="text-purple-500" />
                  สรุปผลงานพนักงานขาย (Agent Performance)
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[1200px]">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">พนักงานขาย</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase min-w-[160px]">ผลงานแยกโครงการ</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">ยอดขายรวม (บาท)</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-center" title="เป้าหมายเดือนละ 2 ยอดจอง">ยอดจอง<br/>(เดือนนี้)</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-center" title="จำนวนลูกค้าที่วางจองทั้งหมด (นับรวมที่ยกเลิกด้วย)">ยอดจอง<br/>(สะสม)</th>
                      <th className="px-6 py-4 text-xs font-bold text-rose-500 uppercase text-center" title="อัตราส่วนลูกค้าที่จองแล้วยกเลิก">
                        อัตรายกเลิกจอง<br/>(Cancel Rate)
                        <div className="text-[10px] text-slate-400 font-normal mt-1 normal-case tracking-normal">(ยกเลิก ÷ จองสะสม)</div>
                      </th>
                      <th className="px-6 py-4 text-xs font-bold text-emerald-600 uppercase text-center">โอน<br/>(สะสม)</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-center" title="จำนวนลูกค้าที่มีการเปลี่ยนสถานะหรือติดตามงานในเดือนนี้">ตามงาน<br/>(เดือนนี้)</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-center">ลูกค้าที่รับ<br/>(ทั้งหมด)</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-center whitespace-nowrap" title="สัดส่วนจองสำเร็จจากลูกค้าเข้าชมทั้งหมด">
                        ปิดการขายหน้างาน<br/>(Visit to Book)
                        <div className="text-[10px] text-slate-400 font-normal mt-1 normal-case tracking-normal">(จองสะสม ÷ ลูกค้าทั้งหมด)</div>
                      </th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-center whitespace-nowrap" title="สัดส่วนลูกค้าที่โอนสำเร็จจากลูกค้าทั้งหมด">
                        อัตราปิดการขาย<br/>(Win Rate)
                        <div className="text-[10px] text-slate-400 font-normal mt-1 normal-case tracking-normal">(โอนสะสม ÷ ลูกค้าทั้งหมด)</div>
                      </th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-center whitespace-nowrap" title="ความเร็วเฉลี่ยในการเก็บเอกสารยื่นกู้">ความเร็วยื่นกู้<br/>(วันเฉลี่ย)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {agentSummary.map((agent: any) => (
                      <tr key={agent.name} className="hover:bg-slate-50">
                        <td className="px-6 py-4 font-bold text-slate-800">{agent.name}</td>
                        <td className="px-6 py-4">
                          {Object.entries(agent.projects).length > 0 ? (
                            <div className="space-y-1.5">
                              {Object.entries(agent.projects).map(([proj, count]: any) => (
                                <div key={proj} className="flex justify-between items-center text-[11px] gap-2">
                                  <span className="text-slate-500 truncate max-w-[100px]" title={proj}>{proj}</span>
                                  <span className="font-bold text-slate-700 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded whitespace-nowrap">{count} หลัง</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 font-bold text-purple-700 text-right">{formatMoney(agent.totalSalesValue)}</td>
                        
                        {/* Bookings this month & Target (2) & MoM */}
                        <td className="px-6 py-4 font-medium text-center">
                          <div className="flex flex-col items-center gap-1">
                            <div className="flex items-center gap-2">
                              <span className="text-blue-600 font-bold text-lg">{agent.reservedThisMonth}</span>
                              <span className="text-slate-400 text-xs">/ 2</span>
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {/* Target achievement badge */}
                              {agent.reservedThisMonth >= 2 ? (
                                <span className="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-1.5 py-0.5 rounded">ทะลุเป้า</span>
                              ) : agent.reservedThisMonth > 0 ? (
                                <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 py-0.5 rounded">{Math.round((agent.reservedThisMonth / 2) * 100)}%</span>
                              ) : (
                                <span className="bg-slate-100 text-slate-500 text-[10px] font-bold px-1.5 py-0.5 rounded">0%</span>
                              )}
                              {/* MoM Arrow */}
                              {agent.reservedThisMonth > agent.reservedLastMonth ? (
                                <span className="text-emerald-500 text-[10px] font-bold" title={`เดือนที่แล้วทำได้ ${agent.reservedLastMonth}`}>▲</span>
                              ) : agent.reservedThisMonth < agent.reservedLastMonth ? (
                                <span className="text-rose-500 text-[10px] font-bold" title={`เดือนที่แล้วทำได้ ${agent.reservedLastMonth}`}>▼</span>
                              ) : (
                                <span className="text-slate-300 text-[10px] font-bold" title={`เดือนที่แล้วทำได้ ${agent.reservedLastMonth}`}>-</span>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="px-6 py-4 font-medium text-slate-600 text-center">
                          <span className="font-bold">{agent.reservedCount}</span>
                        </td>
                        
                        {/* Cancel Rate */}
                        <td className="px-6 py-4 font-medium text-center">
                          {agent.cancelledReservationsCount > 0 ? (
                            <div className="flex flex-col items-center">
                              <span className="text-rose-500 font-bold">{Math.round((agent.cancelledReservationsCount / agent.reservedCount) * 100)}%</span>
                              <span className="text-[10px] text-slate-400">({agent.cancelledReservationsCount} เคส)</span>
                            </div>
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>

                        <td className="px-6 py-4 font-medium text-emerald-600 text-center">
                          <span className="font-bold">{agent.transferredCount}</span>
                        </td>
                        <td className="px-6 py-4 font-semibold text-blue-600 text-center">
                          {agent.activeLeadsThisMonth}
                        </td>
                        <td className="px-6 py-4 font-semibold text-slate-500 text-center">{agent.totalLeads}</td>
                        
                        {/* Visit to Book Rate */}
                        <td className="px-6 py-4 font-semibold text-blue-600 text-center">
                          {agent.visitsTotal > 0 ? Math.round((agent.reservedCount / agent.visitsTotal) * 100) : 0}%
                        </td>

                        <td className="px-6 py-4 font-semibold text-blue-600 text-center">
                          {agent.totalLeads > 0 ? Math.round((agent.transferredCount / agent.totalLeads) * 100) : 0}%
                        </td>
                        <td className="px-6 py-4 font-semibold text-orange-600 text-center">
                          {agent.countToLoan > 0 ? Math.round(agent.totalDaysToLoan / agent.countToLoan) + ' วัน' : '-'}
                        </td>
                      </tr>
                    ))}
                    {agentSummary.length === 0 && (
                      <tr>
                        <td colSpan={11} className="px-6 py-12 text-center text-gray-500">
                          ไม่พบข้อมูลพนักงานขาย
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Deep-Dive Agent Analysis */}
            {agentSummary.length > 0 && (() => {
              const totalCompanySales = agentSummary.reduce((sum: number, a: any) => sum + a.totalSalesValue, 0);
              
              // 1. Sales Cycle Velocity (Fastest)
              const agentsWithLoanData = agentSummary.filter((a: any) => a.countToLoan > 0);
              const fastestAgent: any = agentsWithLoanData.sort((a: any, b: any) => (a.totalDaysToLoan / a.countToLoan) - (b.totalDaysToLoan / b.countToLoan))[0];
              
              // 2. Lead Neglect (Most stagnant leads)
              const neglectStats = agentSummary.map((a: any) => ({
                name: a.name,
                neglectRate: a.totalLeads > 0 ? ((a.totalLeads - a.activeLeadsThisMonth) / a.totalLeads) * 100 : 0,
                stagnantCount: Math.max(0, a.totalLeads - a.activeLeadsThisMonth)
              })).sort((a: any, b: any) => b.stagnantCount - a.stagnantCount);
              const mostNeglectedAgent: any = neglectStats[0];

              // 3. Top Revenue Contributor
              const topEarner: any = [...agentSummary].sort((a: any, b: any) => b.totalSalesValue - a.totalSalesValue)[0];

              return (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mt-8">
                  <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center gap-2">
                    <MapIcon className="text-slate-500" size={20} />
                    <h3 className="font-bold text-slate-800 text-lg">🔍 เจาะลึกศักยภาพพนักงานขาย (Deep-Dive Analysis)</h3>
                  </div>
                  <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    
                    {/* 1. Sales Cycle Velocity */}
                    <div className="flex flex-col gap-2">
                      <h4 className="text-sm font-bold text-slate-700 flex items-center gap-1.5"><CalendarDays size={16} className="text-blue-500" /> ความเร็วในการปิดดีล</h4>
                      {fastestAgent ? (
                        <p className="text-sm text-slate-600">
                          <span className="font-bold text-blue-700">{fastestAgent.name}</span> ทำเวลาเฉลี่ยจนถึงยื่นกู้ได้เร็วที่สุดที่ <span className="font-bold text-blue-700">{Math.round(fastestAgent.totalDaysToLoan / fastestAgent.countToLoan)} วัน</span> ช่วยสร้าง Cash Flow ให้บริษัทได้เร็วที่สุด
                        </p>
                      ) : (
                        <p className="text-sm text-slate-400">ยังไม่มีข้อมูลเพียงพอ</p>
                      )}
                    </div>

                    {/* 2. Lead Neglect Rate */}
                    <div className="flex flex-col gap-2">
                      <h4 className="text-sm font-bold text-slate-700 flex items-center gap-1.5"><AlertTriangle size={16} className="text-rose-500" /> ลูกค้าที่อาจตกหล่น</h4>
                      {mostNeglectedAgent && mostNeglectedAgent.stagnantCount > 0 ? (
                        <p className="text-sm text-slate-600">
                          <span className="font-bold text-rose-600">{mostNeglectedAgent.name}</span> มีลูกค้าที่ไม่มีความเคลื่อนไหวในเดือนนี้ถึง <span className="font-bold text-rose-600">{mostNeglectedAgent.stagnantCount} ราย</span> (คิดเป็น {Math.round(mostNeglectedAgent.neglectRate)}%) ควรเร่งติดตามผล
                        </p>
                      ) : (
                        <p className="text-sm text-slate-600">พนักงานทุกคนมีการติดตามลูกค้าได้อย่างครอบคลุม</p>
                      )}
                    </div>

                    {/* 3. Drop-off Insight (General) */}
                    <div className="flex flex-col gap-2">
                      <h4 className="text-sm font-bold text-slate-700 flex items-center gap-1.5"><TrendingUp size={16} className="text-amber-500" /> การสูญเสียโอกาส (Drop-off)</h4>
                      <p className="text-sm text-slate-600">
                        พนักงานที่มี <span className="font-bold">อัตรายกเลิกจอง (Cancel Rate)</span> สูง ควรได้รับการอบรมเรื่องการประเมินเครดิตลูกค้าเบื้องต้น เพื่อลดอัตราลูกค้ากู้ไม่ผ่าน
                      </p>
                    </div>

                    {/* 4. Revenue Contribution */}
                    <div className="flex flex-col gap-2">
                      <h4 className="text-sm font-bold text-slate-700 flex items-center gap-1.5"><DollarSign size={16} className="text-emerald-500" /> สัดส่วนรายได้หลัก</h4>
                      {topEarner && totalCompanySales > 0 ? (
                        <p className="text-sm text-slate-600">
                          <span className="font-bold text-emerald-700">{topEarner.name}</span> เป็นผู้สร้างรายได้หลัก คิดเป็น <span className="font-bold text-emerald-700">{Math.round((topEarner.totalSalesValue / totalCompanySales) * 100)}%</span> ของยอดขายรวมบริษัททั้งหมด
                        </p>
                      ) : (
                        <p className="text-sm text-slate-400">ยังไม่มียอดขาย</p>
                      )}
                    </div>

                  </div>
                </div>
              );
            })()}
            
            {/* YoY Chart */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mt-8">
              <div className="bg-indigo-50/50 px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="font-bold text-indigo-900 flex items-center gap-2 text-lg">
                    <TrendingUp className="text-indigo-500" />
                    กราฟเทียบยอดจองรายเดือน (Year-over-Year)
                  </h3>
                  <p className="text-sm text-slate-500 mt-1">เปรียบเทียบยอดการจองในแต่ละเดือน แบ่งตามปี (เลือกดูรายบุคคลได้)</p>
                </div>
                
                <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
                  <span className="text-sm font-bold text-slate-600">พนักงานขาย:</span>
                  <select 
                    value={selectedAgentForChart}
                    onChange={(e) => setSelectedAgentForChart(e.target.value)}
                    className="bg-transparent border-none text-sm font-bold text-indigo-700 focus:outline-none focus:ring-0 cursor-pointer p-0 pr-4"
                  >
                    <option value="all">ทุกคน (ภาพรวม)</option>
                    {uniqueAgents.map(agent => (
                      <option key={agent} value={agent}>{agent}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div className="p-6">
                {availableYears.length > 0 ? (
                  <div className="h-[400px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={yoyData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis 
                          dataKey="name" 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fill: '#64748b', fontSize: 12, fontWeight: 600 }}
                          dy={10}
                        />
                        <YAxis 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fill: '#64748b', fontSize: 12 }}
                          dx={-10}
                          allowDecimals={false}
                        />
                        <RechartsTooltip 
                          contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                          labelStyle={{ fontWeight: 'bold', color: '#1e293b', marginBottom: '8px' }}
                        />
                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                        {availableYears.map((year) => {
                          const currentYear = new Date().getFullYear().toString();
                          const prevYear = (new Date().getFullYear() - 1).toString();
                          
                          if (year === prevYear) {
                            // Previous year as Area background
                            return (
                              <Area 
                                key={year}
                                type="monotone" 
                                dataKey={year} 
                                name={`ปี ${year} (ปีที่แล้ว)`}
                                fill="#f1f5f9" 
                                stroke="#cbd5e1"
                                strokeWidth={2}
                                dot={{ r: 3, fill: '#cbd5e1', strokeWidth: 0 }}
                                activeDot={{ r: 5, fill: '#94a3b8', strokeWidth: 0 }}
                              />
                            );
                          }
                          
                          if (year === currentYear) {
                            // Current year as prominent thick Line
                            return (
                              <Line 
                                key={year}
                                type="monotone" 
                                dataKey={year} 
                                name={`ปี ${year} (ปัจจุบัน)`}
                                stroke="#6366f1" 
                                strokeWidth={4}
                                dot={{ r: 5, fill: '#ffffff', stroke: '#6366f1', strokeWidth: 2 }}
                                activeDot={{ r: 8, strokeWidth: 0 }}
                              />
                            );
                          }
                          
                          // Older years as thin dashed lines
                          return (
                            <Line 
                              key={year}
                              type="monotone" 
                              dataKey={year} 
                              name={`ปี ${year}`}
                              stroke="#e2e8f0" 
                              strokeWidth={2}
                              strokeDasharray="5 5"
                              dot={{ r: 3, fill: '#f8fafc', stroke: '#e2e8f0', strokeWidth: 1 }}
                              activeDot={{ r: 5, strokeWidth: 0 }}
                            />
                          );
                        })}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-[300px] text-slate-400">
                    <CalendarDays size={48} className="mb-4 opacity-50" />
                    <p className="font-medium text-lg">ยังไม่มีข้อมูลยอดจองให้แสดงผล</p>
                  </div>
                )}
              </div>
            </div>          </div>
        )}
      </div>
    </div>
  );
}
