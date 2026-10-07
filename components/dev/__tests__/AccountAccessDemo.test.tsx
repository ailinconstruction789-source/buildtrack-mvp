import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AccountAccessDemo from '../AccountAccessDemo';

const selectAccount = (id: string) => fireEvent.change(screen.getByLabelText('เลือกบัญชี Sales สมมติ'), { target: { value: id } });
const approveButton = () => screen.getByRole('button', { name: 'รับรองและเปิดสิทธิ์ (ทดลอง)' });
function fillReview() {
  fireEvent.change(screen.getByLabelText('เหตุผลที่เปิดสิทธิ์ใหม่ *'), { target: { value: 'ตรวจตัวอย่างแล้ว' } });
  fireEvent.change(screen.getByLabelText('หลักฐานอ้างอิงการตรวจ *'), { target: { value: 'DEMO-001' } });
  fireEvent.click(screen.getByRole('checkbox'));
}
afterEach(() => vi.unstubAllGlobals());

describe('account access demonstration UI', () => {
  it('marks the entire page as synthetic, does not ask for credentials or make requests', () => {
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
    render(<AccountAccessDemo />);
    expect(screen.getByLabelText('ขอบเขตการทดลอง')).toHaveTextContent('ไม่เชื่อม Supabase');
    expect(screen.queryByLabelText(/PIN|Password/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'จำลองแบนบัญชี' }));
    fireEvent.click(screen.getByRole('button', { name: 'จำลองปลดแบน' }));
    fillReview(); fireEvent.click(approveButton());
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('requires an unban followed by a complete Admin review before reactivation', () => {
    render(<AccountAccessDemo />); selectAccount('example-b');
    expect(approveButton()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'จำลองปลดแบน' }));
    const status = screen.getByRole('region', { name: 'สถานะบัญชีตัวอย่าง' });
    expect(status).toHaveTextContent('พักสิทธิ์ / รอรับรองใหม่');
    expect(approveButton()).toBeDisabled(); fillReview();
    expect(approveButton()).toBeEnabled(); fireEvent.click(approveButton());
    expect(status).toHaveTextContent('เปิดใช้งาน');
    expect(screen.getByRole('status')).toHaveTextContent('Admin ตัวอย่างรับรอง');
    expect(screen.getByText('เหตุผล: ตรวจตัวอย่างแล้ว')).toBeInTheDocument();
    expect(screen.getByRole('form')).toHaveTextContent('รุ่นสิทธิ์ 2');
    expect(approveButton()).toBeDisabled();
  });
  it.each(['owner', 'sales'])('does not allow %s to review or inherit the Admin form', reviewer => {
    render(<AccountAccessDemo />); selectAccount('example-c'); fillReview();
    fireEvent.change(screen.getByLabelText('ทดลองมุมมองผู้ตรวจ'), { target: { value: reviewer } });
    expect(approveButton()).toBeDisabled(); expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByLabelText('เหตุผลที่เปิดสิทธิ์ใหม่ *')).toHaveValue('');
    expect(screen.getByLabelText('เหตุผลที่เปิดสิทธิ์ใหม่ *')).toBeDisabled();
  });
  it('clears the previous account review form on a target change', () => {
    render(<AccountAccessDemo />); selectAccount('example-c'); fillReview();
    selectAccount('example-b'); selectAccount('example-c');
    expect(screen.getByLabelText('เหตุผลที่เปิดสิทธิ์ใหม่ *')).toHaveValue('');
    expect(screen.getByRole('checkbox')).not.toBeChecked(); expect(approveButton()).toBeDisabled();
  });
  it('logout does not change ownership and reset returns only synthetic state', () => {
    render(<AccountAccessDemo />);
    fireEvent.click(screen.getByRole('button', { name: 'จำลองออกจากระบบ' }));
    const effects = screen.getByRole('region', { name: 'ผลต่องานลูกค้า' });
    expect(within(effects).getByText('เลือกเป็นเจ้าของได้')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'สถานะบัญชีตัวอย่าง' })).toHaveTextContent('ใช้ไม่ได้ในตัวอย่าง');
    fireEvent.click(screen.getByRole('button', { name: 'จำลองแบนบัญชี' }));
    expect(effects).toHaveTextContent('ไม่ให้เลือกเป็นเจ้าของใหม่');
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มตัวอย่างใหม่' }));
    expect(effects).toHaveTextContent('เลือกเป็นเจ้าของได้');
    expect(screen.getByRole('status')).toHaveTextContent('ไม่มีข้อมูลจริงถูกลบ');
  });
  it('a new visit to the page does not retain the previous in-memory changes', () => {
    const old = render(<AccountAccessDemo />);
    fireEvent.click(screen.getByRole('button', { name: 'จำลองแบนบัญชี' })); old.unmount();
    render(<AccountAccessDemo />);
    expect(screen.getByRole('region', { name: 'สถานะบัญชีตัวอย่าง' })).toHaveTextContent('เปิดใช้งาน');
  });
});
