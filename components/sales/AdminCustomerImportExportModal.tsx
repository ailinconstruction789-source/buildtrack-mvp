'use client';

import React, { useState, useRef } from 'react';
import { 
  X, Upload, Download, FileSpreadsheet, CheckCircle2, AlertTriangle, 
  RefreshCw, Loader2, ArrowRight, ShieldCheck, Database, HelpCircle,
  FileText, Check, AlertCircle, Info, ChevronDown
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: {
    userId?: string;
    id?: string;
    username?: string;
    displayName?: string;
    role?: string;
  } | null;
  projects?: any[];
  plots?: any[];
  allLeads?: any[];
  onImportComplete?: (message: string) => void;
}

interface ParsedCustomerRow {
  rowNumber: number;
  leadId?: string;
  customerName: string;
  phone: string;
  projectName: string;
  plotName: string;
  channel: string;
  salesOwner: string;
  status: string;
  crmStatus: string;
  leadDate: string | null;
  bookingDate: string | null;
  bookingAmount: number | null;
  loanSubmissionDate: string | null;
  loanApprovedDate: string | null;
  transferredDate: string | null;
  lostReason: string | null;
  notes: string;
  isExisting: boolean;
  matchedLeadId?: string;
}

export default function AdminCustomerImportExportModal({
  isOpen,
  onClose,
  currentUser,
  projects = [],
  plots = [],
  allLeads = [],
  onImportComplete
}: Props) {
  const [activeTab, setActiveTab] = useState<'import' | 'export' | 'template'>('import');
  
  // Role check: Only Admin / Owner can use this
  const isAdmin = ['admin', 'owner', 'superadmin', 'manager'].includes((currentUser?.role || '').toLowerCase());

  // Import State
  const [importFile, setImportFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedCustomerRow[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ updated: number; inserted: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Export Filter State
  const [exportProject, setExportProject] = useState<string>('all');
  const [exportYear, setExportYear] = useState<string>('all');
  const [isExporting, setIsExporting] = useState(false);

  if (!isOpen) return null;

  // Project Names
  const projectNames = projects.map(p => typeof p === 'string' ? p : p.name || p.project_name).filter(Boolean);

  // Helper: parse date safely from excel or string
  const parseSafeDate = (val: any): string | null => {
    if (!val) return null;
    if (typeof val === 'number') {
      // Excel serial number date
      const date = new Date(Math.round((val - 25569) * 86400 * 1000));
      return isNaN(date.getTime()) ? null : date.toISOString();
    }
    if (typeof val === 'string') {
      const s = val.trim();
      if (!s || s === '-' || s === 'ไม่ทราบ' || s === 'ไม่ระบุ') return null;
      
      // Handle Thai format DD/MM/YYYY or DD-MM-YYYY (including BE 25xx)
      const thaiMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
      if (thaiMatch) {
        let day = parseInt(thaiMatch[1], 10);
        let month = parseInt(thaiMatch[2], 10) - 1;
        let year = parseInt(thaiMatch[3], 10);
        if (year > 2400) year -= 543; // convert BE to CE
        const d = new Date(year, month, day);
        return isNaN(d.getTime()) ? null : d.toISOString();
      }

      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    return null;
  };

  // Handle File Selection and Parsing
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportFile(file);
    setParseError(null);
    setImportResult(null);
    setIsParsing(true);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      
      // Get first sheet or sheet with customer/lead in name
      const sheetName = workbook.SheetNames.find(n => 
        n.toLowerCase().includes('customer') || 
        n.toLowerCase().includes('lead') || 
        n.includes('ลูกค้า') ||
        n.includes('ข้อมูล')
      ) || workbook.SheetNames[0];

      const worksheet = workbook.Sheets[sheetName];
      const rawRows: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

      if (!rawRows || rawRows.length === 0) {
        throw new Error('ไม่พบแถวข้อมูลในไฟล์ Excel ที่เลือก');
      }

      // Fetch latest leads from DB for exact matching
      const { data: dbLeads } = await supabase.from('leads').select('id, customer_name, phone, project_name, interested_plot_name, status, crm_status');

      const currentLeadsList = dbLeads || allLeads;

      const rows: ParsedCustomerRow[] = [];

      rawRows.forEach((row, idx) => {
        // Extract fields matching flexible column headers
        const leadId = String(row['Lead ID'] || row['ID'] || row['รหัสลูกค้า'] || row['id'] || '').trim();
        const rawName = String(row['ชื่อลูกค้า'] || row['ชื่อ-นามสกุล ลูกค้า'] || row['ชื่อ-นามสกุล'] || row['customer_name'] || row['Name'] || '').trim();
        
        // Skip completely empty header/empty row
        if (!rawName && !leadId) return;

        const customerName = rawName || 'ไม่ระบุชื่อ';
        const phone = String(row['เบอร์โทร'] || row['เบอร์โทรศัพท์'] || row['phone'] || row['Phone'] || '').trim() || 'ไม่ทราบ';
        const projectName = String(row['โครงการ'] || row['project_name'] || row['Project'] || '').trim() || (projectNames[0] || 'ไม่ระบุ');
        const plotName = String(row['แปลงที่สนใจ / แปลงที่จอง'] || row['แปลงที่สนใจ'] || row['แปลง'] || row['interested_plot_name'] || row['Plot'] || '').trim();
        const channel = String(row['ช่องทางติดต่อ (Channel)'] || row['ช่องทาง'] || row['channel'] || row['source'] || '').trim() || 'ไม่ระบุ';
        const salesOwner = String(row['พนักงานขายผู้ดูแล'] || row['ผู้ดูแล'] || row['เซลล์'] || row['sales_owner'] || row['agent_name'] || '').trim() || 'ไม่ทราบ';
        let crmStatus = String(row['สถานะการขาย (CRM Status)'] || row['สถานะ'] || row['crm_status'] || row['status'] || '').trim() || 'Follow-up — อยู่ระหว่างติดตาม';
        
        const leadDate = parseSafeDate(row['วันที่ Lead เข้า'] || row['lead_date'] || row['created_at']);
        const bookingDate = parseSafeDate(row['วันที่จอง'] || row['booking_date']);
        const bookingAmountRaw = row['ยอดเงินจอง (บาท)'] || row['ยอดจอง'] || row['booking_amount'];
        const bookingAmount = bookingAmountRaw ? Number(String(bookingAmountRaw).replace(/,/g, '')) || null : null;
        const loanSubmissionDate = parseSafeDate(row['วันที่ยื่นกู้'] || row['loan_submission_date']);
        const loanApprovedDate = parseSafeDate(row['ผลอนุมัติ (วันที่)'] || row['loan_approved_date']);
        const transferredDate = parseSafeDate(row['วันที่โอนกรรมสิทธิ์'] || row['transferred_date'] || row['โอน (วันที่)']);
        const lostReason = String(row['เหตุผลที่ยกเลิก (ถ้ามี)'] || row['lost_reason'] || '').trim() || null;
        const notes = String(row['หมายเหตุ / ข้อมูลเพิ่มเติม'] || row['หมายเหตุ'] || row['notes'] || '').trim();

        // Determine matching existing lead
        let matchedLead = null;
        if (leadId) {
          matchedLead = currentLeadsList.find((l: any) => l.id === leadId);
        }
        if (!matchedLead && customerName && customerName !== 'ไม่ระบุชื่อ') {
          const cleanName = customerName.toLowerCase().replace(/^(นาย|นาง|นางสาว|คุณ)\s*/, '').trim();
          matchedLead = currentLeadsList.find((l: any) => {
            const lClean = (l.customer_name || '').toLowerCase().replace(/^(นาย|นาง|นางสาว|คุณ)\s*/, '').trim();
            const matchProj = !projectName || !l.project_name || l.project_name === projectName;
            return matchProj && (lClean === cleanName || lClean.includes(cleanName) || cleanName.includes(lClean));
          });
        }

        // Determine general status
        let status = 'New';
        const lowerCrm = crmStatus.toLowerCase();
        const lowerNotes = notes.toLowerCase();
        if (transferredDate || crmStatus.includes('โอน') || lowerCrm.includes('transferred')) {
          status = 'Transferred';
        } else if (crmStatus.includes('เช่า') || lowerCrm.includes('rent') || lowerNotes.includes('เช่า') || lowerNotes.includes('rent')) {
          status = 'Rented';
          if (!crmStatus.includes('เช่า')) crmStatus = 'สัญญาเช่า / เช่าออม';
        } else if (bookingDate || crmStatus.includes('จอง') || lowerCrm.includes('booked') || lowerCrm.includes('reserved')) {
          status = 'Booked';
        } else if (crmStatus.includes('ยกเลิก') || crmStatus.includes('lost') || lowerCrm.includes('cancel')) {
          status = 'Lost';
        } else if (crmStatus.includes('กู้') || lowerCrm.includes('loan')) {
          status = 'Loan';
        } else if (crmStatus.includes('นัด') || lowerCrm.includes('visit') || lowerCrm.includes('appoint')) {
          status = 'Appointment';
        } else {
          status = 'Active';
        }

        rows.push({
          rowNumber: idx + 2,
          leadId: leadId || undefined,
          customerName,
          phone,
          projectName,
          plotName: plotName || (status === 'Transferred' || status === 'Booked' || status === 'Rented' ? 'ไม่ระบุ' : ''),
          channel,
          salesOwner,
          status,
          crmStatus,
          leadDate,
          bookingDate,
          bookingAmount,
          loanSubmissionDate,
          loanApprovedDate,
          transferredDate,
          lostReason,
          notes,
          isExisting: Boolean(matchedLead),
          matchedLeadId: matchedLead?.id
        });
      });

      if (rows.length === 0) {
        throw new Error('ไม่พบข้อมูลลูกค้าที่ถูกต้องในไฟล์');
      }

      setParsedRows(rows);
    } catch (err: any) {
      console.error('Error parsing Excel:', err);
      setParseError(err.message || 'เกิดข้อผิดพลาดในการอ่านไฟล์ Excel กรุณาตรวจสอบรูปแบบไฟล์');
    } finally {
      setIsParsing(false);
    }
  };

  // Execute Upsert / Save to DB
  const handleExecuteImport = async () => {
    if (parsedRows.length === 0) return;
    setIsSaving(true);
    setParseError(null);

    try {
      let updatedCount = 0;
      let insertedCount = 0;
      const now = new Date().toISOString();
      const adminName = currentUser?.displayName || currentUser?.username || 'Admin';

      for (const row of parsedRows) {
        const payload: any = {
          customer_name: row.customerName,
          phone: row.phone === 'ไม่ทราบ' ? null : row.phone,
          project_name: row.projectName === 'ไม่ระบุ' ? (projectNames[0] || 'ไอลิน 6') : row.projectName,
          interested_plot_name: row.plotName && row.plotName !== 'ไม่ระบุ' ? row.plotName : null,
          channel: row.channel,
          source: row.channel,
          sales_owner: row.salesOwner,
          crm_status: row.crmStatus,
          status: row.status,
          updated_at: now
        };

        if (row.leadDate) payload.lead_date = row.leadDate;
        if (row.bookingDate) payload.booking_date = row.bookingDate;
        if (row.bookingAmount !== null) payload.booking_amount = row.bookingAmount;
        if (row.loanSubmissionDate) payload.loan_submission_date = row.loanSubmissionDate;
        if (row.loanApprovedDate) payload.loan_approved_date = row.loanApprovedDate;
        if (row.transferredDate) payload.transferred_date = row.transferredDate;
        if (row.lostReason) payload.lost_reason = row.lostReason;
        
        if (row.notes) {
          payload.notes = row.notes;
        }

        if (row.isExisting && row.matchedLeadId) {
          // UPDATE existing lead
          const { error: updateErr } = await supabase
            .from('leads')
            .update(payload)
            .eq('id', row.matchedLeadId);

          if (updateErr) throw updateErr;
          updatedCount++;
        } else {
          // INSERT new lead
          payload.created_at = row.leadDate || now;
          payload.created_by_agent = adminName;
          
          const { error: insertErr } = await supabase
            .from('leads')
            .insert([payload]);

          if (insertErr) throw insertErr;
          insertedCount++;
        }

        // If transferred, booked, or rented with a valid plot name, update plots table status
        if (row.plotName && row.plotName !== 'ไม่ระบุ' && (row.status === 'Transferred' || row.status === 'Booked' || row.status === 'Rented')) {
          if (row.status === 'Rented') {
            await supabase
              .from('plots')
              .update({
                current_tenant_name: row.customerName,
                highlight_note: `ผู้เช่า: ${row.customerName} (อัปเดตโดย Admin Import)`
              })
              .match({ project_name: payload.project_name, plot_name: row.plotName });
          } else {
            const plotSaleStatus = row.status === 'Transferred' ? 'transferred' : 'reserved';
            await supabase
              .from('plots')
              .update({
                highlight_note: `ลูกค้า: ${row.customerName} (${row.status === 'Transferred' ? 'โอนแล้ว' : 'จองแล้ว'})`
              })
              .match({ project_name: payload.project_name, plot_name: row.plotName });
          }
        }
      }

      setImportResult({ updated: updatedCount, inserted: insertedCount });
      setParsedRows([]);
      setImportFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';

      const summaryMsg = `นำเข้าสำเร็จ! อัปเดตข้อมูลลูกค้าเดิม ${updatedCount} รายการ และเพิ่มลูกค้าใหม่ ${insertedCount} รายการ`;
      if (onImportComplete) {
        onImportComplete(summaryMsg);
      }
    } catch (err: any) {
      console.error('Error importing customer data:', err);
      setParseError('เกิดข้อผิดพลาดในการบันทึกข้อมูล: ' + (err.message || ''));
    } finally {
      setIsSaving(false);
    }
  };

  // Export to Excel
  const handleExportData = () => {
    setIsExporting(true);
    try {
      let filtered = [...allLeads];

      // Filter by Project
      if (exportProject !== 'all') {
        filtered = filtered.filter(l => l.project_name === exportProject);
      }

      // Filter by Year
      if (exportYear !== 'all') {
        const yNum = parseInt(exportYear, 10);
        filtered = filtered.filter(l => {
          const dStr = l.transferred_date || l.booking_date || l.created_at || l.lead_date;
          if (!dStr) return false;
          const y = new Date(dStr).getFullYear();
          return y === yNum;
        });
      }

      const rows = filtered.map((lead, idx) => ({
        'Lead ID': lead.id || '',
        'ชื่อ-นามสกุล ลูกค้า': lead.customer_name || 'ไม่ระบุชื่อ',
        'เบอร์โทรศัพท์': lead.phone || 'ไม่ทราบ',
        'โครงการ': lead.project_name || 'ไม่ระบุ',
        'แปลงที่สนใจ / แปลงที่จอง': lead.interested_plot_name || 'ไม่ระบุ',
        'สถานะการขาย (CRM Status)': lead.crm_status || lead.status || 'กำลังติดตาม',
        'วันที่ Lead เข้า': lead.lead_date ? new Date(lead.lead_date).toLocaleDateString('th-TH') : (lead.created_at ? new Date(lead.created_at).toLocaleDateString('th-TH') : ''),
        'ช่องทางติดต่อ (Channel)': lead.channel || lead.source || 'ไม่ระบุ',
        'พนักงานขายผู้ดูแล': lead.sales_owner || lead.agent_name || 'ไม่ทราบ',
        'วันที่จอง': lead.booking_date ? new Date(lead.booking_date).toLocaleDateString('th-TH') : '',
        'ยอดเงินจอง (บาท)': lead.booking_amount || '',
        'วันที่ยื่นกู้': lead.loan_submission_date ? new Date(lead.loan_submission_date).toLocaleDateString('th-TH') : '',
        'ผลอนุมัติ (วันที่)': lead.loan_approved_date ? new Date(lead.loan_approved_date).toLocaleDateString('th-TH') : '',
        'วันที่โอนกรรมสิทธิ์': lead.transferred_date ? new Date(lead.transferred_date).toLocaleDateString('th-TH') : '',
        'เหตุผลที่ยกเลิก (ถ้ามี)': lead.lost_reason || '',
        'หมายเหตุ / ข้อมูลเพิ่มเติม': lead.notes || ''
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      
      // Set Column Widths
      ws['!cols'] = [
        { wch: 38 }, // Lead ID
        { wch: 25 }, // Customer Name
        { wch: 15 }, // Phone
        { wch: 20 }, // Project
        { wch: 18 }, // Plot
        { wch: 25 }, // Status
        { wch: 15 }, // Lead Date
        { wch: 18 }, // Channel
        { wch: 20 }, // Owner
        { wch: 15 }, // Booking Date
        { wch: 18 }, // Booking Amount
        { wch: 15 }, // Loan Date
        { wch: 15 }, // Approved Date
        { wch: 18 }, // Transfer Date
        { wch: 22 }, // Lost Reason
        { wch: 35 }  // Notes
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Customers');
      
      const fileName = `BuildTrack_Customers_Export_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(wb, fileName);
    } catch (err: any) {
      console.error('Error exporting data:', err);
      alert('เกิดข้อผิดพลาดในการส่งออกไฟล์ Excel: ' + (err.message || ''));
    } finally {
      setIsExporting(false);
    }
  };

  // Download Blank Excel Template
  const handleDownloadTemplate = () => {
    const sampleRows = [
      {
        'Lead ID': '',
        'ชื่อ-นามสกุล ลูกค้า': 'คุณสมชาย รักดี',
        'เบอร์โทรศัพท์': '081-234-5678',
        'โครงการ': projectNames[0] || 'ไอลิน 6',
        'แปลงที่สนใจ / แปลงที่จอง': '4',
        'สถานะการขาย (CRM Status)': 'โอนกรรมสิทธิ์แล้ว',
        'วันที่ Lead เข้า': '15/01/2026',
        'ช่องทางติดต่อ (Channel)': 'Facebook',
        'พนักงานขายผู้ดูแล': currentUser?.displayName || 'พนักงานขาย',
        'วันที่จอง': '20/01/2026',
        'ยอดเงินจอง (บาท)': '10000',
        'วันที่ยื่นกู้': '01/02/2026',
        'ผลอนุมัติ (วันที่)': '15/02/2026',
        'วันที่โอนกรรมสิทธิ์': '28/02/2026',
        'เหตุผลที่ยกเลิก (ถ้ามี)': '',
        'หมายเหตุ / ข้อมูลเพิ่มเติม': 'ลูกค้าโอนกรรมสิทธิ์เรียบร้อย'
      },
      {
        'Lead ID': '',
        'ชื่อ-นามสาว': 'คุณสมหญิง ใจงาม',
        'เบอร์โทรศัพท์': '089-987-6543',
        'โครงการ': projectNames[0] || 'ไอลิน 6',
        'แปลงที่สนใจ / แปลงที่จอง': 'A02',
        'สถานะการขาย (CRM Status)': 'Follow-up — อยู่ระหว่างติดตาม',
        'วันที่ Lead เข้า': '01/03/2026',
        'ช่องทางติดต่อ (Channel)': 'Line OA',
        'พนักงานขายผู้ดูแล': 'ไม่ทราบ',
        'วันที่จอง': '',
        'ยอดเงินจอง (บาท)': '',
        'วันที่ยื่นกู้': '',
        'ผลอนุมัติ (วันที่)': '',
        'วันที่โอนกรรมสิทธิ์': '',
        'เหตุผลที่ยกเลิก (ถ้ามี)': '',
        'หมายเหตุ / ข้อมูลเพิ่มเติม': 'กำลังเปรียบเทียบงบประมาณ'
      }
    ];

    const ws = XLSX.utils.json_to_sheet(sampleRows);
    ws['!cols'] = [
      { wch: 38 }, { wch: 25 }, { wch: 15 }, { wch: 20 }, { wch: 18 },
      { wch: 25 }, { wch: 15 }, { wch: 18 }, { wch: 20 }, { wch: 15 },
      { wch: 18 }, { wch: 15 }, { wch: 15 }, { wch: 18 }, { wch: 22 }, { wch: 35 }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Customer_Template');
    XLSX.writeFile(wb, `BuildTrack_Customer_Template.xlsx`);
  };

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95">
        
        {/* 1. Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-600 text-white flex items-center justify-center font-black shadow-md shadow-orange-500/20">
              <Database size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-slate-900">
                  ศูนย์ Import / Export ข้อมูลลูกค้า & ยอดขาย
                </h3>
                <span className="px-2 py-0.5 rounded-md bg-rose-50 border border-rose-200 text-[10px] font-black text-rose-700 flex items-center gap-1">
                  <ShieldCheck size={12} /> เฉพาะสิทธิ์ Admin
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium">
                ส่งออกและนำเข้าไฟล์ Excel เพื่ออัปเดตประวัติลูกค้าเก่าและใหม่ทั้งระบบอย่างรวดเร็ว
              </p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-200/60 cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Access Denied Guard */}
        {!isAdmin ? (
          <div className="p-8 text-center space-y-4">
            <div className="w-14 h-14 rounded-3xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
              <AlertTriangle size={28} />
            </div>
            <h4 className="text-base font-bold text-slate-800">ไม่มีสิทธิ์เข้าถึงฟังก์ชันนี้</h4>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              ฟังก์ชันการนำเข้าและส่งออกข้อมูลลูกค้าถูกจำกัดไว้สำหรับผู้ดูแลระบบ (Admin / Owner) เท่านั้น เพื่อความปลอดภัยของข้อมูล
            </p>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 bg-slate-900 text-white text-xs font-bold rounded-xl cursor-pointer"
            >
              ปิดหน้าต่าง
            </button>
          </div>
        ) : (
          <>
            {/* 2. Nav Tabs */}
            <div className="flex border-b border-slate-200 bg-white px-5 pt-2">
              <button
                type="button"
                onClick={() => setActiveTab('import')}
                className={`pb-3 px-4 text-xs font-black transition-all border-b-2 flex items-center gap-2 cursor-pointer ${
                  activeTab === 'import'
                    ? 'border-amber-600 text-amber-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Upload size={15} />
                📥 นำเข้า & อัปเดตข้อมูล (Import Excel)
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('export')}
                className={`pb-3 px-4 text-xs font-black transition-all border-b-2 flex items-center gap-2 cursor-pointer ${
                  activeTab === 'export'
                    ? 'border-amber-600 text-amber-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Download size={15} />
                📤 ส่งออกข้อมูลลูกค้า (Export Excel)
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('template')}
                className={`pb-3 px-4 text-xs font-black transition-all border-b-2 flex items-center gap-2 cursor-pointer ${
                  activeTab === 'template'
                    ? 'border-amber-600 text-amber-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <FileSpreadsheet size={15} />
                📄 แม่แบบไฟล์ (Template)
              </button>
            </div>

            {/* 3. Tab Body */}
            <div className="p-6 overflow-y-auto flex-1 space-y-5">
              
              {/* Error Notice */}
              {parseError && (
                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-xs font-bold text-rose-900 flex items-center gap-2">
                  <AlertCircle size={16} className="text-rose-600 shrink-0" />
                  <span>{parseError}</span>
                </div>
              )}

              {/* Success Result Alert */}
              {importResult && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs font-bold text-emerald-900 space-y-1">
                  <div className="flex items-center gap-2 text-sm font-black text-emerald-800">
                    <CheckCircle2 size={18} className="text-emerald-600" />
                    นำเข้าและอัปเดตข้อมูลสำเร็จเรียบร้อย!
                  </div>
                  <p className="text-slate-600 text-xs">
                    • 🔄 <strong>อัปเดตข้อมูลลูกค้าเดิม:</strong> {importResult.updated} รายการ<br />
                    • ➕ <strong>เพิ่มลูกค้าใหม่:</strong> {importResult.inserted} รายการ
                  </p>
                </div>
              )}

              {/* =========================================================
                  TAB 1: IMPORT & UPSERT
              ========================================================= */}
              {activeTab === 'import' && (
                <div className="space-y-4">
                  
                  {/* Instructions banner */}
                  <div className="p-4 bg-amber-50/80 border border-amber-200 rounded-2xl text-xs text-amber-950 space-y-2">
                    <div className="flex items-center gap-2 font-black text-amber-900">
                      <Info size={16} className="text-amber-600" />
                      กติกาการนำเข้าและระบบอัปเดตข้อมูลอัจฉริยะ (Smart Upsert)
                    </div>
                    <ul className="list-disc list-inside space-y-1 text-slate-700 font-medium pl-1 text-[11px]">
                      <li>หากพบ <strong>Lead ID</strong> หรือ <strong>ชื่อลูกค้า + โครงการ</strong> ตรงกัน ระบบจะ <strong>Update ข้อมูลเดิม</strong> ให้ทันสมัยทันที</li>
                      <li>หากเป็นลูกค้ารายใหม่ที่ยังไม่มีในระบบ ระบบจะ <strong>เพิ่มเข้าระบบใหม่</strong> ให้อัตโนมัติ</li>
                      <li><strong>ช่องที่เว้นว่าง / ไม่มีข้อมูล (ข้อมูลเก่า):</strong> ระบบจะกำหนดเป็น <code className="bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded font-black">"ไม่ทราบ"</code> หรือ <code className="bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded font-black">"ไม่ระบุ"</code> ให้อัตโนมัติ</li>
                    </ul>
                  </div>

                  {/* Upload Box */}
                  <div className="border-2 border-dashed border-slate-300 hover:border-amber-500 rounded-3xl p-6 text-center bg-slate-50/50 transition-colors">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx, .xls, .csv"
                      onChange={handleFileChange}
                      className="hidden"
                      id="admin-customer-excel-upload"
                    />
                    <label 
                      htmlFor="admin-customer-excel-upload"
                      className="cursor-pointer flex flex-col items-center justify-center space-y-2.5"
                    >
                      <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center font-black">
                        <Upload size={22} />
                      </div>
                      <div>
                        <span className="text-xs font-black text-slate-800 block">
                          {importFile ? importFile.name : 'คลิกเพื่อเลือกไฟล์ Excel (.xlsx, .xls, .csv)'}
                        </span>
                        <span className="text-[10px] text-slate-400 block mt-0.5">
                          รองรับไฟล์ที่ Export ออกจากระบบ หรือไฟล์ที่มีคอลัมน์ชื่อลูกค้า
                        </span>
                      </div>
                    </label>
                  </div>

                  {/* Parsing State */}
                  {isParsing && (
                    <div className="p-8 text-center space-y-2">
                      <Loader2 size={28} className="animate-spin text-amber-500 mx-auto" />
                      <p className="text-xs font-bold text-slate-600">กำลังอ่านและตรวจสอบโครงสร้างข้อมูล...</p>
                    </div>
                  )}

                  {/* Preview Table & Action */}
                  {parsedRows.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-slate-800">
                            พบข้อมูลลูกค้าทั้งหมด {parsedRows.length} รายการ
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-black">
                            🔄 อัปเดต {parsedRows.filter(r => r.isExisting).length}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 text-[10px] font-black">
                            ➕ เพิ่มใหม่ {parsedRows.filter(r => !r.isExisting).length}
                          </span>
                        </div>
                      </div>

                      {/* Mini Preview Table */}
                      <div className="border border-slate-200 rounded-2xl overflow-hidden max-h-60 overflow-y-auto">
                        <table className="w-full text-left text-[11px] border-collapse">
                          <thead className="bg-slate-100 sticky top-0 font-bold text-slate-600">
                            <tr>
                              <th className="py-2 px-3">การทำงาน</th>
                              <th className="py-2 px-3">ชื่อลูกค้า</th>
                              <th className="py-2 px-3">เบอร์โทร</th>
                              <th className="py-2 px-3">โครงการ & แปลง</th>
                              <th className="py-2 px-3">สถานะ</th>
                              <th className="py-2 px-3">ผู้ดูแล</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                            {parsedRows.slice(0, 30).map((row, i) => (
                              <tr key={i} className="hover:bg-slate-50">
                                <td className="py-2 px-3">
                                  {row.isExisting ? (
                                    <span className="px-2 py-0.5 bg-amber-100 text-amber-900 font-black rounded-md text-[9px]">
                                      🔄 อัปเดตเดิม
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-900 font-black rounded-md text-[9px]">
                                      ➕ เพิ่มใหม่
                                    </span>
                                  )}
                                </td>
                                <td className="py-2 px-3 font-bold text-slate-900">{row.customerName}</td>
                                <td className="py-2 px-3">{row.phone}</td>
                                <td className="py-2 px-3">{row.projectName} {row.plotName ? `(แปลง ${row.plotName})` : ''}</td>
                                <td className="py-2 px-3 font-bold">{row.status}</td>
                                <td className="py-2 px-3 text-slate-500">{row.salesOwner}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {parsedRows.length > 30 && (
                        <p className="text-[10px] text-slate-400 text-right">
                          แสดงตัวอย่าง 30 รายการแรกจากทั้งหมด {parsedRows.length} รายการ
                        </p>
                      )}

                      {/* Confirm Button */}
                      <div className="pt-2 flex justify-end gap-2.5">
                        <button
                          type="button"
                          onClick={() => {
                            setParsedRows([]);
                            setImportFile(null);
                          }}
                          className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                        >
                          ยกเลิก
                        </button>
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={handleExecuteImport}
                          className="px-5 py-2 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white rounded-xl text-xs font-black shadow-md flex items-center gap-2 cursor-pointer disabled:opacity-50"
                        >
                          {isSaving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                          ยืนยันการนำเข้าและอัปเดตข้อมูล ({parsedRows.length} รายการ)
                        </button>
                      </div>
                    </div>
                  )}

                </div>
              )}

              {/* =========================================================
                  TAB 2: EXPORT TO EXCEL
              ========================================================= */}
              {activeTab === 'export' && (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-700 space-y-3">
                    <h4 className="font-bold text-slate-900">กำหนดตัวกรองสำหรับส่งออกไฟล์ Excel</h4>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Project Filter */}
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">เลือกโครงการ</label>
                        <select
                          value={exportProject}
                          onChange={e => setExportProject(e.target.value)}
                          className="w-full text-xs font-bold bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:ring-2 focus:ring-amber-500"
                        >
                          <option value="all">🏢 ทุกโครงการ</option>
                          {projectNames.map(p => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      </div>

                      {/* Year Filter */}
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">เลือกปี</label>
                        <select
                          value={exportYear}
                          onChange={e => setExportYear(e.target.value)}
                          className="w-full text-xs font-bold bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:ring-2 focus:ring-amber-500"
                        >
                          <option value="all">🌐 ทุกปี (ประวัติทั้งหมด)</option>
                          <option value="2026">📅 ปี 2026 (ปีปัจจุบัน)</option>
                          <option value="2025">📅 ปี 2025</option>
                          <option value="2024">📅 ปี 2024</option>
                        </select>
                      </div>
                    </div>

                    <div className="pt-2 text-[11px] text-slate-500">
                      ℹ️ ไฟล์ Excel ที่ส่งออกจะมีคอลัมน์ <strong>Lead ID</strong> กำกับไว้ เพื่อให้คุณสามารถนำไฟล์นี้ไปแก้ใน Excel แล้วนำเข้ากลับมาระบบเพื่ออัปเดตอัตโนมัติได้อย่างแม่นยำ
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      disabled={isExporting}
                      onClick={handleExportData}
                      className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white rounded-xl text-xs font-black shadow-md flex items-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      {isExporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                      ส่งออกไฟล์ Excel (.xlsx)
                    </button>
                  </div>
                </div>
              )}

              {/* =========================================================
                  TAB 3: TEMPLATE
              ========================================================= */}
              {activeTab === 'template' && (
                <div className="space-y-4 text-center py-4">
                  <div className="w-16 h-16 rounded-3xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto">
                    <FileSpreadsheet size={32} />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-sm font-black text-slate-800">ดาวน์โหลดแม่แบบไฟล์ Excel (Customer Template)</h4>
                    <p className="text-xs text-slate-500 max-w-md mx-auto">
                      แม่แบบไฟล์มีหัวตารางภาษาไทยครบ 16 คอลัมน์ พร้อมแถวตัวอย่างข้อมูล เพื่อให้คุณกรอกข้อมูลได้ถูกต้องและนำเข้าได้ทันที
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleDownloadTemplate}
                    className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-black shadow-sm inline-flex items-center gap-2 cursor-pointer transition-all active:scale-95"
                  >
                    <Download size={15} />
                    ดาวน์โหลดแม่แบบ (.xlsx)
                  </button>
                </div>
              )}

            </div>
          </>
        )}

      </div>
    </div>
  );
}
