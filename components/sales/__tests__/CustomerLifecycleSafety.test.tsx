import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), activity: vi.fn() }));
vi.mock('@/lib/sales/leadActivity', () => ({ readLeadActivitySnapshot: mocks.read, writeLeadActivitySummary: mocks.write }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({
  insert: mocks.activity,
  select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
}) } }));
vi.mock('@/lib/sales/plotAvailabilityClient', () => ({ loadAvailablePlots: async () => [] }));
import FollowUp from '../CentralLeadFollowUpModal';
import Appointment from '../CentralVisitAppointmentModal';
import Checklist from '../HouseVisitChecklistModal';
const customer = { id: 'L1', leadId: 'L1', customer_name: 'Fixture customer', status: 'Visit', notes: 'displayed notes', salesOwner: 'Sales A' };
const owners = [{ userId: 'U1', displayName: 'Sales A' }];
const projects = ['Fixture project'];
const latest = { ...customer, notes: 'fresh concurrent notes', updated_at: 'revision-2' };
beforeEach(() => {
  vi.clearAllMocks(); mocks.read.mockReset(); mocks.write.mockReset(); mocks.activity.mockReset();
  mocks.read.mockResolvedValue({ lead: latest, historyExists: false });
  mocks.write.mockResolvedValue(undefined); mocks.activity.mockResolvedValue({ error: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function followProps() { return { isOpen: true, customer, salesOwners: owners, projects, currentUserRole: 'Sales', currentUserId: 'U1', onClose: vi.fn(), onSaved: vi.fn() }; }
const input = () => screen.getByPlaceholderText(/พิมพ์ข้อความสรุปการสนทนา/);
function followSubmit() { fireEvent.change(input(), { target: { value: 'customer not interested' } }); fireEvent.submit(document.getElementById('followup-form')!); }
describe('pre-booking workflow through the actual forms (fixture requests only)', () => {
  it('records Lost with a reason and merges fresh notes into the same Lead, without creating a customer', async () => {
    const props = followProps(); render(<FollowUp {...props} />);
    expect(screen.getByText('Fixture customer')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'สถานะลูกค้า' }), { target: { value: 'Lost' } }); followSubmit();
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce());
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ lead: latest }), expect.objectContaining({ status: 'Lost', crm_status: 'Lost — ไม่สนใจ / ยุติการติดตาม', notes: expect.stringContaining('fresh concurrent notes') }));
    expect(mocks.activity).toHaveBeenCalledWith([expect.objectContaining({ native_lead_id: 'L1' })]);
  });
  it('requires a recorded reason before a Lost write', () => {
    render(<FollowUp {...followProps()} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'สถานะลูกค้า' }), { target: { value: 'Lost' } });
    fireEvent.submit(document.getElementById('followup-form')!);
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.activity).not.toHaveBeenCalled();
  });
  it.each(['fresh booking', 'linked sale', 'linked rental'])('blocks Lost if %s is discovered after opening an old Visit form', async kind => {
    mocks.read.mockResolvedValue({ lead: kind === 'fresh booking' ? { ...latest, status: 'Booked' } : latest, historyExists: kind !== 'fresh booking' });
    const props = followProps(); render(<FollowUp {...props} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'สถานะลูกค้า' }), { target: { value: 'Lost' } }); followSubmit();
    await screen.findByText(/ไม่เปลี่ยนเป็น Lost/);
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.activity).not.toHaveBeenCalled(); expect(props.onClose).not.toHaveBeenCalled();
  });
  it('allows a follow-up note after another user books, without reverting the freshly loaded deal', async () => {
    mocks.read.mockResolvedValue({ lead: { ...latest, status: 'Booked', crm_status: 'Booked' }, historyExists: true });
    const props = followProps(); render(<FollowUp {...props} />); followSubmit();
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    expect(mocks.write.mock.calls[0][1]).not.toHaveProperty('status'); expect(mocks.write.mock.calls[0][1]).not.toHaveProperty('crm_status');
  });
  it('retains the draft when the same Lead is refreshed in the background', () => {
    const props = followProps(); const view = render(<FollowUp {...props} />);
    fireEvent.change(input(), { target: { value: 'unsaved discussion' } });
    view.rerender(<FollowUp {...props} customer={{ ...customer, notes: 'new background note' }} salesOwners={[...owners]} projects={[...projects]} />);
    expect(input()).toHaveValue('unsaved discussion');
  });
  it('rejects a revision conflict, retaining the acknowledged activity and retrying only the summary', async () => {
    mocks.write.mockRejectedValueOnce(new Error('revision changed')).mockResolvedValue(undefined);
    const props = followProps(); render(<FollowUp {...props} />); followSubmit();
    await screen.findByText(/ประวัติการติดตามบันทึกแล้ว.*revision changed/); expect(props.onSaved).not.toHaveBeenCalled();
    fireEvent.submit(document.getElementById('followup-form')!);
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce()); expect(mocks.activity).toHaveBeenCalledOnce();
  });
  it('does not continue writing when an account changes while the fresh read is pending', async () => {
    let release!: (value: unknown) => void; mocks.read.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const props = followProps(); const view = render(<FollowUp {...props} />); followSubmit();
    view.rerender(<FollowUp {...props} currentUserId="U2" currentUserRole="Owner" />);
    await act(async () => release({ lead: latest, historyExists: false }));
    expect(mocks.activity).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled(); expect(props.onSaved).not.toHaveBeenCalled();
  });
  it('does not overwrite a late booking or its plot when saving a visit appointment', async () => {
    mocks.read.mockResolvedValue({ lead: { ...latest, status: 'Booked' }, historyExists: true });
    const props = followProps(); render(<Appointment {...props} />);
    fireEvent.change(screen.getByPlaceholderText(/เช่น ลูกค้าสะดวกช่วงบ่าย/), { target: { value: 'visit booked home' } });
    fireEvent.submit(document.getElementById('visit-appointment-form')!);
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    const patch = mocks.write.mock.calls[0][1];
    expect(patch).not.toHaveProperty('status'); expect(patch).not.toHaveProperty('interested_plot_id'); expect(patch.notes).toContain('fresh concurrent notes');
  });
  it('retains the appointment form when the latest Lead cannot be read', async () => {
    mocks.read.mockRejectedValue(new Error('lead read denied'));
    const props = followProps(); render(<Appointment {...props} />); fireEvent.submit(document.getElementById('visit-appointment-form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('lead read denied'); expect(mocks.write).not.toHaveBeenCalled(); expect(props.onClose).not.toHaveBeenCalled();
  });
  it('does not invent completed preparation/tour evidence or reset a booking when saving a late visit recap', async () => {
    mocks.read.mockResolvedValue({ lead: { ...latest, status: 'Booked', crm_status: 'Booked', actual_visit_date: '2026-10-01T01:00:00Z' }, historyExists: true });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    const props = followProps(); render(<Checklist isOpen lead={customer as never} user={{ id: 'U1', role: 'Sales' }} initialStage="stage_c" onClose={props.onClose} onSaved={props.onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: /เสร็จสิ้น SOP/ }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    expect(mocks.activity.mock.calls[0][0][0]).toMatchObject({ stage: 'stage_c', stage_a_completed_at: null, stage_b_started_at: null, stage_c_completed_at: null });
    expect(mocks.write.mock.calls[0][1]).not.toHaveProperty('status'); expect(mocks.write.mock.calls[0][1]).not.toHaveProperty('interested_plot_name');
    expect(mocks.write.mock.calls[0][1]).toMatchObject({ actual_visit_date: '2026-10-01T01:00:00Z', notes: expect.stringContaining('fresh concurrent notes') });
  });
  it('does not write a SOP recap after an account switch during its read', async () => {
    let release!: (value: unknown) => void; mocks.read.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const props = followProps(); const view = render(<Checklist isOpen lead={customer as never} user={{ id: 'U1', role: 'Sales' }} initialStage="stage_c" onClose={props.onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /เสร็จสิ้น SOP/ }));
    view.rerender(<Checklist isOpen lead={customer as never} user={{ id: 'U2', role: 'Owner' }} initialStage="stage_c" onClose={props.onClose} />);
    await act(async () => release({ lead: latest, historyExists: false }));
    expect(mocks.activity).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
});
