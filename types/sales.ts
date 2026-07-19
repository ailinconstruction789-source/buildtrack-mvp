export interface Lead {
  id: string;
  project_id: string;
  customer_name: string;
  phone: string;
  source: 'Facebook' | 'Referral' | 'Walk-in' | 'Billboard';
  status: 'New' | 'Contacted' | 'Visiting' | 'Negotiation' | 'Closed' | 'Cancelled';
  agent_name: string;
  created_at: string;
  updated_at: string;
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
