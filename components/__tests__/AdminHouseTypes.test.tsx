import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AdminHouseTypesView, { HouseTypeFormData } from '../admin/AdminHouseTypesView';

describe('AdminHouseTypesView - Floor Count Management', () => {
  const mockHouseTypes = [
    { id: 'ht-1', type_name: 'บ้านนภาวัลย์', memo: 'บ้านเดี่ยว', floor_count: 1 },
    { id: 'ht-2', type_name: 'บ้านดารารัศมี', memo: 'บ้านสองชั้นหลังใหญ่', floor_count: 2 },
    { id: 'ht-3', type_name: 'บ้านเก่าดั้งเดิม', memo: 'แบบบ้านก่อนมีระบบชั้น', floor_count: null },
    { id: 'ht-infra', type_name: 'ถนนส่วนกลางและคลับเฮาส์', memo: 'สาธารณูปโภค', is_infrastructure: true, floor_count: null },
  ];

  it('renders house types list displaying correct floor count badges', () => {
    const defaultForm: HouseTypeFormData = { id: '', type_name: '', memo: '', floor_count: null };
    render(
      <AdminHouseTypesView
        setView={vi.fn()}
        setSelectedProject={vi.fn()}
        isEditingType={false}
        setIsEditingType={vi.fn()}
        houseTypeForm={defaultForm}
        setHouseTypeForm={vi.fn()}
        houseTypes={mockHouseTypes}
        isSubmitting={false}
        handleSaveHouseType={vi.fn()}
      />
    );

    // List title and entries
    expect(screen.getByText('แบบบ้านทั้งหมด (4)')).toBeInTheDocument();
    expect(screen.getByText('บ้านนภาวัลย์')).toBeInTheDocument();
    expect(screen.getByText('🏠 บ้านชั้นเดียว (1 ชั้น)')).toBeInTheDocument();

    expect(screen.getByText('บ้านดารารัศมี')).toBeInTheDocument();
    expect(screen.getByText('🏢 บ้านสองชั้น (2 ชั้น)')).toBeInTheDocument();

    expect(screen.getByText('บ้านเก่าดั้งเดิม')).toBeInTheDocument();
    expect(screen.getByText('⚠️ ยังไม่ระบุจำนวนชั้น')).toBeInTheDocument();

    expect(screen.getByText('ถนนส่วนกลางและคลับเฮาส์')).toBeInTheDocument();
    expect(screen.getByText('งานโครงสร้างพื้นฐาน')).toBeInTheDocument();
  });

  it('allows selecting 1-storey and 2-storey in the form', () => {
    let formState: HouseTypeFormData = { id: '', type_name: '', memo: '', floor_count: null };
    const setHouseTypeForm = vi.fn((newForm) => {
      formState = typeof newForm === 'function' ? newForm(formState) : newForm;
    });

    const { rerender } = render(
      <AdminHouseTypesView
        setView={vi.fn()}
        setSelectedProject={vi.fn()}
        isEditingType={false}
        setIsEditingType={vi.fn()}
        houseTypeForm={formState}
        setHouseTypeForm={setHouseTypeForm}
        houseTypes={mockHouseTypes}
        isSubmitting={false}
        handleSaveHouseType={vi.fn()}
      />
    );

    const floorSelect = screen.getByLabelText('จำนวนชั้น');
    expect(floorSelect).toHaveValue('');

    // Select 1 storey
    fireEvent.change(floorSelect, { target: { value: '1' } });
    expect(setHouseTypeForm).toHaveBeenCalledWith(
      expect.objectContaining({ floor_count: 1 })
    );

    // Rerender with floor_count = 1
    formState.floor_count = 1;
    rerender(
      <AdminHouseTypesView
        setView={vi.fn()}
        setSelectedProject={vi.fn()}
        isEditingType={false}
        setIsEditingType={vi.fn()}
        houseTypeForm={formState}
        setHouseTypeForm={setHouseTypeForm}
        houseTypes={mockHouseTypes}
        isSubmitting={false}
        handleSaveHouseType={vi.fn()}
      />
    );
    expect(floorSelect).toHaveValue('1');

    // Select 2 storeys
    fireEvent.change(floorSelect, { target: { value: '2' } });
    expect(setHouseTypeForm).toHaveBeenCalledWith(
      expect.objectContaining({ floor_count: 2 })
    );
  });

  it('populates existing house type with null floor_count without overwriting to 1', () => {
    let formState: HouseTypeFormData = { id: '', type_name: '', memo: '', floor_count: null };
    let isEditing = false;
    const setHouseTypeForm = vi.fn((newForm) => {
      formState = newForm;
    });
    const setIsEditingType = vi.fn((editing) => {
      isEditing = editing;
    });

    render(
      <AdminHouseTypesView
        setView={vi.fn()}
        setSelectedProject={vi.fn()}
        isEditingType={isEditing}
        setIsEditingType={setIsEditingType}
        houseTypeForm={formState}
        setHouseTypeForm={setHouseTypeForm}
        houseTypes={mockHouseTypes}
        isSubmitting={false}
        handleSaveHouseType={vi.fn()}
      />
    );

    // Click edit on "บ้านเก่าดั้งเดิม" (has floor_count: null)
    const editButtons = screen.getAllByTitle('แก้ไขชื่อ รายละเอียด และจำนวนชั้น');
    fireEvent.click(editButtons[2]);

    expect(setIsEditingType).toHaveBeenCalledWith(true);
    expect(setHouseTypeForm).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ht-3',
        type_name: 'บ้านเก่าดั้งเดิม',
        floor_count: null, // Must remain null, NOT defaulting to 1
      })
    );
  });
});
