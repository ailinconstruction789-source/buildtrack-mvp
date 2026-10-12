import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FollowUp from '../CentralLeadFollowUpModal';
import Appointment from '../CentralVisitAppointmentModal';

const mocks = vi.hoisted(() => ({ activity: vi.fn(), update: vi.fn(), updateResult: vi.fn(), insert: vi.fn() }));
vi.mock('@/lib/sales/leadActivity', () => ({
  readLeadActivitySnapshot: async (customer: Record<string, unknown>) => ({ lead: customer, historyExists: false }),
  writeLeadActivitySummary: async (snapshot: { lead: Record<string, unknown> }, payload: unknown) => {
    const result = await mocks.update(payload).eq('id', snapshot.lead.id);
    if (result.error) throw result.error;
  },
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => table === 'lead_activities' ? {
  insert: mocks.activity,
  select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
} : { insert: mocks.insert, update: mocks.update } } }));
vi.mock('@/lib/sales/plotAvailabilityClient', () => ({ loadAvailablePlots: async () => [] }));

const owners = [{ userId: 'sales-1', displayName: 'Sales A' }];
const projects = ['Project A'];
const customer = { id: 'lead-1', leadId: 'lead-1', name: 'Customer A', ownerUserId: 'sales-1',
  salesOwner: 'Sales A', notes: 'existing history', status: 'Booked', crm_status: 'Booked — จองแล้ว' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.activity.mockResolvedValue({ error: null });
  mocks.insert.mockResolvedValue({ error: null });
  mocks.updateResult.mockResolvedValue({ error: null });
  mocks.update.mockImplementation(() => ({ eq: mocks.updateResult }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function submitFollowUp() {
  fireEvent.change(screen.getByPlaceholderText(/พิมพ์ข้อความสรุปการสนทนา/), { target: { value: 'called about handover' } });
  fireEvent.click(screen.getByRole('button', { name: /บันทึกการติดตาม$/ }));
}

describe('contact activities preserve the deal and truthful save feedback', () => {
  it.each(['follow-up', 'appointment'])('prevents a construction role from saving %s even if the form is submitted directly', async form => {
    if (form === 'follow-up') {
      render(<FollowUp isOpen onClose={vi.fn()} currentUserRole="Foreman" customer={customer} projects={projects} salesOwners={owners} />);
      expect(screen.getByRole('button', { name: /บันทึกการติดตาม$/ })).toBeDisabled();
      fireEvent.submit(document.getElementById('followup-form')!);
    } else {
      render(<Appointment isOpen onClose={vi.fn()} currentUserRole="Foreman" customer={customer} projects={projects} salesOwners={owners} />);
      expect(screen.getByRole('button', { name: 'บันทึกนัดหมายเข้าชม' })).toBeDisabled();
      fireEvent.submit(document.getElementById('visit-appointment-form')!);
    }
    expect(await screen.findByText('บัญชีนี้ดูข้อมูลได้อย่างเดียว')).toBeInTheDocument();
    expect(mocks.activity).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it.each(['Booked', 'Transferred', 'Rented', 'Cancelled', 'Loan Processing'])('keeps %s read-only while allowing a contact result', async (status) => {
    const onSaved = vi.fn();
    render(<FollowUp isOpen onClose={vi.fn()} onSaved={onSaved} customer={{ ...customer, status, crm_status: status }} projects={projects} salesOwners={owners} />);
    expect(screen.getByRole('combobox', { name: 'สถานะลูกค้า' })).toBeDisabled();
    submitFollowUp();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const payload = mocks.update.mock.calls[0][0];
    expect(payload).not.toHaveProperty('status');
    expect(payload).not.toHaveProperty('crm_status');
    expect(payload.notes).toContain('called about handover');
    expect(payload.notes).toContain('existing history');
  });

  it('does not update or close after an activity insertion resolves with an error', async () => {
    mocks.activity.mockResolvedValue({ error: { message: 'history denied' } });
    const close = vi.fn(), saved = vi.fn();
    render(<FollowUp isOpen onClose={close} onSaved={saved} customer={customer} projects={projects} salesOwners={owners} />);
    submitFollowUp();
    expect(await screen.findByText('history denied')).toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
  });

  it('reports a partial save and retries the same summary without inserting duplicate history', async () => {
    mocks.updateResult.mockResolvedValueOnce({ error: { message: 'lead denied' } }).mockResolvedValue({ error: null });
    const saved = vi.fn();
    render(<FollowUp isOpen onClose={vi.fn()} onSaved={saved} customer={customer} projects={projects} salesOwners={owners} />);
    submitFollowUp();
    expect(await screen.findByText(/ประวัติการติดตามบันทึกแล้ว.*lead denied/)).toBeInTheDocument();
    expect(saved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /บันทึกการติดตาม$/ }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(mocks.activity).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });

  it('updates an identified booked lead appointment without creating a duplicate or clearing its plot', async () => {
    const saved = vi.fn();
    render(<Appointment isOpen onClose={vi.fn()} onSaved={saved} customer={customer} projects={projects} salesOwners={owners} />);
    fireEvent.change(screen.getByPlaceholderText(/เช่น ลูกค้าสะดวกช่วงบ่าย/), { target: { value: 'new appointment note' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกนัดหมายเข้าชม' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.updateResult).toHaveBeenCalledWith('id', 'lead-1');
    const payload = mocks.update.mock.calls[0][0];
    expect(payload).not.toHaveProperty('status');
    expect(payload).not.toHaveProperty('crm_status');
    expect(payload).not.toHaveProperty('interested_plot_id');
    expect(payload.notes).toContain('existing history');
    expect(payload.notes).toContain('new appointment note');
  });

  it('leaves an identified appointment open when its update resolves with an error', async () => {
    mocks.updateResult.mockResolvedValue({ error: { message: 'appointment denied' } });
    const close = vi.fn(), saved = vi.fn();
    render(<Appointment isOpen onClose={close} onSaved={saved} customer={customer} projects={projects} salesOwners={owners} />);
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกนัดหมายเข้าชม' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('appointment denied');
    expect(close).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
  });
});
