import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CustomerVoiceForm from '../CustomerVoiceForm';
import { VOICE_SCORES, VOICE_OPTIONAL_TEXT } from '@/lib/sales/customerVoicesContracts';
import { voiceAnswers } from '@/lib/sales/__tests__/customerVoicesFixtures';
afterEach(cleanup);
const fill = () => { for (const [, label] of VOICE_SCORES) fireEvent.change(screen.getByLabelText(`${label} *`), { target: { value: '4' } }); };
const submit = () => fireEvent.submit(screen.getByRole('form', { name: 'แบบประเมิน Customer Voices' }));
describe('Customer Voices blank honest answers', () => {
  it('starts every score and optional answer blank, with no personal identity prefills', () => {
    render(<CustomerVoiceForm onSubmit={vi.fn()} />);
    for (const [, label] of VOICE_SCORES) expect(screen.getByLabelText(`${label} *`)).toHaveValue('');
    for (const [, label] of VOICE_OPTIONAL_TEXT) expect(screen.getByLabelText(label)).toHaveValue('');
    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).not.toBeChecked();
    expect(screen.getByLabelText('ค่าเช่าต่อเดือน (บาท)')).toHaveValue('');
    expect(screen.queryByLabelText(/^(ชื่อ-นามสกุล|เบอร์โทร|โครงการ|ผู้ดูแล)( \*)?$/)).not.toBeInTheDocument();
  });
  it('requires all eight scores, without defaulting a missing score to 5', () => {
    const save = vi.fn(); render(<CustomerVoiceForm onSubmit={save} />); submit(); expect(save).not.toHaveBeenCalled();
    for (const [, label] of VOICE_SCORES.slice(0, 7)) fireEvent.change(screen.getByLabelText(`${label} *`), { target: { value: '4' } });
    submit(); expect(save).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toHaveTextContent('ครบทั้ง 8'); fill(); submit(); expect(save).toHaveBeenCalledWith(voiceAnswers());
  });
  it('omits untouched optional fields, including zero rent and unchecked choices', () => {
    const save = vi.fn(); render(<CustomerVoiceForm onSubmit={save} />); fill(); submit(); expect(Object.keys(save.mock.calls[0][0])).toHaveLength(8);
  });
  it('retains explicitly toggled false and explicit zero rent, and trims optional text', () => {
    const save = vi.fn(); render(<CustomerVoiceForm onSubmit={save} />); fill();
    fireEvent.click(screen.getByLabelText('ย้ายที่อยู่อาศัยใหม่')); fireEvent.click(screen.getByLabelText('ย้ายที่อยู่อาศัยใหม่'));
    fireEvent.click(screen.getByLabelText('TikTok')); fireEvent.change(screen.getByLabelText('ค่าเช่าต่อเดือน (บาท)'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('ชื่อเล่น'), { target: { value: '  สมมติ  ' } }); submit();
    expect(save).toHaveBeenCalledWith({ ...voiceAnswers(), nickname: 'สมมติ', monthly_rent: 0, purpose_relocate: false, source_tiktok: true });
  });
  it.each(['-1', '1.234', '1e3', '10000000', 'bad'])('rejects invalid rent %s without guessing', rent => {
    const save = vi.fn(); render(<CustomerVoiceForm onSubmit={save} />); fill(); fireEvent.change(screen.getByLabelText('ค่าเช่าต่อเดือน (บาท)'), { target: { value: rent } }); submit(); expect(save).not.toHaveBeenCalled();
  });
  it('does not send while locked even after an artificial form submit', () => {
    const save = vi.fn(); render(<CustomerVoiceForm disabled onSubmit={save} />); submit(); expect(save).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'ส่งแบบประเมิน' })).toBeDisabled();
    for (const control of screen.getAllByRole('combobox')) expect(control).toBeDisabled();
  });
});
