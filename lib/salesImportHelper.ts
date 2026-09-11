import * as XLSX from 'xlsx';
import { Lead, CRMStatus, LostReason, MarketingChannel } from '@/types/sales';

export const CRM_STATUS_OPTIONS: CRMStatus[] = [
  'Follow-up — อยู่ระหว่างติดตาม',
  'Considering — กำลังพิจารณา / เปรียบเทียบ',
  'Loan Pre-Approval — อยู่ระหว่างเช็ก/ยื่น Pre-Approve',
  'Booking Pending — มีแนวโน้มจอง รอการตัดสินใจ',
  'Booked — จองแล้ว',
  'Contracted — ทำสัญญาแล้ว',
  'Loan Approved — สินเชื่อผ่าน',
  'Transfer Pending — รอโอน',
  'Transferred / Won — โอนกรรมสิทธิ์สำเร็จ',
  'Lost — ยุติการซื้อ / ไม่จอง',
  'Unreachable — ติดต่อไม่ได้',
  'Not Ready — ยังไม่พร้อมซื้อ รอในอนาคต',
  'Nurture — เก็บไว้ติดตามระยะยาว'
];

export const LOST_REASON_OPTIONS: LostReason[] = [
  'งบประมาณไม่ถึง / ราคาสูงเกิน',
  'กู้ไม่ผ่าน / สถาบันการเงินปฏิเสธ',
  'ทำเลไม่ตรงความต้องการ',
  'ยังไม่พร้อมซื้อ / รอดูก่อน',
  'เลือกโครงการอื่น / เปรียบเทียบแล้วเลือกที่อื่น',
  'อื่นๆ (ระบุในช่องถัดไป)'
];

export const MARKETING_CHANNEL_OPTIONS: MarketingChannel[] = [
  'Facebook', 'Line OA', 'Line ส่วนตัว', 'Walk in', 'โทร', 'TikTok', 'Youtube', 'Lemon8', 'Billboard', 'Referral', 'Other'
];

/**
 * Parse date values safely supporting:
 * - Excel Serial numbers (e.g. 45536)
 * - Thai Buddhist Year (e.g. 2567 -> 2024)
 * - DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
 * - ISO string
 */
export function parseDateValue(dateStr: any): string | null {
  if (dateStr === null || dateStr === undefined || dateStr === '') return null;
  const str = dateStr.toString().trim();
  if (!str) return null;

  // Check if it's an Excel serial number
  if (/^\d+(\.\d+)?$/.test(str)) {
    const serial = parseFloat(str);
    const utcDays = Math.floor(serial - 25569);
    const utcValue = utcDays * 86400; 
    const dateInfo = new Date(utcValue * 1000);
    if (!isNaN(dateInfo.getTime())) {
      return new Date(Date.UTC(dateInfo.getFullYear(), dateInfo.getMonth(), dateInfo.getDate(), 5, 0, 0)).toISOString();
    }
  }

  // Parse DD/MM/YYYY or DD-MM-YYYY or YYYY-MM-DD
  const parts = str.split(/[\/\-.]/);
  if (parts.length === 3) {
    let part1 = parseInt(parts[0], 10);
    let part2 = parseInt(parts[1], 10);
    let part3 = parseInt(parts[2], 10);

    let day = part1;
    let month = part2;
    let year = part3;

    // Handle YYYY-MM-DD
    if (part1 > 1000) {
      year = part1;
      month = part2;
      day = part3;
    }

    // Convert Thai Buddhist Era (พ.ศ. > 2400) to CE
    if (year > 2400) {
      year -= 543;
    } else if (year < 100) {
      year += 2000;
    }

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(Date.UTC(year, month - 1, day, 5, 0, 0)).toISOString();
    }
  }

  // Standard Date parse fallback
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    let year = parsed.getFullYear();
    if (year > 2400) year -= 543;
    return new Date(Date.UTC(year, parsed.getMonth(), parsed.getDate(), 5, 0, 0)).toISOString();
  }

  return null;
}

/**
 * Parse numeric/money values safely
 */
export function parseMoneyValue(val: any): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  const numStr = val.toString().replace(/[^0-9.-]+/g, '');
  const num = Number(numStr);
  return isNaN(num) ? null : num;
}

/**
 * Normalize Marketing Channel
 */
export function normalizeChannel(raw?: string): string {
  if (!raw) return 'Walk in';
  const str = raw.toString().trim().toLowerCase();
  if (str.includes('face') || str.includes('fb') || str.includes('เพจ') || str.includes('เฟส')) return 'Facebook';
  if (str.includes('oa') || str.includes('line oa') || str.includes('ไลน์ oa') || str.includes('ไลน์ออฟฟิ')) return 'Line OA';
  if (str.includes('ส่วนตัว') || str.includes('line ส่วนตัว')) return 'Line ส่วนตัว';
  if (str.includes('line') || str.includes('ไลน์')) return 'Line OA';
  if (str.includes('walk') || str.includes('วอล์ค') || str.includes('เข้ามา')) return 'Walk in';
  if (str.includes('โทร') || str.includes('call') || str.includes('phone') || str.includes('tel')) return 'โทร';
  if (str.includes('tik') || str.includes('ติ๊ก')) return 'TikTok';
  if (str.includes('you') || str.includes('ยูทู')) return 'Youtube';
  if (str.includes('lemon') || str.includes('เลมอน')) return 'Lemon8';
  if (str.includes('bill') || str.includes('ป้าย')) return 'Billboard';
  if (str.includes('ref') || str.includes('แนะ') || str.includes('บอกต่อ')) return 'Referral';
  return raw.toString().trim() || 'Other';
}

/**
 * Smart Status Inference: maps legacy statuses & Thai strings to standard CRM Status
 */
export function mapToCRMStatus(rawCrmStatus?: string, rawLegacyStatus?: string): CRMStatus {
  const check = (rawCrmStatus || rawLegacyStatus || '').toString().trim();
  if (!check) return 'Follow-up — อยู่ระหว่างติดตาม';

  // Check direct exact match
  if (CRM_STATUS_OPTIONS.includes(check as CRMStatus)) {
    return check as CRMStatus;
  }

  const s = check.toLowerCase();

  // Transferred / Won
  if (s.includes('โอน') || s.includes('won') || s.includes('transferred') || s.includes('handover') || s.includes('รับมอบ')) {
    return 'Transferred / Won — โอนกรรมสิทธิ์สำเร็จ';
  }

  // Transfer Pending
  if (s.includes('รอโอน') || s.includes('transfer pending')) {
    return 'Transfer Pending — รอโอน';
  }

  // Loan Approved
  if (s.includes('อนุมัติ') || s.includes('ผ่าน') || s.includes('approved')) {
    return 'Loan Approved — สินเชื่อผ่าน';
  }

  // Contracted
  if (s.includes('สัญญา') || s.includes('contract')) {
    return 'Contracted — ทำสัญญาแล้ว';
  }

  // Booked / Reserved / DownPayment
  if (s.includes('จอง') || s.includes('book') || s.includes('reserve') || s.includes('downpayment') || s.includes('ผ่อนดาวน์')) {
    return 'Booked — จองแล้ว';
  }

  // Loan Pre-Approval
  if (s.includes('ยื่นกู้') || s.includes('pre-app') || s.includes('loanprocessing') || s.includes('documentprep') || s.includes('เอกสาร')) {
    return 'Loan Pre-Approval — อยู่ระหว่างเช็ก/ยื่น Pre-Approve';
  }

  // Booking Pending
  if (s.includes('แนวโน้มจอง') || s.includes('รอตัดสินใจ') || s.includes('booking pending')) {
    return 'Booking Pending — มีแนวโน้มจอง รอการตัดสินใจ';
  }

  // Lost / Cancelled
  if (s.includes('lost') || s.includes('cancel') || s.includes('ยกเลิก') || s.includes('ไม่ซื้อ') || s.includes('ไม่จอง') || s.includes('หลุดจอง')) {
    return 'Lost — ยุติการซื้อ / ไม่จอง';
  }

  // Unreachable
  if (s.includes('ติดต่อไม่ได้') || s.includes('unreach') || s.includes('ไม่รับสาย')) {
    return 'Unreachable — ติดต่อไม่ได้';
  }

  // Not Ready
  if (s.includes('ไม่พร้อม') || s.includes('not ready') || s.includes('รอดูก่อน')) {
    return 'Not Ready — ยังไม่พร้อมซื้อ รอในอนาคต';
  }

  // Nurture
  if (s.includes('nurture') || s.includes('ระยะยาว')) {
    return 'Nurture — เก็บไว้ติดตามระยะยาว';
  }

  // Considering / Visit
  if (s.includes('พิจารณา') || s.includes('เปรียบเทียบ') || s.includes('consider') || s.includes('เยี่ยมชม') || s.includes('visit') || s.includes('negotiation') || s.includes('เจรจา')) {
    return 'Considering — กำลังพิจารณา / เปรียบเทียบ';
  }

  return 'Follow-up — อยู่ระหว่างติดตาม';
}

/**
 * Map CRM Status to Legacy Kanban status
 */
export function mapCRMStatusToLegacyStatus(crmStatus: string): string {
  if (crmStatus.includes('โอน') || crmStatus.includes('Won')) return 'Transferred';
  if (crmStatus.includes('ทำสัญญา')) return 'Contracted';
  if (crmStatus.includes('จองแล้ว')) return 'Reserved';
  if (crmStatus.includes('สินเชื่อผ่าน')) return 'Approved';
  if (crmStatus.includes('Pre-Approve')) return 'LoanProcessing';
  if (crmStatus.includes('Lost') || crmStatus.includes('ยุติ')) return 'Cancelled';
  return 'Visit';
}

export interface ParsedLeadRow {
  rowNum: number;
  customer_name: string;
  phone: string;
  project_name: string;
  channel: string;
  agent_name: string;
  lead_date: string;
  contacted_date: string | null;
  appointment_date: string | null;
  actual_visit_date: string | null;
  follow_up_count: number;
  last_follow_up_date: string | null;
  interested_plot_name: string;
  matched_plot_id?: string | null;
  booking_date: string | null;
  booking_amount: number | null;
  sale_price: number | null;
  land_office_price: number | null;
  loan_submission_date: string | null;
  loan_approved_date: string | null;
  transferred_date: string | null;
  lost_reason: string | null;
  lost_reason_detail: string | null;
  crm_status: CRMStatus;
  auto_status: string;
  notes: string;
  occupation: string;
  interest: string;
  legacy_status: string;
}

/**
 * Flexible Row Parser supporting both Thai (22 cols) and English (legacy 14 cols)
 */
export function parseExcelRowToLead(
  row: Record<string, any>, 
  rowNum: number, 
  defaultProject: string = 'ไอลิน 6', 
  defaultAgent: string = 'ส่วนกลาง'
): ParsedLeadRow | null {
  // Find key helper (case-insensitive & trimmed)
  const getVal = (...keys: string[]) => {
    for (const k of keys) {
      if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
        return row[k];
      }
      const matchedKey = Object.keys(row).find(rk => rk.trim().toLowerCase() === k.toLowerCase());
      if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== null && String(row[matchedKey]).trim() !== '') {
        return row[matchedKey];
      }
    }
    return '';
  };

  const customerName = String(getVal('ชื่อลูกค้า', 'ชื่อ', 'Customer Name', 'Customer', 'Name', 'ชื่อ-สกุล', 'ชื่อ - สกุล')).trim();
  if (!customerName) return null; // Mandatory

  const phone = String(getVal('เบอร์โทร', 'เบอร์', 'Phone', 'Tel', 'เบอร์โทรศัพท์', 'เบอร์ติดต่อ', 'Mobile')).trim();
  let projectName = String(getVal('โครงการ', 'Project Name', 'Project', 'ชื่อโครงการ')).trim() || defaultProject;
  const channel = normalizeChannel(String(getVal('ช่องทาง', 'Channel', 'Source', 'ที่มา', 'แหล่งที่มา')));
  const agentName = String(getVal('เซลล์', 'Sales Agent', 'Agent', 'ผู้ดูแล', 'พนักงานขาย')).trim() || defaultAgent;

  // Dates
  const now = new Date().toISOString();
  const rawLeadDate = getVal('วันที่ Lead เข้า', 'Lead Date', 'วันที่เข้า', 'Lead In Date', 'Created Date', 'วันที่สร้าง');
  const rawVisitDate = getVal('เข้าชมจริง (วันที่)', 'Actual Visit Date', 'Visit Date', 'วันที่เข้าชม', 'วันที่เยี่ยมชม');
  const leadDate = parseDateValue(rawLeadDate) || parseDateValue(rawVisitDate) || now;

  const contactedDate = parseDateValue(getVal('ติดต่อได้ (วันที่)', 'Contacted Date', 'วันที่ติดต่อได้', 'วันที่ติดต่อ')) || leadDate;
  const appointmentDate = parseDateValue(getVal('นัดชม (วันที่)', 'Appointment Date', 'วันนัดชม', 'วันนัด'));
  const actualVisitDate = parseDateValue(rawVisitDate);

  // Follow-up
  const rawFollowCount = getVal('Follow-up (ครั้ง)', 'Follow-up Count', 'จำนวนติดตาม', 'Follow-up');
  const followUpCount = rawFollowCount ? Math.max(0, parseInt(String(rawFollowCount).replace(/[^0-9]/g, '') || '0', 10)) : 0;
  const lastFollowUpDate = parseDateValue(getVal('Follow-up ล่าสุด', 'Last Follow-up Date', 'ติดตามล่าสุด'));

  // Plot & Booking
  const plotName = String(getVal('แปลงที่เล็ง/จอง', 'แปลง', 'Plot', 'Interested Plot', 'แปลงบ้าน', 'รหัสแปลง')).trim();
  const bookingDate = parseDateValue(getVal('จอง (วันที่)', 'Booking Date', 'วันจอง', 'วันที่จอง'));
  const rawAmount = getVal('มูลค่าจอง (บาท)', 'Booking Amount', 'เงินจอง', 'Sale Price', 'ราคาขาย', 'ราคา');
  const salePrice = parseMoneyValue(rawAmount);
  const bookingAmount = bookingDate ? (parseMoneyValue(getVal('มูลค่าจอง (บาท)', 'Booking Amount', 'เงินจอง')) || (salePrice ? Math.min(salePrice, 50000) : 10000)) : null;
  const landPrice = parseMoneyValue(getVal('ราคาประเมิน', 'Land Price', 'Land Office Price', 'ราคาที่ดิน'));

  // Finance & Transfer
  const loanSubmissionDate = parseDateValue(getVal('ยื่นกู้ (วันที่)', 'Loan Submission Date', 'วันยื่นกู้'));
  const loanApprovedDate = parseDateValue(getVal('อนุมัติ (วันที่)', 'Loan Approved Date', 'วันอนุมัติ'));
  const transferredDate = parseDateValue(getVal('โอน (วันที่)', 'Transfer Date', 'Transferred Date', 'วันโอน', 'วันที่โอน'));
  const cancelDate = parseDateValue(getVal('Cancel Date', 'Cancel Date', 'วันที่ยกเลิก'));

  // Lost Reason
  const rawLostReason = String(getVal('Lost Reason (เลือก)', 'Lost Reason', 'สาเหตุที่ไม่ซื้อ', 'เหตุผลที่ไม่ซื้อ')).trim();
  const lostReasonDetail = String(getVal('Lost Reason (ระบุ)', 'Lost Reason (ระบุ-อื่นๆ)', 'Lost Reason Detail', 'ระบุเหตุผล')).trim() || null;
  let lostReason: string | null = rawLostReason || null;
  if (!lostReason && (cancelDate || rawLostReason)) {
    lostReason = 'อื่นๆ (ระบุในช่องถัดไป)';
  }

  // CRM Status
  const rawCrm = String(getVal('CRM Status (เลือก)', 'CRM Status', 'สถานะ CRM', 'CRM')).trim();
  const rawStatus = String(getVal('Status', 'สถานะ', 'สถานะการขาย')).trim();
  const crmStatus = mapToCRMStatus(rawCrm, rawStatus || (transferredDate ? 'Transferred' : bookingDate ? 'Reserved' : 'Visit'));
  const legacyStatus = mapCRMStatusToLegacyStatus(crmStatus);

  // Auto Status text for badges
  let autoStatus = 'Lead เข้า';
  if (transferredDate || crmStatus.includes('โอน')) autoStatus = 'โอนแล้ว';
  else if (loanApprovedDate || crmStatus.includes('สินเชื่อผ่าน')) autoStatus = 'สินเชื่อผ่าน';
  else if (loanSubmissionDate || crmStatus.includes('Pre-Approve')) autoStatus = 'ยื่นกู้แล้ว';
  else if (bookingDate || crmStatus.includes('จองแล้ว')) autoStatus = 'จองแล้ว';
  else if (actualVisitDate) autoStatus = 'เข้าชมแล้ว';
  else if (appointmentDate) autoStatus = 'นัดชมแล้ว';
  else if (contactedDate) autoStatus = 'ติดต่อได้';

  const notes = String(getVal('หมายเหตุ', 'Notes', 'Remark', 'Note', 'บันทึก')).trim();
  const occupation = String(getVal('อาชีพ', 'Occupation')).trim();
  const interest = String(getVal('ความสนใจ', 'Interest', 'แบบบ้าน', 'แบบบ้านที่สนใจ')).trim() || 'Any';

  return {
    rowNum,
    customer_name: customerName,
    phone,
    project_name: projectName,
    channel,
    agent_name: agentName,
    lead_date: leadDate,
    contacted_date: contactedDate,
    appointment_date: appointmentDate,
    actual_visit_date: actualVisitDate,
    follow_up_count: followUpCount,
    last_follow_up_date: lastFollowUpDate,
    interested_plot_name: plotName,
    booking_date: bookingDate,
    booking_amount: bookingAmount,
    sale_price: salePrice,
    land_office_price: landPrice,
    loan_submission_date: loanSubmissionDate,
    loan_approved_date: loanApprovedDate,
    transferred_date: transferredDate,
    lost_reason: lostReason,
    lost_reason_detail: lostReasonDetail,
    crm_status: crmStatus,
    auto_status: autoStatus,
    notes,
    occupation,
    interest,
    legacy_status: legacyStatus
  };
}

/**
 * Generate 22-Column Excel Template (.xlsx) matching ailin_funnel_sep2569_v3
 */
export function downloadLeadTrackerTemplate(projectsList: string[] = ['ไอลิน 3', 'ไอลิน 4', 'ไอลิน 6', 'ไอลิน สันทราย 2'], agentName: string = 'Bell') {
  const sampleData = [
    {
      'No.': 1,
      'วันที่ Lead เข้า': '01/09/2026',
      'ชื่อลูกค้า': 'คุณสมชาย ใจดี',
      'เบอร์โทร': '0812345678',
      'โครงการ': projectsList[0] || 'ไอลิน 3',
      'ช่องทาง': 'Facebook',
      'เซลล์': agentName,
      'ติดต่อได้ (วันที่)': '01/09/2026',
      'นัดชม (วันที่)': '03/09/2026',
      'เข้าชมจริง (วันที่)': '03/09/2026',
      'Follow-up (ครั้ง)': 2,
      'Follow-up ล่าสุด': '05/09/2026',
      'แปลงที่เล็ง/จอง': 'A1',
      'จอง (วันที่)': '06/09/2026',
      'มูลค่าจอง (บาท)': 20000,
      'ยื่นกู้ (วันที่)': '10/09/2026',
      'อนุมัติ (วันที่)': '15/09/2026',
      'โอน (วันที่)': '',
      'Lost Reason (เลือก)': '',
      'Lost Reason (ระบุ)': '',
      'CRM Status (เลือก)': 'Loan Approved — สินเชื่อผ่าน',
      'หมายเหตุ': 'ลูกค้าชอบทำเลหน้าสวน เอกสารครบถ้วน'
    },
    {
      'No.': 2,
      'วันที่ Lead เข้า': '02/09/2026',
      'ชื่อลูกค้า': 'คุณสมหญิง สวยงาม',
      'เบอร์โทร': '0898765432',
      'โครงการ': projectsList[1] || 'ไอลิน 4',
      'ช่องทาง': 'Line OA',
      'เซลล์': agentName,
      'ติดต่อได้ (วันที่)': '02/09/2026',
      'นัดชม (วันที่)': '04/09/2026',
      'เข้าชมจริง (วันที่)': '04/09/2026',
      'Follow-up (ครั้ง)': 1,
      'Follow-up ล่าสุด': '04/09/2026',
      'แปลงที่เล็ง/จอง': 'B5',
      'จอง (วันที่)': '',
      'มูลค่าจอง (บาท)': '',
      'ยื่นกู้ (วันที่)': '',
      'อนุมัติ (วันที่)': '',
      'โอน (วันที่)': '',
      'Lost Reason (เลือก)': '',
      'Lost Reason (ระบุ)': '',
      'CRM Status (เลือก)': 'Considering — กำลังพิจารณา / เปรียบเทียบ',
      'หมายเหตุ': 'เปรียบเทียบกับโครงการใกล้เคียง นัดติดตามอีกครั้งวันเสาร์'
    },
    {
      'No.': 3,
      'วันที่ Lead เข้า': '03/09/2026',
      'ชื่อลูกค้า': 'คุณมานะ อดทน',
      'เบอร์โทร': '0833334444',
      'โครงการ': projectsList[2] || 'ไอลิน 6',
      'ช่องทาง': 'Walk in',
      'เซลล์': agentName,
      'ติดต่อได้ (วันที่)': '03/09/2026',
      'นัดชม (วันที่)': '03/09/2026',
      'เข้าชมจริง (วันที่)': '03/09/2026',
      'Follow-up (ครั้ง)': 1,
      'Follow-up ล่าสุด': '05/09/2026',
      'แปลงที่เล็ง/จอง': 'C10',
      'จอง (วันที่)': '',
      'มูลค่าจอง (บาท)': '',
      'ยื่นกู้ (วันที่)': '',
      'อนุมัติ (วันที่)': '',
      'โอน (วันที่)': '',
      'Lost Reason (เลือก)': 'งบประมาณไม่ถึง / ราคาสูงเกิน',
      'Lost Reason (ระบุ)': 'เกินวงเงินที่ตั้งงบไว้ 3 ล้าน',
      'CRM Status (เลือก)': 'Lost — ยุติการซื้อ / ไม่จอง',
      'หมายเหตุ': 'แนะนำโครงการเฟสถัดไป'
    }
  ];

  const guideRows = [
    { 'คอลัมน์': 'No.', 'คำอธิบาย': 'ลำดับที่ (ตัวเลข 1, 2, 3...)', 'ตัวอย่าง': '1' },
    { 'คอลัมน์': 'วันที่ Lead เข้า', 'คำอธิบาย': 'วันที่ลูกค้าติดต่อเข้ามาครั้งแรก (วว/ดด/ปปปป)', 'ตัวอย่าง': '01/09/2026' },
    { 'คอลัมน์': 'ชื่อลูกค้า (*บังคับ)', 'คำอธิบาย': 'ชื่อและนามสกุลลูกค้า (ห้ามเว้นว่าง)', 'ตัวอย่าง': 'คุณสมชาย ใจดี' },
    { 'คอลัมน์': 'เบอร์โทร', 'คำอธิบาย': 'เบอร์โทรศัพท์ติดต่อ', 'ตัวอย่าง': '0812345678' },
    { 'คอลัมน์': 'โครงการ', 'คำอธิบาย': `ชื่อโครงการ เช่น ${projectsList.join(', ')}`, 'ตัวอย่าง': projectsList[0] || 'ไอลิน 6' },
    { 'คอลัมน์': 'ช่องทาง', 'คำอธิบาย': 'Facebook, Line OA, Line ส่วนตัว, Walk in, โทร, TikTok, Youtube, Lemon8, Billboard, Referral, Other', 'ตัวอย่าง': 'Facebook' },
    { 'คอลัมน์': 'เซลล์', 'คำอธิบาย': 'ชื่อพนักงานขายที่ดูแล', 'ตัวอย่าง': agentName },
    { 'คอลัมน์': 'ติดต่อได้ (วันที่)', 'คำอธิบาย': 'วันที่เซลล์โทร/แชทคุยกับลูกค้าสำเร็จ', 'ตัวอย่าง': '01/09/2026' },
    { 'คอลัมน์': 'นัดชม (วันที่)', 'คำอธิบาย': 'วันที่นัดหมายลูกค้าเข้ามาดูโครงการ', 'ตัวอย่าง': '03/09/2026' },
    { 'คอลัมน์': 'เข้าชมจริง (วันที่)', 'คำอธิบาย': 'วันที่ลูกค้าเข้ามาถึงโครงการจริง', 'ตัวอย่าง': '03/09/2026' },
    { 'คอลัมน์': 'Follow-up (ครั้ง)', 'คำอธิบาย': 'จำนวนครั้งที่โทร/แชทติดตามลูกค้า', 'ตัวอย่าง': '2' },
    { 'คอลัมน์': 'Follow-up ล่าสุด', 'คำอธิบาย': 'วันที่ติดตามลูกค้าครั้งล่าสุด', 'ตัวอย่าง': '05/09/2026' },
    { 'คอลัมน์': 'แปลงที่เล็ง/จอง', 'คำอธิบาย': 'รหัสแปลงบ้าน เช่น A1, B5, C10', 'ตัวอย่าง': 'A1' },
    { 'คอลัมน์': 'จอง (วันที่)', 'คำอธิบาย': 'วันที่ทำสัญญาจอง (ถ้ายังไม่จองให้เว้นว่าง)', 'ตัวอย่าง': '06/09/2026' },
    { 'คอลัมน์': 'มูลค่าจอง (บาท)', 'คำอธิบาย': 'จำนวนเงินจอง (ตัวเลขเท่านั้น)', 'ตัวอย่าง': '20000' },
    { 'คอลัมน์': 'ยื่นกู้ (วันที่)', 'คำอธิบาย': 'วันที่ยื่นเอกสารเข้าธนาคาร', 'ตัวอย่าง': '10/09/2026' },
    { 'คอลัมน์': 'อนุมัติ (วันที่)', 'คำอธิบาย': 'วันที่ธนาคารแจ้งผลอนุมัติสินเชื่อ', 'ตัวอย่าง': '15/09/2026' },
    { 'คอลัมน์': 'โอน (วันที่)', 'คำอธิบาย': 'วันที่โอนกรรมสิทธิ์ ณ กรมที่ดิน', 'ตัวอย่าง': '' },
    { 'คอลัมน์': 'Lost Reason (เลือก)', 'คำอธิบาย': LOST_REASON_OPTIONS.join(' | '), 'ตัวอย่าง': 'งบประมาณไม่ถึง / ราคาสูงเกิน' },
    { 'คอลัมน์': 'Lost Reason (ระบุ)', 'คำอธิบาย': 'รายละเอียดเพิ่มเติมกรณีไม่ซื้อ', 'ตัวอย่าง': 'เกินงบ 5 แสน' },
    { 'คอลัมน์': 'CRM Status (เลือก)', 'คำอธิบาย': CRM_STATUS_OPTIONS.join(' | '), 'ตัวอย่าง': 'Follow-up — อยู่ระหว่างติดตาม' },
    { 'คอลัมน์': 'หมายเหตุ', 'คำอธิบาย': 'บันทึกเพิ่มเติมของเซลล์', 'ตัวอย่าง': 'ลูกค้าชอบบ้านแปลงมุม' }
  ];

  const ws = XLSX.utils.json_to_sheet(sampleData);
  const guideWs = XLSX.utils.json_to_sheet(guideRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Lead Tracker');
  XLSX.utils.book_append_sheet(wb, guideWs, 'คำแนะนำการกรอก (Guide)');
  XLSX.writeFile(wb, `Ailin_Lead_Tracker_Template_22Cols.xlsx`);
}
