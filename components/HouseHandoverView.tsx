import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { ShieldAlert, CheckCircle, PlusCircle, Loader2, Calendar, HardHat, Pickaxe, History, Trash2, Search, Award, FileCheck, Lock, Unlock, CheckCircle2, UserCog, X, AlertTriangle, CalendarClock, Wrench } from 'lucide-react';
import DefectTaskSelectModal from './DefectTaskSelectModal';
import HandoverCertificateModal from './HandoverCertificateModal';
import AppCustomModal, { AppModalConfig } from './AppCustomModal';

export default function HouseHandoverView({ 
  selectedPlot, 
  defects, 
  setDefects, 
  currentUserRole,
  resetHandoverCycle,
  updateInspectionRound,
  fetchAllData,
  taskTemplates,
  contractors,
  assignments,
  schedules,
  isMobileLayout,
  setView,
  setSelectedDefect,
  setDefectReturnView
}: any) {
  const [isSelectModalOpen, setIsSelectModalOpen] = useState(false);
  const [isCertificateModalOpen, setIsCertificateModalOpen] = useState(false);
  const [assigningDefect, setAssigningDefect] = useState<any>(null);
  const [contractorSearchQuery, setContractorSearchQuery] = useState('');
  const [defectSearchQuery, setDefectSearchQuery] = useState('');
  const [hideCompletedDefects, setHideCompletedDefects] = useState(false);
  
  const [localCycle, setLocalCycle] = useState<number>(selectedPlot?.handover_cycle || 1);
  const [viewingRound, setViewingRound] = useState<number>(selectedPlot?.inspection_round || 1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [defectScheduleInputs, setDefectScheduleInputs] = useState<any>({});
  
  // Custom App Modal State
  const [modalConfig, setModalConfig] = useState<AppModalConfig | null>(null);

  const showAlert = (title: string, message: string, variant: 'warning' | 'success' | 'danger' | 'info' = 'info') => {
    setModalConfig({
      isOpen: true,
      type: 'alert',
      variant,
      title,
      message
    });
  };

  const showConfirm = (
    title: string, 
    message: string, 
    onConfirm: () => void, 
    variant: 'warning' | 'success' | 'danger' | 'info' = 'info',
    confirmText?: string
  ) => {
    setModalConfig({
      isOpen: true,
      type: 'confirm',
      variant,
      title,
      message,
      confirmText,
      onConfirm
    });
  };

  const cycle = localCycle || selectedPlot?.handover_cycle || 1;
  const currentRound = selectedPlot?.inspection_round || 0;
  const isHandoverCompleted = selectedPlot?.handover_status === 'completed';
  const isProcurement = currentUserRole === 'Procurement';

  React.useEffect(() => {
    if (selectedPlot?.inspection_round !== undefined) {
      setViewingRound(selectedPlot.inspection_round);
    }
    if (selectedPlot?.handover_cycle) {
      setLocalCycle(selectedPlot.handover_cycle);
    }
  }, [selectedPlot?.inspection_round, selectedPlot?.handover_cycle]);

  // Show defects only for the selected cycle and viewing round
  const roundDefects = (defects || []).filter((d: any) => 
    d.plot_id === selectedPlot?.id && 
    d.defect_stage === 'handover' &&
    d.handover_cycle === cycle &&
    d.inspection_round === viewingRound
  );

  const canCompleteHandover = !isHandoverCompleted && currentRound > 0 && roundDefects.length > 0 && roundDefects.every((d: any) => (d.progress || 0) === 100);

  const filteredDefects = roundDefects.filter((d: any) => {
    const taskTemp = taskTemplates?.find((t: any) => t.id === (d.task_id || d.task_template_id));
    const title = taskTemp?.task_name || d.description || '';
    if (defectSearchQuery && !title.toLowerCase().includes(defectSearchQuery.toLowerCase())) {
      return false;
    }
    if (hideCompletedDefects && d.progress === 100) {
      return false;
    }
    return true;
  });

  const handleNextRound = async () => {
    if (isHandoverCompleted && currentUserRole !== 'Admin') {
      showAlert('ผ่านการตรวจรับแล้ว', 'แปลงนี้ผ่านการตรวจรับมอบบ้านเรียบร้อยแล้ว ไม่สามารถเพิ่มรอบใหม่ได้ครับ', 'info');
      return;
    }
    if (currentRound > 0) {
      const pendingDefects = roundDefects.filter((d: any) => (d.progress || 0) < 100);
      if (pendingDefects.length > 0) {
        showAlert(
          'ยังมีงานซ่อมที่ยังไม่เสร็จ',
          `⚠️ ไม่สามารถเริ่มตรวจรอบใหม่ได้ เนื่องจากยังมีรายการแจ้งซ่อมในรอบนี้ที่ยังไม่เสร็จ 100% อีก ${pendingDefects.length} รายการ\n\nกรุณาแก้ไขและอัปเดตงานให้เสร็จเรียบร้อยครบทุกรายการก่อนเริ่มรอบถัดไปครับ`,
          'warning'
        );
        return;
      }
    }

    showConfirm(
      'เริ่มการตรวจรอบใหม่',
      `ยืนยันเริ่มการตรวจรอบที่ ${currentRound + 1} ใช่หรือไม่? \n(งานที่ยังแก้ไม่เสร็จจะถูกยกยอดมารอบใหม่ด้วย)`,
      async () => {
        setIsSubmitting(true);
        const nextRound = currentRound + 1;

        if (selectedPlot) {
          selectedPlot.inspection_round = nextRound;
        }
        setViewingRound(nextRound);

        try {
          await updateInspectionRound(selectedPlot.id, nextRound);
          
          if (fetchAllData) await fetchAllData();
        } catch (e: any) {
          showAlert('เกิดข้อผิดพลาด', e.message, 'danger');
        } finally {
          setIsSubmitting(false);
        }
      },
      'info',
      `เริ่มตรวจรอบที่ ${currentRound + 1}`
    );
  };

  const handleCompleteHandover = async () => {
    showConfirm(
      'อนุมัติผ่านการตรวจรับบ้าน',
      `🎉 ยืนยันการอนุมัติผ่านและปิดการตรวจรับมอบบ้าน แปลง ${selectedPlot.id} ใช่หรือไม่?\n\nเมื่ออนุมัติแล้ว ข้อมูลทั้งหมดจะถูกล็อกเป็นโหมดอ่านอย่างเดียวและบันทึกประวัติการส่งมอบสำเร็จครับ`,
      async () => {
        setIsSubmitting(true);
        try {
          if (selectedPlot) {
            selectedPlot.handover_status = 'completed';
            selectedPlot.handover_completed_at = new Date().toISOString();
            selectedPlot.handover_completed_by = currentUserRole;
          }

          const { error } = await supabase.from('plots').update({
            handover_status: 'completed',
            handover_completed_at: new Date().toISOString(),
            handover_completed_by: currentUserRole
          }).eq('id', selectedPlot.id);
          
          if (error) console.warn('Supabase plots handover columns notice:', error.message);

          showAlert('อนุมัติผ่านสำเร็จ', `🎉 ยินดีด้วยครับ! แปลง ${selectedPlot.id} ตรวจรับมอบบ้านผ่านการอนุมัติเรียบร้อยแล้วครับ`, 'success');
          if (fetchAllData) await fetchAllData();
        } catch (e: any) {
          if (selectedPlot) {
            selectedPlot.handover_status = 'completed';
            selectedPlot.handover_completed_at = new Date().toISOString();
          }
          showAlert('อนุมัติผ่านสำเร็จ', `🎉 ยินดีด้วยครับ! แปลง ${selectedPlot.id} ตรวจรับมอบบ้านผ่านการอนุมัติเรียบร้อยแล้วครับ`, 'success');
        } finally {
          setIsSubmitting(false);
        }
      },
      'success',
      'อนุมัติปิดการตรวจรับ'
    );
  };

  const handleUnlockHandover = async () => {
    showConfirm(
      'ปลดล็อกการแก้ไข',
      `คุณต้องการปลดล็อกสถานะตรวจรับบ้านแปลง ${selectedPlot.id} กลับมารอดำเนินการใช่หรือไม่?`,
      async () => {
        setIsSubmitting(true);
        try {
          if (selectedPlot) {
            selectedPlot.handover_status = 'pending';
            selectedPlot.handover_completed_at = null;
          }

          const { error } = await supabase.from('plots').update({
            handover_status: 'pending',
            handover_completed_at: null,
            handover_completed_by: null
          }).eq('id', selectedPlot.id);

          if (error) console.warn('Supabase unlock notice:', error.message);

          showAlert('ปลดล็อกเรียบร้อย', 'ปลดล็อกสถานะเรียบร้อยแล้วครับ', 'success');
          if (fetchAllData) await fetchAllData();
        } catch (e: any) {
          if (selectedPlot) {
            selectedPlot.handover_status = 'pending';
          }
          showAlert('ปลดล็อกเรียบร้อย', 'ปลดล็อกสถานะเรียบร้อยแล้วครับ', 'success');
        } finally {
          setIsSubmitting(false);
        }
      },
      'warning',
      'ยืนยันปลดล็อก'
    );
  };

  const canAssignContractor = ['Admin', 'Project Planner', 'Procurement', 'Foreman'].includes(currentUserRole) && !isHandoverCompleted;

  const handleSaveDefectContractor = async (defectId: string, contractorId: string | null) => {
    if (!canAssignContractor) {
      showAlert('ไม่มีสิทธิ์ระบุช่าง', 'เฉพาะผู้ใช้งานบทบาท Admin, Project Planner, Procurement หรือ Foreman เท่านั้นที่สามารถระบุช่างได้ครับ', 'warning');
      return;
    }
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('defects').update({
        contractor_id: contractorId
      }).eq('id', defectId);
      if (error) throw error;

      if (setDefects) {
        setDefects((prev: any[]) => prev.map((d: any) => d.id === defectId ? { ...d, contractor_id: contractorId } : d));
      }

      setAssigningDefect(null);
      if (fetchAllData) await fetchAllData();
    } catch (e: any) {
      showAlert('เกิดข้อผิดพลาด', 'Error assigning contractor: ' + e.message, 'danger');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetCycle = async () => {
    showConfirm(
      'ลูกค้ายกเลิกการจอง',
      `คุณแน่ใจหรือไม่ว่าต้องการรีเซ็ตการตรวจรับบ้าน? (ใช้กรณีลูกค้ายกเลิก/ทิ้งดาวน์)\n\nข้อมูล Defect เดิมจะถูกเก็บเป็นประวัติรอบเก่าอย่างปลอดภัย`,
      async () => {
        const nextCycle = cycle + 1;
        if (selectedPlot) {
          selectedPlot.handover_cycle = nextCycle;
          selectedPlot.inspection_round = 0;
          selectedPlot.handover_status = 'pending';
          selectedPlot.handover_completed_at = null;
        }
        setLocalCycle(nextCycle);
        setViewingRound(1);
        await resetHandoverCycle(selectedPlot.id, cycle);
      },
      'danger',
      'ยืนยันลูกค้ายกเลิก'
    );
  };

  const handleSelectTasks = async (selectedTasks: any[]) => {
    if (currentRound === 0) {
      showAlert('ยังไม่ได้เริ่มตรวจ', "กรุณากด 'เริ่มตรวจรอบที่ 1' ก่อนเพิ่มรายการครับ", 'warning');
      return;
    }
    const newTasksToInsert = selectedTasks.filter(t => 
      !roundDefects.some((d: any) => d.task_id === t.id || d.task_template_id === t.id)
    );

    if (newTasksToInsert.length === 0) {
      showAlert('รายการซ้ำ', "รายการที่คุณเลือกถูกเพิ่มในรอบตรวจนี้ไปแล้วครับ", 'warning');
      return;
    }

    setIsSubmitting(true);
    try {
      const newDefects = newTasksToInsert.map(t => {
        const originalAssignment = assignments?.find((a: any) => a.task_template_id === t.id && a.plot_id === selectedPlot.id);
        const contractorId = originalAssignment?.contractor_id || null;

        return {
          plot_id: selectedPlot.id,
          description: `แก้: ${t.task_name}`,
          reported_by: currentUserRole,
          status: 'pending',
          defect_stage: 'handover',
          handover_cycle: cycle,
          inspection_round: currentRound,
          task_id: t.id,
          contractor_id: contractorId
        };
      });

      const { data: insertedDefects, error } = await supabase.from('defects').insert(newDefects).select();
      if (error) throw error;
      
      if (setDefects && insertedDefects && insertedDefects.length > 0) {
        setDefects((prev: any[]) => [...(prev || []), ...insertedDefects]);
      }

      setViewingRound(currentRound);
      setIsSelectModalOpen(false);
      if (fetchAllData) await fetchAllData();
    } catch (e: any) {
      showAlert('เกิดข้อผิดพลาด', 'Error adding defects: ' + e.message, 'danger');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteDefect = async (defect: any) => {
    if (currentUserRole !== 'Admin') {
      showAlert('ไม่มีสิทธิ์ลบรายการ', 'เฉพาะผู้ใช้งานบทบาท Admin เท่านั้นที่สามารถลบรายการได้ครับ', 'warning');
      return;
    }
    const taskName = taskTemplates?.find((t: any) => t.id === (defect.task_id || defect.task_template_id))?.task_name || defect.description || 'รายการนี้';
    
    showConfirm(
      'ลบรายการแจ้งซ่อม',
      `คุณต้องการลบรายการแจ้งซ่อม "${taskName}" ใช่หรือไม่?`,
      async () => {
        try {
          setIsSubmitting(true);
          const { error } = await supabase.from('defects').delete().eq('id', defect.id);
          if (error) throw error;
          if (setDefects) {
            setDefects((prev: any[]) => prev.filter((d: any) => d.id !== defect.id));
          }
          if (fetchAllData) await fetchAllData();
        } catch (e: any) {
          showAlert('เกิดข้อผิดพลาด', 'เกิดข้อผิดพลาดในการลบรายการ: ' + e.message, 'danger');
        } finally {
          setIsSubmitting(false);
        }
      },
      'danger',
      'ลบรายการ'
    );
  };

  const roundsList = Array.from({length: currentRound}, (_, i) => i + 1).reverse();

  const handleScheduleChange = (defectId: string, field: 'start' | 'duration' | 'end', val: string, defect: any) => {
    const currentInput = defectScheduleInputs[defectId] || {};
    const dStartTs = defect.planned_start ? new Date(defect.planned_start).getTime() : null;
    const dEndTs = defect.planned_end ? new Date(defect.planned_end).getTime() : null;
    const defaultDuration = (dStartTs && dEndTs) ? Math.max(1, Math.ceil((dEndTs - dStartTs) / 86400000) + 1) : '';

    let start = currentInput.start !== undefined ? currentInput.start : (defect.planned_start ? defect.planned_start.split('T')[0] : '');
    let end = currentInput.end !== undefined ? currentInput.end : (defect.planned_end ? defect.planned_end.split('T')[0] : '');
    let duration = currentInput.duration !== undefined ? currentInput.duration : (defaultDuration ? String(defaultDuration) : '');

    if (field === 'start') {
      start = val;
      if (start && duration && Number(duration) > 0) {
        const d = new Date(start);
        d.setDate(d.getDate() + (Number(duration) - 1));
        end = d.toISOString().split('T')[0];
      } else if (start && end) {
        const diffTime = new Date(end).getTime() - new Date(start).getTime();
        duration = String(Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24))) + 1);
      }
    } else if (field === 'duration') {
      duration = val;
      if (start && duration && Number(duration) > 0) {
        const d = new Date(start);
        d.setDate(d.getDate() + (Number(duration) - 1));
        end = d.toISOString().split('T')[0];
      }
    } else if (field === 'end') {
      end = val;
      if (start && end) {
        const diffTime = new Date(end).getTime() - new Date(start).getTime();
        duration = String(Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24))) + 1);
      }
    }

    setDefectScheduleInputs((prev: any) => ({
      ...prev,
      [defectId]: { start, end, duration }
    }));
  };

  const handleSaveDefectSchedules = async () => {
    setIsSubmitting(true);
    try {
        const payloads: any[] = [];
        Object.keys(defectScheduleInputs).forEach(defectId => {
          const plan = defectScheduleInputs[defectId];
          const hasStart = Boolean(plan.start);
          const hasEnd = Boolean(plan.end);

          if (hasStart || hasEnd) {
            payloads.push({ 
              id: defectId, 
              planned_start: hasStart ? plan.start : null, 
              planned_end: hasEnd ? plan.end : null 
            });
          }
        });
        if (payloads.length === 0) {
          setIsSubmitting(false);
          showAlert('กรอกข้อมูลไม่ครบ', 'ไม่มีการแก้ไขข้อมูล หรือยังไม่ได้ระบุวันเริ่มงานครับ', 'warning');
          return;
        }
        
        for (const p of payloads) {
          if (p.planned_start && p.planned_end && new Date(p.planned_end) < new Date(p.planned_start)) {
             showAlert('วันที่ไม่ถูกต้อง', 'วันสิ้นสุดต้องอยู่หลังวันเริ่มงานครับ', 'warning');
             setIsSubmitting(false);
             return;
          }
        }
        
        for (const p of payloads) {
            const { error } = await supabase.from('defects').update({
                planned_start: p.planned_start,
                planned_end: p.planned_end
            }).eq('id', p.id);
            if (error) throw error;
        }

      if (setDefects) {
        setDefects((prev: any[]) => (prev || []).map((d: any) => {
          const p = payloads.find(item => item.id === d.id);
          if (p) {
            return { ...d, planned_start: p.planned_start, planned_end: p.planned_end };
          }
          return d;
        }));
      }

      showAlert('บันทึกสำเร็จ', 'บันทึกแผนซ่อมเรียบร้อยแล้วครับ', 'success');
      setDefectScheduleInputs({});
      if (fetchAllData) await fetchAllData();
    } catch (e: any) {
      showAlert('เกิดข้อผิดพลาด', e.message, 'danger');
    }
    setIsSubmitting(false);
  };

  // === Gantt Chart Calculation ===
  let minStart = Infinity;
  let maxEnd = -Infinity;
  let hasDates = false;

  roundDefects.forEach((d: any) => {
    if (d.planned_start) {
      const ts = new Date(d.planned_start).getTime();
      if (ts < minStart) minStart = ts;
      hasDates = true;
    }
    if (d.planned_end) {
      const ts = new Date(d.planned_end).getTime();
      if (ts > maxEnd) maxEnd = ts;
      hasDates = true;
    }
  });

  const today = new Date();
  today.setHours(0,0,0,0);
  const todayTs = today.getTime();

  let chartStart = todayTs - (5 * 86400000);
  let chartEnd = todayTs + (25 * 86400000);

  if (hasDates) {
    if (minStart !== Infinity) chartStart = minStart - (5 * 86400000);
    if (maxEnd !== -Infinity) chartEnd = Math.max(maxEnd, todayTs) + (5 * 86400000);
    if (chartEnd <= chartStart) chartEnd = chartStart + (30 * 86400000);
  }

  const totalChartDays = Math.round((chartEnd - chartStart) / 86400000) + 1;
  const totalChartMs = totalChartDays * 86400000;

  const getChartLeft = (timestamp: any) => {
    const d = new Date(timestamp); d.setHours(0, 0, 0, 0);
    const clampedTs = Math.max(chartStart, Math.min(chartEnd, d.getTime()));
    return Math.max(0, Math.min(100, ((clampedTs - chartStart) / totalChartMs) * 100));
  };

  const getChartWidth = (startTs: any, endTs: any) => {
    const dStart = new Date(startTs); dStart.setHours(0, 0, 0, 0);
    const dEnd = new Date(endTs); dEnd.setHours(0, 0, 0, 0);
    const clampedStart = Math.max(chartStart, dStart.getTime());
    const clampedEnd = Math.min(chartEnd, dEnd.getTime());
    if (clampedEnd < clampedStart) return 0;
    const widthPct = (((clampedEnd + 86400000) - clampedStart) / totalChartMs) * 100;
    const leftPct = getChartLeft(clampedStart);
    return Math.max(0, Math.min(100 - leftPct, widthPct));
  };

  const timeMarkers: any[] = [];
  let current = new Date(chartStart);
  while (current.getTime() <= chartEnd) {
    const currentMonthStr = current.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' });
    let monthLabel = null;
    if (current.getDate() === 1 || current.getTime() === chartStart) {
        monthLabel = currentMonthStr;
    }
    timeMarkers.push({
      dayLabel: current.getDate(),
      monthLabel: monthLabel,
      isMonth: current.getDate() === 1,
      left: getChartLeft(current.getTime())
    });
    current.setDate(current.getDate() + 1);
  }

  // Smart Banner Calculation
  const getBannerDetails = () => {
    let inspectionDateStr = null;
    let title = '';
    let subtitle = '';

    if (currentRound === 0) {
      // Customer hasn't come yet OR Construction hasn't started fixing defects
      inspectionDateStr = selectedPlot?.inspection_round1_date;
      title = 'ลูกค้าจะเข้าตรวจบ้านรอบ 1:';
      subtitle = 'เตรียมทำความสะอาดและเคลียร์พื้นที่บ้านให้พร้อมรับลูกค้า';
    } else if (currentRound === 1) {
      // Construction is fixing Round 1 defects. Deadline is Round 2 date.
      inspectionDateStr = selectedPlot?.inspection_round2_date;
      title = 'เส้นตาย! นัดลูกค้าตรวจงานแก้ (รอบ 2):';
      subtitle = 'โปรดเร่งเก็บงานแก้รอบ 1 ให้เสร็จ 100% ก่อนลูกค้ายกขบวนมา';
    } else {
      // Round 2+ 
      inspectionDateStr = selectedPlot?.inspection_round2_date;
      title = `นัดลูกค้าตรวจงานแก้ (รอบ ${currentRound + 1}):`;
      subtitle = 'เร่งเก็บงานที่เหลือให้เรียบร้อย';
    }
      
    const pendingCount = defects.filter((d: any) => 
      d.plot_id === selectedPlot?.id && 
      d.defect_stage === 'handover' && 
      d.handover_cycle === cycle && 
      d.inspection_round === (currentRound === 0 ? 1 : currentRound) &&
      (d.progress || 0) < 100
    ).length;

    if (!inspectionDateStr) {
      if (currentRound > 0) {
        return { 
          diffDays: null, 
          pendingCount, 
          status: 'safe', 
          date: null, 
          notes: selectedPlot?.handover_notes, 
          title: `กำลังซ่อมงานรอบ ${currentRound}`, 
          subtitle: 'รอฝ่ายขายกำหนดวันนัดตรวจซ้ำ (ยังไม่มีกำหนดจากระบบ)' 
        };
      }
      return null;
    }

    const inspectionDate = new Date(inspectionDateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    inspectionDate.setHours(0, 0, 0, 0);
    
    const diffTime = inspectionDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    let status = 'safe';
    if (diffDays <= 3) status = 'critical';
    else if (diffDays <= 7) status = 'warning';

    return { diffDays, pendingCount, status, date: inspectionDate, notes: selectedPlot?.handover_notes, title, subtitle };
  };

  const bannerData = getBannerDetails();

  return (
    <div className="bg-[#f5f5f7] w-full border-t border-black/5 flex flex-col">
      
      {/* 🚀 Smart Banner 🚀 */}
      {bannerData && !isHandoverCompleted && (
        <div className={`mx-3 sm:mx-4 mt-4 px-4 py-3 sm:px-6 sm:py-4 rounded-2xl shadow-sm border flex flex-col md:flex-row items-start md:items-center justify-between gap-3 ${
          bannerData.status === 'critical' 
            ? 'bg-rose-50 border-rose-200 text-rose-800' 
            : bannerData.status === 'warning'
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-indigo-50 border-indigo-200 text-indigo-800'
        }`}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full">
            <div className={`flex items-center justify-center p-2 rounded-full shrink-0 ${
              bannerData.status === 'critical' ? 'bg-rose-100 text-rose-600 animate-pulse' : 
              bannerData.status === 'warning' ? 'bg-amber-100 text-amber-600' : 'bg-indigo-100 text-indigo-600'
            }`}>
              {bannerData.status === 'critical' ? <AlertTriangle size={24}/> : <CalendarClock size={24}/>}
            </div>
            <div className="flex-1">
              <h3 className="font-black text-sm sm:text-base flex flex-wrap items-center gap-2">
                {bannerData.title} {bannerData.date ? bannerData.date.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}
                {bannerData.diffDays !== null && (
                  <span className={`text-[10px] sm:text-xs px-2 py-0.5 rounded-full font-bold whitespace-nowrap ${
                    bannerData.diffDays < 0 ? 'bg-rose-200 text-rose-900' :
                    bannerData.diffDays === 0 ? 'bg-rose-600 text-white animate-pulse' :
                    bannerData.status === 'critical' ? 'bg-rose-200 text-rose-800' :
                    bannerData.status === 'warning' ? 'bg-amber-200 text-amber-800' : 'bg-indigo-200 text-indigo-800'
                  }`}>
                    {bannerData.diffDays < 0 ? `เลยกำหนดมาแล้ว ${Math.abs(bannerData.diffDays)} วัน` : 
                     bannerData.diffDays === 0 ? 'นัดตรวจวันนี้!' : 
                     `เหลือเวลาอีก ${bannerData.diffDays} วัน`}
                  </span>
                )}
              </h3>
              <p className="text-xs sm:text-sm mt-1 opacity-90 font-medium">
                👉 {bannerData.subtitle}
              </p>
              {bannerData.notes && (
                <p className="text-xs sm:text-sm mt-1 opacity-80 italic font-semibold border-l-2 pl-2 border-current">
                  💬 โน้ตจากฝ่ายขาย: {bannerData.notes}
                </p>
              )}
            </div>
          </div>
          {bannerData.pendingCount > 0 && (
            <div className={`shrink-0 text-xs sm:text-sm font-bold px-4 py-2 rounded-xl flex items-center gap-2 ${
               bannerData.status === 'critical' ? 'bg-white/60 shadow-sm border border-rose-100' :
               bannerData.status === 'warning' ? 'bg-white/60 shadow-sm border border-amber-100' : 'bg-white/60 shadow-sm border border-indigo-100'
            }`}>
              <Wrench size={16}/> เหลืองานค้าง {bannerData.pendingCount} รายการ
            </div>
          )}
        </div>
      )}      
      {/* 🏆 Banner: Completed Handover Status */}
      {isHandoverCompleted && (
        <div className="bg-emerald-600 text-white rounded-2xl p-4 sm:p-5 m-3 sm:m-4 mb-0 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg border border-emerald-500 animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
              <CheckCircle2 size={24} className="text-white" />
            </div>
            <div>
              <h3 className="font-black text-sm sm:text-base leading-tight">🏆 ลูกค้าตรวจรับมอบบ้านเรียบร้อยแล้ว (ผ่านการตรวจรอบที่ {viewingRound})</h3>
              <p className="text-[11px] text-emerald-100 font-bold mt-0.5">
                อนุมัติเมื่อ {new Date(selectedPlot.handover_completed_at || Date.now()).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })} • {selectedPlot.handover_completed_by || 'Admin'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button 
              onClick={() => setIsCertificateModalOpen(true)}
              className="bg-white text-emerald-800 hover:bg-emerald-50 font-black px-4 py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow transition-all active:scale-95 w-full sm:w-auto cursor-pointer"
            >
              <Award size={16} /> หนังสือส่งมอบบ้าน (Certificate)
            </button>
            {currentUserRole === 'Admin' && (
              <button 
                onClick={handleUnlockHandover}
                disabled={isSubmitting}
                className="bg-emerald-800/80 hover:bg-emerald-900 text-emerald-100 font-bold px-3 py-2 rounded-xl text-xs flex items-center justify-center gap-1 transition-all shrink-0 cursor-pointer"
                title="ปลดล็อกแก้ไข (เฉพาะ Admin)"
              >
                <Unlock size={14} /> ปลดล็อก
              </button>
            )}
          </div>
        </div>
      )}

      {/* 🌟 Top Header Summary 🌟 */}
      <div className="bg-white rounded-2xl p-4 sm:p-6 m-3 sm:m-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-sm border border-slate-100 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-2 h-full bg-purple-500"></div>
        <div className="pl-2">
          <h2 className="text-lg sm:text-xl font-black text-slate-800 flex items-center gap-2">
            <ShieldAlert className="text-purple-500" /> ตรวจรับบ้าน (Handover) [{roundDefects.length} รายการในรอบนี้]
          </h2>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <span className="text-[11px] font-bold text-purple-600 bg-purple-50 px-2.5 py-0.5 rounded-full border border-purple-100">รอบการขาย: Cycle {cycle}</span>
            <span className="text-[11px] font-bold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">รอบการตรวจ: {currentRound === 0 ? 'ยังไม่เริ่ม' : `Round ${currentRound}`}</span>
            
            {isHandoverCompleted && (
              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                <CheckCircle2 size={12}/> ผ่านการส่งมอบแล้ว
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full md:w-auto">
          {canCompleteHandover && (
            <button 
              onClick={handleCompleteHandover} 
              disabled={isSubmitting} 
              className="w-full md:w-auto bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white text-xs sm:text-sm font-black px-5 py-2.5 rounded-xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
            >
              {isSubmitting ? <Loader2 className="animate-spin" size={16}/> : <><Award size={18}/> 🎉 อนุมัติผ่าน & ปิดการตรวจรับมอบบ้าน</>}
            </button>
          )}

          {currentUserRole !== 'Owner' && currentUserRole !== 'Admin' ? null : (
            <button onClick={handleResetCycle} className="text-[10px] sm:text-xs font-bold text-rose-500 bg-rose-50 px-3 py-2 rounded-xl hover:bg-rose-100 border border-rose-100 transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer">
              <History size={14}/> ลูกค้ายกเลิก
            </button>
          )}

          {['Admin', 'Project Planner', 'Owner', 'Foreman', 'Procurement'].includes(currentUserRole) && Object.keys(defectScheduleInputs).length > 0 && (
            <button onClick={handleSaveDefectSchedules} disabled={isSubmitting} className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-4 py-2 rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer">
              {isSubmitting ? <Loader2 className="animate-spin" size={16}/> : 'บันทึกแผนซ่อม (Save)'}
            </button>
          )}

          {['Admin', 'Site Engineer', 'QC', 'Owner'].includes(currentUserRole) && !isHandoverCompleted && (
            <button onClick={handleNextRound} disabled={isSubmitting} className="w-full md:w-auto bg-purple-600 hover:bg-purple-700 text-white text-xs sm:text-sm font-bold px-5 py-2.5 rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer">
              {isSubmitting ? <Loader2 className="animate-spin" size={16}/> : currentRound === 0 ? 'เริ่มตรวจรอบที่ 1 >' : `เริ่มตรวจรอบที่ ${currentRound + 1} >`}
            </button>
          )}
        </div>
      </div>

      {/* 🔍 Search Bar & Filters (Matching Construction Bar) */}
      <div className="mx-3 sm:mx-4 mb-3 p-3 border border-slate-200 bg-white shrink-0 flex flex-col sm:flex-row gap-3 items-center rounded-xl shadow-sm">
        <button 
          onClick={() => setIsSelectModalOpen(true)}
          disabled={currentRound === 0 || (isHandoverCompleted && currentUserRole !== 'Admin')}
          className="w-full sm:w-auto bg-purple-600 hover:bg-purple-700 text-white px-4 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed shrink-0 text-xs sm:text-sm cursor-pointer"
        >
          <PlusCircle size={18} /> เพิ่มรายการแจ้งซ่อม (ลูกค้า)
        </button>

        <button 
          onClick={() => setIsCertificateModalOpen(true)}
          className="w-full sm:w-auto bg-slate-100 hover:bg-slate-200 text-slate-700 px-3.5 py-2.5 rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all text-xs sm:text-sm shrink-0 border border-slate-200 cursor-pointer"
        >
          <Award size={16} className="text-purple-600"/> หนังสือส่งมอบบ้าน
        </button>

        <div className="relative flex-1 w-full">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search size={16} className="text-slate-400" />
          </div>
          <input
            type="text"
            className="block w-full pl-10 pr-3 py-2 sm:py-2.5 border border-slate-200 rounded-xl leading-5 bg-slate-50 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-xs sm:text-sm transition-colors"
            placeholder="ค้นหารายการแจ้งซ่อม (เช่น ทาสี, ปูกระเบื้อง, ปลั๊กไฟ)..."
            value={defectSearchQuery}
            onChange={(e) => setDefectSearchQuery(e.target.value)}
          />
        </div>

        <label className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-slate-600 cursor-pointer w-full sm:w-auto bg-slate-50 px-3 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-100 transition-colors select-none shrink-0">
          <input 
            type="checkbox" 
            className="w-4 h-4 text-purple-600 rounded border-slate-300 focus:ring-purple-500 cursor-pointer"
            checked={hideCompletedDefects}
            onChange={(e) => setHideCompletedDefects(e.target.checked)}
          />
          ซ่อนงานซ่อมที่เสร็จแล้ว (100%)
        </label>

        <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
          <span className="text-[10px] sm:text-xs font-bold text-slate-500 shrink-0">ดูรอบตรวจ:</span>
          <select 
             value={viewingRound}
             onChange={(e) => setViewingRound(parseInt(e.target.value))}
             className="bg-white border border-slate-300 text-slate-700 font-bold text-xs sm:text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 outline-none w-full sm:w-auto cursor-pointer"
          >
            {roundsList.length === 0 ? (
              <option value={1}>รอบที่ 1</option>
            ) : (
              roundsList.map(r => (
                <option key={r} value={r}>
                  {r === currentRound ? `📌 ปัจจุบัน (รอบที่ ${r})` : `ย้อนหลัง (รอบที่ ${r})`}
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      {/* 🌟 GANTT CHART TABLE (Matching Construction Table Layout & Headers) 🌟 */}
      <div className="mx-3 sm:mx-4 mb-6 bg-white rounded-2xl shadow-xl border border-black/5 overflow-hidden flex flex-col relative">
          <div className="overflow-x-auto custom-scrollbar flex-1" style={{ maxHeight: '800px', overflowY: 'auto' }}>
             {isMobileLayout && <div className="text-center text-[10px] text-slate-400 font-bold py-2 bg-[#f5f5f7] border-b border-black/5">↔️ ปัดซ้าย-ขวา เพื่อดูตาราง ↔️</div>}
             <table className={`text-left border-separate border-spacing-0 w-full relative ${isMobileLayout ? 'block' : 'min-w-[1200px]'}`}>
               {!isMobileLayout && (
               <thead className="sticky top-0 z-[60] bg-[#f5f5f7] shadow-sm text-[10px] sm:text-xs font-bold uppercase text-[#86868b] tracking-widest">
                 <tr>
                   <th className={`sticky left-0 bg-[#f5f5f7] z-[65] border-b border-r border-black/5 p-3 sm:p-5 ${isMobileLayout ? 'w-[220px] min-w-[220px] max-w-[220px]' : 'w-[280px] min-w-[280px] max-w-[280px]'} shadow-[4px_0_15px_-5px_rgba(0,0,0,0.1)]`}>Task Name</th>
                   {!isMobileLayout && <th className="sticky left-[280px] bg-[#f5f5f7] z-[65] border-b border-r border-black/5 p-3 sm:p-5 text-center w-[80px] min-w-[80px] max-w-[80px] shadow-[-6px_0_10px_-6px_rgba(0,0,0,0.08)]">Status</th>}
                   <th className={`sticky ${isMobileLayout ? 'left-[220px]' : 'left-[360px]'} bg-[#f5f5f7] z-[65] border-b border-r border-black/5 p-3 sm:p-5 text-center w-[115px] sm:w-[140px] min-w-[115px] sm:min-w-[140px] max-w-[115px] sm:max-w-[140px] shadow-[-6px_0_10px_-6px_rgba(0,0,0,0.08)]`}>Start</th>
                   <th className={`sticky ${isMobileLayout ? 'left-[335px]' : 'left-[500px]'} bg-[#f5f5f7] z-[65] border-b border-r border-black/5 p-3 sm:p-5 text-center w-[70px] sm:w-[100px] min-w-[70px] sm:min-w-[100px] max-w-[70px] sm:max-w-[100px] text-pink-600`}>Duration</th>
                   <th className={`sticky ${isMobileLayout ? 'left-[405px]' : 'left-[600px]'} bg-[#f5f5f7] z-[65] border-b border-r border-black/5 p-3 sm:p-5 text-center w-[115px] sm:w-[140px] min-w-[115px] sm:min-w-[140px] max-w-[115px] sm:max-w-[140px] shadow-[6px_0_10px_-6px_rgba(0,0,0,0.1)]`}>Finish</th>
                   
                   {/* Timeline Header */}
                   <th className="bg-[#f5f5f7] border-b border-black/5 p-0 relative w-full z-[60]" style={{ minWidth: `${totalChartDays * 36}px`, height: isMobileLayout ? '40px' : '56px' }}>
                      {todayTs >= chartStart && todayTs <= chartEnd && (
                         <div className="absolute top-0 bottom-0 border-l-2 sm:border-l-[3px] border-dashed border-rose-500 z-[10] flex flex-col items-center pointer-events-none" style={{ left: `${getChartLeft(todayTs)}%` }}>
                            <span className="bg-rose-500 text-white text-[7px] sm:text-[11px] font-bold px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-b-md sm:rounded-b-lg shadow-md mt-0 sm:mt-1">ปัจจุบัน</span>
                         </div>
                      )}
                      <div className="absolute inset-0 flex pointer-events-none">
                         {timeMarkers.map((marker, i) => (
                            <div key={i} className={`absolute flex flex-col items-center justify-end h-full pb-1 border-l border-black/5 ${marker.isMonth ? 'border-black/20' : ''}`} style={{ left: `${marker.left}%`, width: `calc(100% / ${totalChartDays})` }}>
                               {marker.monthLabel && ( <span className={`text-[8px] sm:text-[10px] font-bold text-blue-600 absolute ${isMobileLayout ? 'top-0' : 'top-1'} whitespace-nowrap bg-blue-50 px-1 rounded`}>{marker.monthLabel}</span> )}
                               <span className={`text-[9px] sm:text-[11px] ${marker.isMonth ? 'font-black text-slate-800' : 'font-bold text-slate-400'}`}>{marker.dayLabel}</span>
                            </div>
                         ))}
                      </div>
                   </th>
                 </tr>
               </thead>
               )}
               
               <tbody className={isMobileLayout ? 'block p-3 sm:p-0 bg-[#f5f5f7]' : ''}>
                  {filteredDefects.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-20 text-slate-400 sticky left-0 z-10 w-full">
                        <CheckCircle size={48} className="mx-auto mb-3 opacity-20" />
                        <p className="font-bold text-sm">ไม่มีรายการแจ้งซ่อมในรอบนี้</p>
                      </td>
                    </tr>
                  ) : (
                    filteredDefects.map((defect: any, idx: number) => {
                      const taskTemp = taskTemplates?.find((t:any) => t.id === (defect.task_id || defect.task_template_id));
                      const contractor = contractors?.find((c:any) => c.id === defect.contractor_id);
                      const isPending = defect.status === 'pending';
                      
                      const dStartTs = defect.planned_start ? new Date(defect.planned_start).getTime() : null;
                      const dEndTs = defect.planned_end ? new Date(defect.planned_end).getTime() : null;

                      let durationText = '-';
                      if (dStartTs && dEndTs) {
                          const diff = dEndTs - dStartTs;
                          durationText = `${Math.max(0, Math.ceil(diff / (86400000))) + 1} วัน`;
                      }

                      const canEditSchedule = ['Project Planner', 'Admin', 'Owner', 'Foreman', 'Procurement'].includes(currentUserRole) && !isHandoverCompleted;
                      const isProcurement = currentUserRole === 'Procurement';
                      const canEditEndDate = canEditSchedule && !isProcurement;
                      const currentInput = defectScheduleInputs[defect.id];
                      const curStart = currentInput?.start !== undefined ? currentInput.start : (defect.planned_start ? defect.planned_start.split('T')[0] : '');
                      const curEnd = currentInput?.end !== undefined ? currentInput.end : (defect.planned_end ? defect.planned_end.split('T')[0] : '');
                      const defaultDuration = (dStartTs && dEndTs) ? Math.max(1, Math.ceil((dEndTs - dStartTs) / 86400000) + 1) : '';
                      const curDuration = currentInput?.duration !== undefined ? currentInput.duration : (defaultDuration ? String(defaultDuration) : '');
                      const hasPendingScheduleChanges = !!currentInput;

                      return (
                        <React.Fragment key={defect.id}>
                          {/* 📱 1. โซนมือถือ (Mobile Card View) */}
                          {isMobileLayout && (
                             <tr className="block mb-4">
                               <td className="block bg-white rounded-[1.5rem] shadow-[0_8px_30px_-10px_rgba(0,0,0,0.1)] p-4 sm:p-5 border border-black/5 relative overflow-hidden" onClick={() => { setSelectedDefect(defect); setDefectReturnView('house-detail'); setView('defect-progress'); }}>
                                   {defect.progress === 100 && <div className="absolute top-0 left-0 w-full h-1.5 bg-emerald-400"></div>}
                                   <div className="flex items-start justify-between mb-3 border-b border-slate-100 pb-3 mt-0.5">
                                     <div className="flex items-start gap-2.5 pr-2">
                                         <span className="text-[10px] font-bold text-slate-400 bg-[#f5f5f7] px-2 py-0.5 rounded border mt-0.5 shrink-0">#{idx + 1}</span>
                                         <div>
                                           <h4 className={`font-bold text-sm leading-tight mb-1 ${defect.progress === 100 ? 'text-slate-400 line-through' : 'text-[#1d1d1f]'}`}>{taskTemp?.task_name || defect.description}</h4>
                                           {contractor?.name ? (
                                                <div className="flex items-center gap-1">
                                                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-md border border-purple-100"><HardHat size={12} /> {contractor.name.split(' ')[0]}</span>
                                                  {canAssignContractor && (
                                                     <button type="button" onClick={(e) => { e.stopPropagation(); setAssigningDefect(defect); }} className="p-1 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors cursor-pointer" title="เปลี่ยนช่าง">
                                                        <UserCog size={13} />
                                                     </button>
                                                  )}
                                                </div>
                                            ) : canAssignContractor ? (
                                                <button type="button" onClick={(e) => { e.stopPropagation(); setAssigningDefect(defect); }} className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-500 hover:text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 border-dashed px-2 py-0.5 rounded-md transition-colors cursor-pointer">
                                                   <HardHat size={12} /> ยังไม่ระบุช่าง
                                                </button>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 bg-[#f5f5f7] px-2 py-0.5 rounded-md"><HardHat size={12} /> ยังไม่ระบุช่าง</span>
                                            )}
                                         </div>
                                     </div>
                                     <div className="flex items-center gap-2 shrink-0">
                                       <span className={`px-2.5 py-1 rounded-xl text-xs font-bold ${defect.progress === 100 ? 'bg-emerald-100 text-emerald-700' : 'bg-purple-100 text-purple-700'}`}>
                                           {defect.progress || 0}%
                                       </span>
                                       {currentUserRole === 'Admin' && (
                                          <button 
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleDeleteDefect(defect);
                                            }}
                                            title="ลบรายการแจ้งซ่อม (เฉพาะ Admin)"
                                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors shrink-0 cursor-pointer"
                                          >
                                            <Trash2 size={16} />
                                          </button>
                                       )}
                                     </div>
                                   </div>

                                   {/* 📅 ปรับแผนงานซ่อม (สำหรับ Foreman, Procurement, Admin, Owner, Project Planner บนมือถือ) */}
                                   {canEditSchedule ? (
                                     <div 
                                       className={`rounded-2xl p-3 border mb-3 transition-colors ${hasPendingScheduleChanges ? 'bg-purple-50/70 border-purple-300 ring-1 ring-purple-400/30' : 'bg-[#f8f9fa] border-slate-200'}`}
                                       onClick={(e) => e.stopPropagation()}
                                     >
                                       <div className="flex items-center justify-between mb-2">
                                         <span className="text-[10px] font-extrabold uppercase text-purple-800 flex items-center gap-1.5">
                                           <Calendar size={13} className="text-purple-600" /> แผนงานซ่อม {isProcurement && <span className="text-emerald-600 font-bold lowercase text-[9px]">(ผู้จัดจ้าง)</span>}
                                         </span>
                                         {hasPendingScheduleChanges ? (
                                           <span className="text-[9px] font-bold text-amber-800 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-md animate-pulse">
                                             ✏️ รอการบันทึก
                                           </span>
                                         ) : (
                                           <span className="text-[9px] font-bold text-slate-400">
                                             {curStart ? (curEnd ? durationText : 'รอกำหนดวันเสร็จ') : 'ยังไม่ระบุวัน'}
                                           </span>
                                         )}
                                       </div>

                                       <div className="grid grid-cols-5 gap-2 items-center">
                                         {/* วันเริ่ม (2 คอลัมน์) */}
                                         <div className="col-span-2">
                                           <label className="block text-[9px] font-bold text-slate-500 mb-1">วันเริ่ม</label>
                                           <input 
                                             type="date"
                                             value={curStart}
                                             onClick={(e) => e.stopPropagation()}
                                             onChange={(e) => handleScheduleChange(defect.id, 'start', e.target.value, defect)}
                                             className="w-full bg-white border border-purple-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-purple-500 shadow-sm cursor-pointer"
                                           />
                                         </div>

                                         {/* ระยะเวลา (1 คอลัมน์) */}
                                         <div className="col-span-1">
                                           <label className="block text-[9px] font-bold text-pink-600 mb-1 text-center">ระยะเวลา</label>
                                           {canEditEndDate ? (
                                             <input 
                                               type="number"
                                               min="1"
                                               placeholder="วัน"
                                               value={curDuration}
                                               onClick={(e) => e.stopPropagation()}
                                               onChange={(e) => handleScheduleChange(defect.id, 'duration', e.target.value, defect)}
                                               className="w-full bg-pink-50/80 border border-pink-200 rounded-lg px-1 py-1.5 text-xs font-bold text-center text-pink-600 outline-none focus:ring-2 focus:ring-pink-500 shadow-sm cursor-pointer"
                                             />
                                           ) : (
                                             <div className="w-full bg-slate-100 border border-slate-200 rounded-lg px-1 py-1.5 text-[10px] font-bold text-center text-slate-400 truncate" title="เฉพาะโฟร์แมนระบุ">
                                               {curDuration ? `${curDuration}ว` : '-'}
                                             </div>
                                           )}
                                         </div>

                                         {/* วันเสร็จสิ้น (2 คอลัมน์) */}
                                         <div className="col-span-2">
                                           <label className="block text-[9px] font-bold text-slate-500 mb-1">วันเสร็จสิ้น</label>
                                           {canEditEndDate ? (
                                             <input 
                                               type="date"
                                               value={curEnd}
                                               onClick={(e) => e.stopPropagation()}
                                               onChange={(e) => handleScheduleChange(defect.id, 'end', e.target.value, defect)}
                                               className="w-full bg-white border border-purple-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-purple-500 shadow-sm cursor-pointer"
                                             />
                                           ) : (
                                             <div className="w-full bg-slate-100 border border-slate-200 rounded-lg px-1 py-1.5 text-[10px] font-bold text-center text-slate-400 truncate" title="เฉพาะโฟร์แมนระบุ">
                                               {curEnd ? new Date(curEnd).toLocaleDateString('th-TH', {day:'numeric', month:'short'}) : 'รอโฟร์แมน'}
                                             </div>
                                           )}
                                         </div>
                                       </div>

                                       {isProcurement && (
                                         <div className="text-[9px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2.5 py-1 mt-2 flex items-center gap-1 font-semibold">
                                           <span>💡 ผู้จัดจ้างกำหนดวันเริ่มงาน (วันเสร็จสิ้นรอโฟร์แมนประเมิน)</span>
                                         </div>
                                       )}

                                       {(defect.actual_start || defect.actual_end) && (
                                         <div className="flex items-center gap-3 mt-2 pt-2 border-t border-purple-100 text-[9px] text-slate-500">
                                           <span className="font-bold text-emerald-600">ทำจริง:</span>
                                           {defect.actual_start && <span>เริ่ม {new Date(defect.actual_start).toLocaleDateString('th-TH', {day:'numeric',month:'short'})}</span>}
                                           {defect.actual_end && <span>จบ {new Date(defect.actual_end).toLocaleDateString('th-TH', {day:'numeric',month:'short'})}</span>}
                                         </div>
                                       )}

                                       {hasPendingScheduleChanges && (
                                         <button
                                           type="button"
                                           onClick={(e) => {
                                             e.stopPropagation();
                                             handleSaveDefectSchedules();
                                           }}
                                           disabled={isSubmitting}
                                           className="w-full mt-2.5 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow transition-all cursor-pointer"
                                         >
                                           {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                                           {isProcurement ? 'บันทึกวันเริ่มงานรายการนี้' : 'บันทึกแผนซ่อมรายการนี้'}
                                         </button>
                                       )}
                                     </div>
                                   ) : (
                                     <div className="grid grid-cols-2 gap-3 mb-3">
                                       <div className="bg-[#f5f5f7] rounded-xl p-3 border border-slate-100">
                                           <span className="text-[9px] font-bold uppercase text-[#86868b] block mb-1">แผนงาน</span>
                                           <p className="text-[10px] font-bold text-[#1d1d1f]">เริ่ม: {defect.planned_start ? new Date(defect.planned_start).toLocaleDateString('th-TH',{day:'numeric',month:'short'}) : '-'}</p>
                                           <p className="text-[10px] font-bold text-[#1d1d1f]">จบ: {defect.planned_end ? new Date(defect.planned_end).toLocaleDateString('th-TH',{day:'numeric',month:'short'}) : '-'}</p>
                                           <div className="text-[10px] font-bold text-pink-500 mt-1 bg-pink-50 inline-block px-1.5 py-0.5 rounded">{durationText}</div>
                                       </div>
                                       <div className="bg-[#f5f5f7] rounded-xl p-3 border border-slate-100 flex flex-col justify-between">
                                           <span className="text-[9px] font-bold uppercase text-[#86868b] block">สถานะ</span>
                                           <span className={`text-xs font-bold px-2 py-1 rounded-lg border w-fit ${defect.progress === 100 ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-purple-50 text-purple-600 border-purple-200'}`}>
                                              {defect.progress === 100 ? '✅ เสร็จเรียบร้อย' : 'รอซ่อม'}
                                           </span>
                                           <button 
                                             type="button"
                                             onClick={(e) => { 
                                               e.stopPropagation(); 
                                               setSelectedDefect(defect); 
                                               setDefectReturnView('house-detail'); 
                                               setView('defect-progress'); 
                                             }}
                                             className="w-full mt-2 py-1.5 bg-purple-600 text-white font-bold text-xs rounded-lg cursor-pointer"
                                           >
                                             อัปเดตงาน
                                           </button>
                                       </div>
                                     </div>
                                   )}

                                   {/* แถบสถานะ + ปุ่มอัปเดตงานเมื่อ canEditSchedule */}
                                   {canEditSchedule && (
                                     <div className="flex items-center justify-between bg-[#f5f5f7] rounded-xl px-3 py-2 border border-slate-100">
                                       <div className="flex items-center gap-2">
                                         <span className="text-[10px] font-bold text-[#86868b]">สถานะ:</span>
                                         <span className={`text-xs font-bold px-2 py-0.5 rounded-lg border ${defect.progress === 100 ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-purple-50 text-purple-600 border-purple-200'}`}>
                                           {defect.progress === 100 ? '✅ เสร็จเรียบร้อย' : 'รอซ่อม'}
                                         </span>
                                       </div>
                                       <button 
                                         type="button"
                                         onClick={(e) => {
                                           e.stopPropagation();
                                           setSelectedDefect(defect);
                                           setDefectReturnView('house-detail');
                                           setView('defect-progress');
                                         }}
                                         className="py-1.5 px-3 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs rounded-lg shadow-sm cursor-pointer transition-all active:scale-95"
                                       >
                                         อัปเดตงาน &gt;
                                       </button>
                                     </div>
                                   )}
                               </td>
                             </tr>
                          )}

                          {/* 💻 2. โซน PC (Desktop Table Row matching Construction layout) */}
                          {!isMobileLayout && (
                          <tr key={defect.id} className="group transition-colors cursor-pointer table-row bg-white hover:bg-slate-50/80" onClick={() => { setSelectedDefect(defect); setDefectReturnView('house-detail'); setView('defect-progress'); }}>
                            {/* Col 1: Task Name (280px) */}
                            <td className="p-2 sm:p-3 border-b border-black/5 h-[120px] w-[280px] min-w-[280px] max-w-[280px] z-20 bg-white sticky left-0 shadow-[4px_0_10px_-4px_rgba(0,0,0,0.1)]">
                               <div className="w-full h-full flex flex-col justify-between">
                                  <div className="min-w-0">
                                     <div className="flex items-start gap-1.5 justify-between">
                                        <div className="flex items-start gap-1.5 min-w-0 flex-1">
                                           <span className="text-[10px] sm:text-xs font-bold text-slate-400 shrink-0 bg-[#f5f5f7] px-1.5 py-0.5 rounded border mt-0.5">#{idx + 1}</span>
                                           <h4 className={`font-bold text-xs sm:text-sm leading-tight text-ellipsis overflow-hidden [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] ${defect.progress === 100 ? 'text-slate-400 line-through' : 'text-[#1d1d1f]'}`} title={taskTemp?.task_name || defect.description}>
                                              {taskTemp?.task_name || defect.description}
                                           </h4>
                                        </div>
                                        {currentUserRole === 'Admin' && (
                                           <button 
                                             type="button"
                                             onClick={(e) => {
                                               e.stopPropagation();
                                               handleDeleteDefect(defect);
                                             }}
                                             title="ลบรายการแจ้งซ่อม (เฉพาะ Admin)"
                                             className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors shrink-0 cursor-pointer"
                                           >
                                             <Trash2 size={15} />
                                           </button>
                                        )}
                                     </div>
                                  </div>

                                  <div className="pt-2 flex flex-col gap-1.5">
                                     <div className="flex items-center gap-1.5">
                                        <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden flex">
                                           <div className={`h-full transition-all duration-300 ${defect.progress === 100 ? 'bg-emerald-500' : 'bg-purple-600'}`} style={{ width: `${defect.progress || 0}%` }}></div>
                                        </div>
                                        <span className="text-[10px] font-black text-slate-700 min-w-[28px] text-right">{defect.progress || 0}%</span>
                                     </div>

                                     <div className="flex items-center justify-between gap-1 mt-0.5">
                                        {contractor?.name ? (
                                           <div className="flex items-center gap-1 min-w-0">
                                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md border border-purple-100 truncate"><HardHat size={12} className="shrink-0" /> <span className="truncate">{contractor.name.split(' ')[0]}</span></span>
                                              {canAssignContractor && (
                                                 <button type="button" onClick={(e) => { e.stopPropagation(); setAssigningDefect(defect); }} className="p-0.5 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors cursor-pointer shrink-0" title="เปลี่ยนช่าง">
                                                    <UserCog size={13} />
                                                 </button>
                                              )}
                                           </div>
                                        ) : canAssignContractor ? (
                                           <button type="button" onClick={(e) => { e.stopPropagation(); setAssigningDefect(defect); }} className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-500 hover:text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 border-dashed px-2 py-0.5 rounded-md transition-colors cursor-pointer truncate">
                                              <HardHat size={12} className="shrink-0" /> ยังไม่ระบุช่าง
                                           </button>
                                        ) : (
                                           <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 bg-[#f5f5f7] px-2 py-0.5 rounded-md"><HardHat size={12} /> ยังไม่ระบุช่าง</span>
                                        )}
                                     </div>
                                  </div>
                               </div>
                            </td>

                            {/* Col 2: Status (80px) */}
                            <td className="sticky left-[280px] bg-white z-20 border-b border-r border-black/5 p-2 text-center w-[80px] min-w-[80px] max-w-[80px] shadow-[-6px_0_10px_-6px_rgba(0,0,0,0.08)] align-middle">
                               <span className={`text-[10px] sm:text-xs font-black px-2 py-1 rounded-lg border inline-block ${defect.progress === 100 ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : defect.progress > 0 ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-rose-50 text-rose-500 border-rose-200'}`}>
                                 {defect.progress === 100 ? 'เสร็จ' : defect.progress > 0 ? 'กำลังแก้' : 'รอซ่อม'}
                               </span>
                            </td>

                            {/* Col 3: Start (140px) */}
                            <td className="sticky left-[360px] bg-white z-20 border-b border-r border-black/5 p-2 text-center w-[115px] sm:w-[140px] min-w-[115px] sm:min-w-[140px] max-w-[115px] sm:max-w-[140px] shadow-[-6px_0_10px_-6px_rgba(0,0,0,0.08)] align-middle">
                               {canEditSchedule ? (
                                  <div className="flex flex-col items-center gap-1">
                                     <span className="text-[8px] font-bold uppercase text-slate-400">Plan:</span>
                                     <input type="date" value={curStart}
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={(e) => handleScheduleChange(defect.id, 'start', e.target.value, defect)} 
                                        className="w-full border border-purple-200 rounded px-1.5 py-1 text-[10px] font-bold text-center text-[#1d1d1f] outline-none focus:border-purple-500 bg-white shadow-sm cursor-pointer" 
                                     />
                                     {defect.actual_start && (
                                        <span className="text-[8px] font-bold text-emerald-600 mt-0.5">Act: {new Date(defect.actual_start).toLocaleDateString('en-GB', {day:'2-digit',month:'2-digit',year:'2-digit'})}</span>
                                     )}
                                  </div>
                               ) : (
                                  <div className="flex flex-col items-center gap-1">
                                     <span className="text-[8px] font-bold uppercase text-slate-400">PLAN:</span>
                                     <span className="text-[11px] font-bold text-slate-700">{defect.planned_start ? new Date(defect.planned_start).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '-'}</span>
                                     {defect.actual_start && (
                                        <span className="text-[8px] font-bold text-emerald-600">Act: {new Date(defect.actual_start).toLocaleDateString('en-GB', {day:'2-digit',month:'2-digit',year:'2-digit'})}</span>
                                     )}
                                  </div>
                                )}
                            </td>

                            {/* Col 4: Duration (100px) */}
                            <td className="sticky left-[500px] bg-white z-20 border-b border-r border-black/5 p-2 text-center w-[70px] sm:w-[100px] min-w-[70px] sm:min-w-[100px] max-w-[70px] sm:max-w-[100px] align-middle">
                               {canEditEndDate ? (
                                  <div className="flex flex-col items-center gap-1">
                                     <span className="text-[8px] font-bold uppercase text-pink-500">Days:</span>
                                     <input type="number" min="1" placeholder="วัน" value={curDuration} 
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={(e) => handleScheduleChange(defect.id, 'duration', e.target.value, defect)}
                                        className="w-full border border-pink-200 rounded px-1 py-1 text-[10px] font-bold text-center text-pink-600 outline-none focus:border-pink-500 bg-pink-50/50 shadow-sm cursor-pointer" 
                                     />
                                  </div>
                               ) : (
                                  <div className="flex flex-col items-center gap-1">
                                     <span className="text-[10px] sm:text-xs font-bold text-pink-600 bg-pink-50 px-2 py-1 rounded-md border border-pink-100">
                                       {curDuration ? `${curDuration} วัน` : isProcurement ? 'รอโฟร์แมน' : durationText}
                                     </span>
                                  </div>
                               )}
                            </td>

                            {/* Col 5: Finish (140px) */}
                            <td className="sticky left-[600px] bg-white z-20 border-b border-r border-black/5 p-2 text-center w-[115px] sm:w-[140px] min-w-[115px] sm:min-w-[140px] max-w-[115px] sm:max-w-[140px] shadow-[6px_0_10px_-6px_rgba(0,0,0,0.1)] align-middle">
                               {canEditEndDate ? (
                                  <div className="flex flex-col items-center gap-1">
                                     <span className="text-[8px] font-bold uppercase text-slate-400">Plan:</span>
                                     <input type="date" value={curEnd} 
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={(e) => handleScheduleChange(defect.id, 'end', e.target.value, defect)} 
                                        className="w-full border border-purple-200 rounded px-1.5 py-1 text-[10px] font-bold text-center text-[#1d1d1f] outline-none focus:border-purple-500 bg-white shadow-sm cursor-pointer" 
                                     />
                                     {defect.actual_end && (
                                        <span className="text-[8px] font-bold text-emerald-600 mt-0.5">Act: {new Date(defect.actual_end).toLocaleDateString('en-GB', {day:'2-digit',month:'2-digit',year:'2-digit'})}</span>
                                     )}
                                  </div>
                               ) : (
                                  <div className="flex flex-col items-center gap-1">
                                     <span className="text-[8px] font-bold uppercase text-slate-400">PLAN:</span>
                                     <span className="text-[11px] font-bold text-slate-700">
                                       {curEnd ? new Date(curEnd).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'2-digit'}) : isProcurement ? 'รอโฟร์แมน' : (defect.planned_end ? new Date(defect.planned_end).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '-')}
                                     </span>
                                     {defect.actual_end && (
                                        <span className="text-[8px] font-bold text-emerald-600">Act: {new Date(defect.actual_end).toLocaleDateString('en-GB', {day:'2-digit',month:'2-digit',year:'2-digit'})}</span>
                                     )}
                                  </div>
                               )}
                            </td>

                            {/* Col 6: Gantt Chart Timeline */}
                            <td className="p-0 border-b border-black/5 relative z-10 w-full bg-[#fcfcfd] overflow-hidden" style={{ minWidth: `${totalChartDays * 36}px`, height: '120px' }}>
                               <div className="absolute inset-0 pointer-events-none z-0" style={{ 
                                    backgroundImage: `repeating-linear-gradient(to right, transparent, transparent calc(100% / ${totalChartDays} - 1px), #f1f5f9 calc(100% / ${totalChartDays} - 1px), #f1f5f9 calc(100% / ${totalChartDays}))`,
                                    backgroundSize: `calc(100% / ${totalChartDays}) 100%`
                                 }}>
                                  {todayTs >= chartStart && todayTs <= chartEnd && ( <div className="absolute top-0 bottom-0 border-l-2 sm:border-l-[3px] border-dashed border-rose-500/80 z-[15] pointer-events-none" style={{ left: `${getChartLeft(todayTs)}%` }}></div> )}
                               </div>
                               
                               <div className="relative w-full h-full flex flex-col px-0">
                                  {dStartTs && dEndTs && ( 
                                     <div className={`absolute h-5 rounded-md z-[20] shadow-sm opacity-90 flex items-center px-1.5 ${defect.progress === 100 ? 'bg-emerald-500' : 'bg-purple-600'}`} style={{ left: `${getChartLeft(dStartTs)}%`, width: `${getChartWidth(dStartTs, dEndTs)}%`, maxWidth: `${Math.max(0, 100 - getChartLeft(dStartTs))}%`, top: '40%' }}>
                                        <span className="text-[8px] sm:text-[9px] font-black text-white truncate">{defect.progress || 0}%</span>
                                     </div> 
                                  )}
                               </div>
                            </td>
                          </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
               </tbody>
             </table>
          </div>
      </div>

      {/* 📱 Mobile Floating Save Button */}
      {isMobileLayout && ['Admin', 'Project Planner', 'Owner', 'Foreman', 'Procurement'].includes(currentUserRole) && Object.keys(defectScheduleInputs).length > 0 && (
        <div className="fixed bottom-5 left-3 right-3 sm:left-4 sm:right-4 z-50 animate-fade-in">
          <button 
            type="button"
            onClick={handleSaveDefectSchedules} 
            disabled={isSubmitting} 
            className="w-full bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white font-black py-3.5 px-5 rounded-2xl shadow-2xl flex items-center justify-center gap-2 text-sm transition-all border border-emerald-400/40 cursor-pointer"
          >
            {isSubmitting ? (
              <><Loader2 className="animate-spin" size={18} /> กำลังบันทึกแผนซ่อม...</>
            ) : (
              <><CheckCircle size={18} /> {isProcurement ? `💾 บันทึกวันเริ่มงาน (${Object.keys(defectScheduleInputs).length} รายการ)` : `💾 บันทึกแผนซ่อม (${Object.keys(defectScheduleInputs).length} รายการ)`}</>
            )}
          </button>
        </div>
      )}

      <DefectTaskSelectModal 
        isOpen={isSelectModalOpen} 
        onClose={() => setIsSelectModalOpen(false)} 
        taskTemplates={taskTemplates}
        selectedPlot={selectedPlot}
        onSelectTask={handleSelectTasks}
        existingDefects={roundDefects}
      />

      <HandoverCertificateModal 
        isOpen={isCertificateModalOpen}
        onClose={() => setIsCertificateModalOpen(false)}
        selectedPlot={selectedPlot}
        defects={defects}
        taskTemplates={taskTemplates}
        contractors={contractors}
        viewingRound={viewingRound}
        cycle={cycle}
      />

      {/* 🛠️ Contractor Assign Modal */}
      {assigningDefect && (
        <div className="fixed inset-0 bg-black/60 z-[99999] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-5 shadow-2xl border border-slate-200 animate-fade-in">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2 text-purple-700">
                <HardHat size={20} />
                <h3 className="font-bold text-base text-slate-800">ระบุช่าง / ผู้รับเหมา</h3>
              </div>
              <button 
                onClick={() => { setAssigningDefect(null); setContractorSearchQuery(''); }} 
                className="p-1 hover:bg-slate-100 rounded-full text-slate-400 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-xs font-bold text-slate-500 mb-3">
              รายการ: <span className="text-slate-800 font-extrabold">{taskTemplates?.find((t: any) => t.id === (assigningDefect.task_id || assigningDefect.task_template_id))?.task_name || assigningDefect.description}</span>
            </p>

            {/* 🔍 Search Input for Contractors */}
            <div className="relative mb-3">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Search size={15} />
              </div>
              <input
                type="text"
                className="w-full pl-9 pr-8 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-medium transition-colors"
                placeholder="ค้นหาชื่อช่าง, ความเชี่ยวชาญ หรือเบอร์โทร..."
                value={contractorSearchQuery}
                onChange={(e) => setContractorSearchQuery(e.target.value)}
                autoFocus
              />
              {contractorSearchQuery && (
                <button
                  type="button"
                  onClick={() => setContractorSearchQuery('')}
                  className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="max-h-[300px] overflow-y-auto space-y-2 mb-4 custom-scrollbar pr-1">
              {!contractorSearchQuery && (
                <button 
                  type="button"
                  onClick={() => { handleSaveDefectContractor(assigningDefect.id, null); setContractorSearchQuery(''); }}
                  className={`w-full p-3 rounded-xl border text-left text-xs font-bold transition-all flex justify-between items-center cursor-pointer ${!assigningDefect.contractor_id ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-slate-200 hover:bg-slate-50 text-slate-600'}`}
                >
                  <span>🚫 ไม่ระบุช่าง (ยังไม่มอบหมาย)</span>
                  {!assigningDefect.contractor_id && <CheckCircle size={16} className="text-rose-600" />}
                </button>
              )}

              {(() => {
                const q = contractorSearchQuery.toLowerCase().trim();
                const filtered = (contractors || []).filter((c: any) => {
                  if (!q) return true;
                  const nameMatch = (c.name || '').toLowerCase().includes(q);
                  const specMatch = (c.specialization || '').toLowerCase().includes(q);
                  const phoneMatch = (c.phone || '').toLowerCase().includes(q);
                  return nameMatch || specMatch || phoneMatch;
                });

                if (filtered.length === 0) {
                  return (
                    <div className="text-center py-6 text-slate-400 text-xs font-bold bg-slate-50 rounded-xl border border-dashed border-slate-200">
                      ไม่พบข้อมูลช่างที่ตรงกับคำค้นหา &ldquo;{contractorSearchQuery}&rdquo;
                    </div>
                  );
                }

                return filtered.map((c: any) => {
                  const isSelected = assigningDefect.contractor_id === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { handleSaveDefectContractor(assigningDefect.id, c.id); setContractorSearchQuery(''); }}
                      className={`w-full p-3 rounded-xl border text-left text-xs font-bold transition-all flex justify-between items-center cursor-pointer ${isSelected ? 'border-purple-500 bg-purple-50 text-purple-800' : 'border-slate-200 hover:bg-slate-50 text-slate-700'}`}
                    >
                      <div>
                        <div className="font-extrabold text-sm">{c.name}</div>
                        <div className="text-[10px] font-semibold text-slate-400">{c.specialization || 'ผู้รับเหมาทั่วไป'} {c.phone ? `• ${c.phone}` : ''}</div>
                      </div>
                      {isSelected && <CheckCircle size={16} className="text-purple-600" />}
                    </button>
                  );
                });
              })()}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button 
                onClick={() => { setAssigningDefect(null); setContractorSearchQuery(''); }}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-4 py-2 rounded-xl text-xs cursor-pointer"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🌟 Custom App Modal (Alert & Confirm) */}
      <AppCustomModal 
        config={modalConfig} 
        onClose={() => setModalConfig(null)} 
      />
    </div>
  );
}
