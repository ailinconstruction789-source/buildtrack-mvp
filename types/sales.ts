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

export interface Lead {
  id: string;
  project_id?: string;
  project_name?: string;
  customer_name: string;
  phone?: string;
  channel?: string;
  source?: string;
  agent_name?: string;
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

