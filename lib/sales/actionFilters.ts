import { getLeadStage, type LeadStageInput } from './leadStage';
interface ActionLead extends LeadStageInput { last_follow_up_date?: unknown }
const dateKey = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : '';
export const bangkokToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export function isDueSalesLead(lead: ActionLead, today: string) {
  return ['active', 'appointment', 'loan'].includes(getLeadStage(lead)) &&
    [lead.appointment_date, lead.last_follow_up_date].some(value => Boolean(dateKey(value)) && dateKey(value) <= today);
}
export const isUpcomingSalesLead = (lead: ActionLead, today: string) => Boolean(dateKey(lead.appointment_date)) && dateKey(lead.appointment_date) >= today;
