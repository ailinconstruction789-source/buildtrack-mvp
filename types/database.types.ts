export interface Project {
  id: string;
  name: string;
  created_at: string;
  plotCount: number;
  progress: number;
}

export interface HouseType {
  id: string;
  type_name: string;
  memo?: string;
  visual_config?: Record<string, any>;
  created_at: string;
}

export interface TaskTemplate {
  id: string;
  house_type_id: string;
  task_name: string;
  task_order: number;
  cost: number;
  require_qc?: boolean;
  created_at: string;
}

export interface Plot {
  id: string;
  plot_name?: string;
  project_name: string;
  house_type_id: string;
  foreman_name?: string;
  foreman?: string;
  sale_status?: string;
  paused_for_sale_at?: string;
  is_completed: boolean;
  progress: number;
  has_customer: boolean;
  type?: string;
  overview_image_url?: string;
  created_at: string;
  house_types?: { type_name: string };
}

export interface Contractor {
  id: string;
  name: string;
  phone?: string;
  created_at: string;
}

export interface User {
  id: string;
  username: string;
  role: string;
  last_seen_at?: string;
  created_at: string;
}

export interface PlotTaskAssignment {
  id: string;
  plot_id: string;
  task_template_id: string;
  task_name: string;
  contractor_name?: string;
  contractor_phone?: string;
  current_progress: number;
  actual_start_date?: string;
  actual_end_date?: string;
  created_at: string;
}

export interface PlotTaskSchedule {
  id: string;
  plot_id: string;
  task_template_id: string;
  planned_start: string;
  planned_end: string;
  created_at: string;
}

export interface TaskUpdate {
  id: string;
  plot_id: string;
  task_template_id: string;
  progress: number;
  action: string;
  role: string;
  user_name: string;
  text_content: string;
  created_at: string;
  updated_by?: string;
  images?: string[];
  [key: string]: any; // Allows dynamically accessing extra fields
}

export interface Defect {
  id: string;
  plot_id: string;
  task_id: string;
  description: string;
  status: string;
  reported_by: string;
  created_at: string;
  updated_at: string;
  image_url?: string;
  images?: string[];
  resolved_by?: string;
}

export interface Notification {
  id: string;
  target_user?: string;
  target_role?: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  plot_id?: string;
  task_template_id?: string;
}

export interface MaterialRequest {
  id: string;
  plot_id: string;
  task_template_id: string;
  item_name: string;
  quantity: number;
  status: string;
  requested_by?: string;
  created_at: string;
}
