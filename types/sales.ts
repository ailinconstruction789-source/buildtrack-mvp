export type MarketingChannel = 'Facebook' | 'Line OA' | 'Line ส่วนตัว' | 'Walk in' | 'โทร' | 'TikTok' | 'Youtube' | 'Lemon8' | 'Billboard' | 'Referral' | 'Other';

export type CRMStatus = 
  | 'Follow-up — อยู่ระหว่างติดตาม'
  | 'Considering — กำลังพิจารณา / เปรียบเทียบ'
  | 'Loan Pre-Approval — อยู่ระหว่างเช็ก/ยื่น Pre-Approve'
  | 'Booking Pending — มีแนวโน้มจอง รอการตัดสินใจ'
  | 'Booked — จองแล้ว'
  | 'Contracted — ทำสัญญาแล้ว'
  | 'Loan Approved — สินเชื่อผ่าน'
  | 'Transfer Pending — รอโอน'
  | 'Transferred / Won — โอนกรรมสิทธิ์สำเร็จ'
  | 'Rented / Active — ทำสัญญาเช่าแล้ว (อยู่ระหว่างเช่า)'
  | 'Rent-to-Own / Active — สัญญาเช่าซื้อ/เช่าออม (สะสมเงินดาวน์)'
  | 'Lease Ended / Moved Out — สิ้นสุดสัญญาเช่า (ย้ายออก)'
  | 'Converted from Rent to Buy — เปลี่ยนจากเช่าเป็นซื้อ'
  | 'Lost — ยุติการซื้อ / ไม่จอง'
  | 'Unreachable — ติดต่อไม่ได้'
  | 'Not Ready — ยังไม่พร้อมซื้อ รอในอนาคต'
  | 'Nurture — เก็บไว้ติดตามระยะยาว';

export type LostReason = 
  | 'งบประมาณไม่ถึง / ราคาสูงเกิน'
  | 'กู้ไม่ผ่าน / สถาบันการเงินปฏิเสธ'
  | 'ทำเลไม่ตรงความต้องการ'
  | 'ยังไม่พร้อมซื้อ / รอดูก่อน'
  | 'เลือกโครงการอื่น / เปรียบเทียบแล้วเลือกที่อื่น'
  | 'อื่นๆ (ระบุในช่องถัดไป)';

export type RentalProgramType = 'program_a' | 'program_b' | 'program_c';

export const RENTAL_PROGRAM_DETAILS = {
  program_a: {
    id: 'program_a',
    code: 'A',
    name: 'Rent (เช่า)',
    tagline: 'อยู่สบาย ไม่ต้องซื้อ',
    badgeColor: 'bg-blue-100 text-blue-800 border-blue-200',
    minDurationMonths: 12,
    depositMonths: 2,
    description: 'ค่าเช่าตามยูนิต เงินประกันบ้าน 2 เดือน สัญญาเช่าขั้นต่ำ 12 เดือน ค่าเช่าเป็นค่าอยู่อาศัย'
  },
  program_b: {
    id: 'program_b',
    code: 'B',
    name: 'Rent to Own (เช่าซื้อ)',
    tagline: 'เช่าก่อน มีสิทธิ์เป็นเจ้าของ',
    badgeColor: 'bg-amber-100 text-amber-800 border-amber-200',
    minDurationMonths: 12,
    savingsPerMonthDefault: 5000,
    description: 'ชำระค่าเช่ารายเดือน พร้อมเงินสะสมเพื่อซื้อบ้าน 5,000 บาท/เดือน เมื่อโอนกรรมสิทธิ์ หักเฉพาะเงินสะสมที่ชำระจริงจากราคาบ้าน'
  },
  program_c: {
    id: 'program_c',
    code: 'C',
    name: 'Rent and Save (เช่าออม)',
    tagline: 'เช่าบ้าน พร้อมออมเงิน',
    badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    minDurationMonths: 12,
    discount1YrPct: 10,
    discount2YrPct: 5,
    description: 'เช่าบ้านพร้อมออมเงิน ใช้ราคาตั้งเป็น Base Price โอนบ้านภายใน 1 ปี ลดราคา 10% / ภายใน 2 ปี ลด 5%'
  }
} as const;

export type RentalContractStatus = 'Active' | 'Renewed' | 'ConvertedToBuy' | 'MovedOut' | 'Cancelled';

export type RentalPaymentStatus = 'Paid' | 'Pending' | 'Overdue' | 'Waived';

export interface RentalPaymentRecord {
  id?: string;
  contract_id?: string;
  lead_id?: string | null;
  plot_id?: string;
  plot_name?: string | null;
  project_name?: string;
  tenant_name?: string;
  period_month: number; // 1, 2, 3...
  period_label: string; // e.g. "งวดที่ 1 (ม.ค. 2026)"
  due_date: string; // YYYY-MM-DD
  amount_due: number;
  amount_paid: number;
  savings_amount?: number; // For Program B (e.g. 5,000)
  paid_date?: string | null;
  payment_status: RentalPaymentStatus;
  payment_method?: 'transfer' | 'cash' | 'credit_card' | 'other' | null;
  slip_url?: string | null;
  notes?: string | null;
  recorded_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface RentalPaymentSummary {
  totalPeriods: number;
  paidPeriods: number;
  pendingPeriods: number;
  overduePeriods: number;
  totalAmountDue: number;
  totalAmountPaid: number;
  totalRemaining: number;
  totalAccumulatedSavings: number; // for Program B
  isAllPaid: boolean;
  hasOverdue: boolean;
}

export interface RentalContract {
  id: string;
  lead_id?: string | null;
  project_name: string;
  plot_id: string;
  plot_name?: string | null;
  tenant_name: string;
  tenant_phone?: string | null;
  agent_name: string;
  program_type: RentalProgramType;
  monthly_rent: number;
  security_deposit: number;
  advance_rent: number;
  savings_per_month?: number; // For Program B (default 5,000)
  accumulated_savings?: number;
  base_price?: number; // For Program C Base Price
  discount_1yr_pct?: number; // 10%
  discount_2yr_pct?: number; // 5%
  lease_duration_months: number;
  lease_start_date: string;
  lease_end_date: string;
  status: RentalContractStatus;
  move_out_date?: string | null;
  deposit_refunded?: number | null;
  conversion_date?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface Lead {
  id: string;
  project_id?: string;
  project_name?: string;
  customer_name: string;
  phone?: string;
  channel?: string;
  source?: string;
  agent_name?: string;
  sales_owner?: string;
  salesOwner?: string;
  created_by_agent?: string;
  closing_agent?: string;
  occupation?: string;
  interest?: string;
  status?: string; // Legacy status or quick status
  crm_status?: CRMStatus | string;
  auto_status?: string;
  
  // Funnel Dates
  lead_date?: string;
  contacted_date?: string | null;
  appointment_date?: string | null;
  actual_visit_date?: string | null;
  follow_up_count?: number;
  last_follow_up_date?: string | null;
  
  // Plot & Booking
  interested_plot_id?: string | null;
  interested_plot_name?: string | null;
  booking_date?: string | null;
  booking_amount?: number | null;
  
  // Rental Fields
  deal_type?: 'buy' | 'rent' | 'rent_to_own' | null;
  rental_program?: RentalProgramType | null;
  rental_monthly_rent?: number | null;
  rental_deposit?: number | null;
  rental_savings_per_month?: number | null;
  rental_accumulated_savings?: number | null;
  rental_base_price?: number | null;
  rental_start_date?: string | null;
  rental_end_date?: string | null;
  rental_status?: RentalContractStatus | null;
  active_rental_contract_id?: string | null;

  // Finance & Transfer
  loan_submission_date?: string | null;
  loan_approved_date?: string | null;
  transferred_date?: string | null;
  
  // Lost Reason
  lost_reason?: LostReason | string | null;
  lost_reason_detail?: string | null;
  notes?: string | null;
  
  created_at: string;
  updated_at?: string;
}

export interface CustomerVoice {
  id: string;
  lead_id?: string;
  survey_date: string;
  customer_name: string;
  nickname?: string;
  age?: string;
  gender?: string;
  phone?: string;
  line_id?: string;
  project_name?: string;
  agent_name?: string;
  marital_status?: string;
  education_level?: string;
  occupation?: string;
  monthly_income?: string;
  family_members?: string;
  previous_residence?: string;
  monthly_rent?: number;
  
  // Purpose
  purpose_relocate?: boolean;
  purpose_family_expansion?: boolean;
  purpose_independence?: boolean;
  purpose_rent_to_own?: boolean;
  purpose_debt_consolidation?: boolean;
  
  // Reason
  reason_price?: boolean;
  reason_location?: boolean;
  reason_promotion?: boolean;
  reason_design?: boolean;
  reason_house_type?: boolean;
  reason_other?: string;
  
  // Source
  source_facebook?: boolean;
  source_tiktok?: boolean;
  source_youtube?: boolean;
  source_billboard?: boolean;
  source_other?: string;
  
  // Scores 1-5
  score_knowledge?: number;
  score_problem_solving?: number;
  score_service_mind?: number;
  score_appearance?: number;
  score_cleanliness?: number;
  score_house_design?: number;
  score_price?: number;
  score_location?: number;
  score_average?: number;
  
  created_at?: string;
}

export interface Sale {
  id: string;
  lead_id: string;
  plot_id: string;
  sale_price: number;
  booking_amount: number;
  contract_status: 'Reserved' | 'Contracted' | 'Transferred' | 'Cancelled';
  bank_status: 'Pending' | 'Pre-approved' | 'Rejected' | 'Approved';
  cancellation_reason?: string;
  transferred_at?: string;
  created_at: string;
  updated_at: string;
}

export interface CycleTimeStats {
  lead_id: string;
  hours_to_contact: number;
  days_to_close: number;
}

export interface RentalMaintenanceTicket {
  id: string;
  contract_id?: string | null;
  lead_id?: string | null;
  plot_id: string;
  plot_name?: string;
  project_name: string;
  tenant_name: string;
  tenant_phone?: string;
  category: 'plumbing' | 'air_conditioner' | 'electrical' | 'structure' | 'appliance' | 'other';
  title: string;
  description: string;
  reported_date: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'Reported' | 'Assigned' | 'InProgress' | 'Completed' | 'Cancelled';
  assigned_to?: string;
  estimated_cost?: number;
  actual_cost?: number;
  is_tenant_responsible: boolean; // if true, deduct from deposit on move-out
  resolved_date?: string | null;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface RentalReceiptData {
  receiptNo: string;
  receiptType: 'receipt' | 'invoice';
  issueDate: string;
  dueDate?: string;
  projectName: string;
  plotName: string;
  tenantName: string;
  tenantPhone?: string;
  periodLabel: string;
  programName: string;
  programCode: string;
  rentAmount: number;
  savingsAmount?: number;
  securityDeposit?: number;
  advanceRent?: number;
  totalAmount: number;
  paidAmount?: number;
  paymentMethod?: string;
  paymentStatus: 'Paid' | 'Pending' | 'Overdue';
  companyName: string;
  promptPayId?: string;
  agentName?: string;
  notes?: string;
}

export interface RentalAlertItem {
  id: string;
  type: 'lease_expiring_30' | 'lease_expiring_60' | 'rent_overdue' | 'maintenance_urgent';
  title: string;
  description: string;
  plotId: string;
  plotName: string;
  projectName: string;
  tenantName: string;
  tenantPhone?: string;
  leadId?: string;
  contractId?: string;
  dueDateOrExpiry: string;
  amount?: number;
  severity: 'warning' | 'danger' | 'info';
}


