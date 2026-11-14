// ==============================================================================
// 📋 BUILDTRACK: QC INSPECTION SERVICE (บริการบันทึก ตรวจสอบผล และตรวจซ้ำ)
// ==============================================================================

import { supabase } from '@/lib/supabase';
import { 
  QCInspection, 
  QCInspectionAnswer, 
  QCDrawingAnnotation, 
  QCInspectionResult, 
  QCFormTemplate,
  QCFormItem
} from '@/types/qc.types';

export interface FormEvaluationResult {
  isValid: boolean;
  errors: { itemId: string; message: string }[];
  overallResult: QCInspectionResult;
  totalItems: number;
  passedItems: number;
  failedItems: number;
  conditionalItems: number;
  naItems: number;
  criticalFailedItems: number;
}

/**
 * ตรวจสอบความถูกต้องและประเมินผลฟอร์ม (Validation & Evaluation)
 * กฎ:
 * 1. "ยังไม่ได้ตรวจ" ต้องแยกจาก "ไม่เกี่ยวข้อง" (N/A)
 * 2. ข้อบังคับ (Required) ต้องได้รับการตรวจ
 * 3. เลข 0, ติดลบ, ทศนิยม ถือเป็นค่าที่กรอกแล้ว ไม่ใช้ truthiness ตรวจสอบ
 * 4. ตรวจสอบขอบเขต min/max
 * 5. ข้อสำคัญ (is_critical) ที่ไม่ผ่าน จะทำให้ผลรวมไม่ผ่านทันที (ไม่เฉลี่ยให้ผ่าน)
 * 6. ตรวจสอบเงื่อนไขข้อบังคับเมื่อไม่ผ่าน (require_remark_on_fail, require_photo_on_fail)
 * 7. รายการที่ผ่านแบบมีเงื่อนไข (conditional) ต้องระบุหมายเหตุ/เงื่อนไข และส่งผลรวมเป็น 'conditional'
 * 8. ข้อตัวเลขที่ยังไม่ได้ปักหมุดหรือไม่ได้กรอกตัวเลข แต่ QC กดประเมินผ่าน/ไม่ผ่านหน้างาน ให้ยอมรับได้ (Fallback)
 */
export function evaluateInspectionAnswers(
  items: QCFormItem[],
  answers: QCInspectionAnswer[],
  annotations: QCDrawingAnnotation[] = []
): FormEvaluationResult {
  const errors: { itemId: string; message: string }[] = [];
  const answerMap = new Map(answers.map(a => [a.form_item_id, a]));

  let passedItems = 0;
  let failedItems = 0;
  let conditionalItems = 0;
  let naItems = 0;
  let criticalFailedItems = 0;

  for (const item of items) {
    const ans = answerMap.get(item.id);

    // 1. ตรวจสอบสถานะการตรวจ
    const status = ans?.status || 'uninspected';

    if (item.is_required && status === 'uninspected') {
      errors.push({
        itemId: item.id,
        message: `รายการ "${item.item_code} ${item.item_text}" ยังไม่ได้ทำการตรวจ`
      });
      continue;
    }

    if (status === 'na') {
      naItems++;
      continue;
    }

    if (status === 'conditional') {
      conditionalItems++;
      if (!ans?.remarks || !ans.remarks.trim()) {
        errors.push({
          itemId: item.id,
          message: `รายการ "${item.item_code}" ผ่านแบบมีเงื่อนไข จำเป็นต้องระบุหมายเหตุหรือข้อบกพร่องที่ต้องแก้ไข`
        });
      }
      continue;
    }

    // 2. ตรวจสอบชนิดตัวเลข (Number validation)
    if (item.item_type === 'number') {
      const numVal = ans?.numeric_value;
      const hasNumber = typeof numVal === 'number' && !Number.isNaN(numVal);

      if (hasNumber) {
        let isPass = true;
        if (item.min_value !== undefined && item.min_value !== null && numVal < item.min_value) {
          isPass = false;
        }
        if (item.max_value !== undefined && item.max_value !== null && numVal > item.max_value) {
          isPass = false;
        }

        const itemPassed = (item.min_value !== undefined || item.max_value !== undefined) 
          ? isPass 
          : status === 'passed';

        if (itemPassed) {
          passedItems++;
        } else {
          failedItems++;
          if (item.is_critical) criticalFailedItems++;
        }
      } else {
        // กรณีไม่มีการกรอกตัวเลข แต่ QC ได้ประเมินผลผ่าน/ไม่ผ่านหน้างานโดยตรง (Fallback)
        if (status === 'passed') {
          passedItems++;
        } else if (status === 'failed') {
          failedItems++;
          if (item.is_critical) criticalFailedItems++;
        }
      }
    } 
    // 3. ตรวจสอบจุดปักหมุดบนแบบ (Drawing points)
    else if (item.item_type === 'drawing_point') {
      const relatedPins = annotations.filter(pin => pin.form_item_id === item.id);
      
      if (relatedPins.length > 0) {
        const hasFailedPin = relatedPins.some(pin => pin.status === 'failed');
        const hasConditionalPin = relatedPins.some(pin => pin.status === 'conditional');

        if (hasFailedPin || status === 'failed') {
          failedItems++;
          if (item.is_critical) criticalFailedItems++;
        } else if (hasConditionalPin) {
          conditionalItems++;
        } else {
          passedItems++;
        }
      } else {
        // ถ้าไม่มีหมุดปัก แต่ตรวจประเมินหน้างานโดยตรง
        if (status === 'passed') {
          passedItems++;
        } else if (status === 'failed') {
          failedItems++;
          if (item.is_critical) criticalFailedItems++;
        }
      }
    } 
    // 4. ตรวจสอบคำถาม Pass/Fail/NA และอื่นๆ
    else {
      if (status === 'passed') {
        passedItems++;
      } else if (status === 'failed') {
        failedItems++;
        if (item.is_critical) criticalFailedItems++;

        // ตรวจสอบเงื่อนไขเมื่อไม่ผ่าน: หมายเหตุ
        if (item.require_remark_on_fail && (!ans?.remarks || !ans.remarks.trim())) {
          errors.push({
            itemId: item.id,
            message: `รายการ "${item.item_code}" ไม่ผ่านการตรวจ จำเป็นต้องระบุหมายเหตุ/ข้อบกพร่อง`
          });
        }

        // ตรวจสอบเงื่อนไขเมื่อไม่ผ่าน: รูปถ่าย
        if (item.require_photo_on_fail && (!ans?.photo_urls || ans.photo_urls.length === 0)) {
          errors.push({
            itemId: item.id,
            message: `รายการ "${item.item_code}" ไม่ผ่านการตรวจ จำเป็นต้องแนบรูปถ่ายหลักฐาน`
          });
        }
      }
    }
  }

  // ประเมินผลลัพธ์รวม
  let overallResult: QCInspectionResult = 'passed';
  if (criticalFailedItems > 0 || failedItems > 0) {
    overallResult = 'failed';
  } else if (conditionalItems > 0) {
    overallResult = 'conditional';
  } else if (passedItems === 0 && naItems > 0) {
    overallResult = 'conditional';
  }

  return {
    isValid: errors.length === 0,
    errors,
    overallResult,
    totalItems: items.length,
    passedItems,
    failedItems,
    conditionalItems,
    naItems,
    criticalFailedItems
  };
}

/**
 * บันทึกร่างการตรวจ (Save Draft)
 */
export async function saveInspectionDraft(params: {
  inspectionId?: string;
  projectName: string;
  plotId: string;
  taskTemplateId: string;
  taskName: string;
  roundNumber: number;
  previousInspectionId?: string | null;
  formTemplate: QCFormTemplate;
  drawing?: { id: string; version: number; title: string } | null;
  inspectorName: string;
  inspectorRole: string;
  answers: QCInspectionAnswer[];
  annotations: QCDrawingAnnotation[];
  notes?: string;
  photoUrls?: string[];
}): Promise<{ success: boolean; inspectionId: string; error?: string }> {
  try {
    const {
      inspectionId,
      projectName,
      plotId,
      taskTemplateId,
      taskName,
      roundNumber,
      previousInspectionId,
      formTemplate,
      drawing,
      inspectorName,
      inspectorRole,
      answers,
      annotations,
      notes,
      photoUrls = []
    } = params;

    // คำนวณสรุปเบื้องต้น
    const passedCount = answers.filter(a => a.status === 'passed').length;
    const failedCount = answers.filter(a => a.status === 'failed').length;
    const conditionalCount = answers.filter(a => a.status === 'conditional').length;
    const naCount = answers.filter(a => a.status === 'na').length;

    const payload: Partial<QCInspection> = {
      project_name: projectName,
      plot_id: plotId,
      task_template_id: taskTemplateId,
      task_name: taskName,
      round_number: roundNumber,
      previous_inspection_id: previousInspectionId || null,
      inspection_method: 'form_v2',
      form_template_id: formTemplate.id,
      form_version: formTemplate.version,
      form_title: formTemplate.title,
      drawing_id: drawing?.id || null,
      drawing_version: drawing?.version || null,
      drawing_title: drawing?.title || null,
      inspector_name: inspectorName,
      inspector_role: inspectorRole,
      document_status: 'draft',
      total_items: formTemplate.items?.length || answers.length,
      passed_items: passedCount,
      failed_items: failedCount,
      conditional_items: conditionalCount,
      na_items: naCount,
      notes: notes || '',
      photo_urls: photoUrls,
      updated_at: new Date().toISOString()
    };

    let actualId = inspectionId;

    if (actualId) {
      const { error: updErr } = await supabase
        .from('qc_inspections')
        .update(payload)
        .eq('id', actualId);
      if (updErr) throw updErr;
    } else {
      const { data: newInsp, error: insErr } = await supabase
        .from('qc_inspections')
        .insert([payload])
        .select('id')
        .single();
      if (insErr) throw insErr;
      actualId = newInsp.id;
    }

    // บันทึกคำตอบ
    if (answers.length > 0 && actualId) {
      const answersPayload = answers.map(a => ({
        inspection_id: actualId,
        form_item_id: a.form_item_id,
        item_code: a.item_code,
        item_text: a.item_text,
        item_type: a.item_type,
        is_critical: a.is_critical,
        status: a.status,
        numeric_value: a.numeric_value ?? null,
        unit: a.unit || null,
        text_value: a.text_value || null,
        selected_options: a.selected_options || [],
        photo_urls: a.photo_urls || [],
        remarks: a.remarks || null,
        transferred_to_task_template_id: a.transferred_to_task_template_id || null,
        transferred_to_task_name: a.transferred_to_task_name || null,
        updated_at: new Date().toISOString()
      }));

      await supabase
        .from('qc_inspection_answers')
        .upsert(answersPayload, { onConflict: 'inspection_id,form_item_id' });
    }

    // บันทึกจุดปักหมุด
    if (actualId) {
      // ลบหมุดเก่าก่อนเขียนใหม่
      await supabase.from('qc_drawing_annotations').delete().eq('inspection_id', actualId);
      if (annotations.length > 0) {
        const pinsPayload = annotations.map(p => ({
          inspection_id: actualId,
          form_item_id: p.form_item_id || null,
          page_number: p.page_number || 1,
          pin_label: p.pin_label,
          x_ratio: p.x_ratio,
          y_ratio: p.y_ratio,
          target_value: p.target_value ?? null,
          tolerance: p.tolerance ?? null,
          min_value: p.min_value ?? null,
          max_value: p.max_value ?? null,
          measured_value: p.measured_value ?? null,
          unit: p.unit || null,
          status: p.status || null,
          remarks: p.remarks || null,
          photo_url: p.photo_url || null,
          transferred_to_task_template_id: p.transferred_to_task_template_id || null,
          transferred_to_task_name: p.transferred_to_task_name || null
        }));
        await supabase.from('qc_drawing_annotations').insert(pinsPayload);
      }
    }

    return { success: true, inspectionId: actualId! };
  } catch (err: any) {
    console.error('Error saving inspection draft:', err);
    return { success: false, inspectionId: '', error: err?.message || 'ไม่สามารถบันทึกร่างได้' };
  }
}

/**
 * ส่งผลการตรวจ (Submit Inspection)
 * - หากมีข้อที่มีสถานะ conditional (ผ่านแบบมีเงื่อนไข) สถานะเอกสารจะกลายเป็น 'pending_pe' รอวิศวกรโครงการตรวจสอบ
 */
export async function submitInspection(params: {
  inspectionId: string;
  items: QCFormItem[];
  answers: QCInspectionAnswer[];
  annotations: QCDrawingAnnotation[];
  actorUsername: string;
  actorRole: string;
}): Promise<{ success: boolean; evaluation: FormEvaluationResult; error?: string }> {
  const { inspectionId, items, answers, annotations, actorUsername, actorRole } = params;

  // 1. ตรวจสอบความสมบูรณ์ฝั่ง server
  const evaluation = evaluateInspectionAnswers(items, answers, annotations);
  if (!evaluation.isValid) {
    return {
      success: false,
      evaluation,
      error: evaluation.errors.map(e => e.message).join(' | ')
    };
  }

  try {
    // ถ้าผลรวมเป็น conditional ให้ตั้งสถานะเป็น 'pending_pe'
    const nextDocStatus = evaluation.overallResult === 'conditional' ? 'pending_pe' : 'submitted';

    // 2. อัปเดตสถานะใน qc_inspections
    const { error: updErr } = await supabase
      .from('qc_inspections')
      .update({
        document_status: nextDocStatus,
        inspection_result: evaluation.overallResult,
        passed_items: evaluation.passedItems,
        failed_items: evaluation.failedItems,
        conditional_items: evaluation.conditionalItems,
        na_items: evaluation.naItems,
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', inspectionId);

    if (updErr) throw updErr;

    // บันทึก Audit
    await supabase.from('qc_audit_logs').insert([{
      action_type: 'submit_inspection',
      entity_type: 'qc_inspections',
      entity_id: inspectionId,
      actor_username: actorUsername,
      actor_role: actorRole,
      details: {
        overallResult: evaluation.overallResult,
        passedItems: evaluation.passedItems,
        failedItems: evaluation.failedItems
      }
    }]);

    // ส่งแจ้งเตือนไปยัง Project Engineer (PE) โดยตรง (ไม่ส่งหา SE) และบันทึกสถานะรอ PE ใน task_updates
    if (evaluation.overallResult === 'conditional') {
      const { data: inspData } = await supabase
        .from('qc_inspections')
        .select('plot_id, task_template_id, task_name, photo_urls')
        .eq('id', inspectionId)
        .maybeSingle();

      if (inspData) {
        await supabase.from('notifications').insert([
          {
            plot_id: inspData.plot_id,
            task_template_id: inspData.task_template_id,
            title: 'งานรอวิศวกรโครงการ (PE) พิจารณาอนุมัติแบบมีเงื่อนไข',
            message: `QC ตรวจงาน "${inspData.task_name}" แปลง ${inspData.plot_id} ผ่านแบบมีเงื่อนไข รอ PE ตรวจสอบและลงนาม`,
            target_role: 'Project Engineer',
            is_read: false
          },
          {
            plot_id: inspData.plot_id,
            task_template_id: inspData.task_template_id,
            title: 'งานรอวิศวกรโครงการ (PE) พิจารณาอนุมัติแบบมีเงื่อนไข',
            message: `QC ตรวจงาน "${inspData.task_name}" แปลง ${inspData.plot_id} ผ่านแบบมีเงื่อนไข รอ PE ตรวจสอบและลงนาม`,
            target_role: 'Project Planner',
            is_read: false
          }
        ]);

        const taskUpdTable: any = supabase.from('task_updates');
        if (typeof taskUpdTable?.insert === 'function') {
          await taskUpdTable.insert([{
            plot_id: inspData.plot_id,
            task_template_id: inspData.task_template_id,
            user_name: actorUsername,
            role: actorRole || 'QC',
            action: 'QC ส่งตรวจแบบมีเงื่อนไข (รอ PE อนุมัติ)',
            text_content: `ตรวจพบรายการผ่านแบบมีเงื่อนไข (${evaluation.conditionalItems} ข้อ) ส่งต่อให้วิศวกรโครงการ (PE) พิจารณาอนุมัติ`,
            progress: 100,
            is_completed: false,
            image_url: (inspData.photo_urls || []).join(',')
          }]);
        }
      }
    }

    return { success: true, evaluation };
  } catch (err: any) {
    return { success: false, evaluation, error: err?.message || 'ไม่สามารถส่งผลตรวจได้' };
  }
}

/**
 * รับรอง/อนุมัติผลการตรวจ (Approve or Reject by QC/Admin)
 * ซิงค์ไปยัง task_updates เพื่อรักษาความสอดคล้องของระบบเดิม:
 * - ถ้าผ่าน: action = 'QC อนุมัติ', progress = 100
 * - ถ้าไม่ผ่าน: action = 'QC แจ้งแก้ไข', progress = 95 พร้อมสร้าง defect
 */
export async function approveInspection(params: {
  inspection: QCInspection;
  answers: QCInspectionAnswer[];
  actorUsername: string;
  actorRole: string;
  decision: 'approve' | 'reject';
  remarks?: string;
}): Promise<{ success: boolean; error?: string }> {
  const { inspection, answers, actorUsername, actorRole, decision, remarks } = params;

  try {
    const isApproved = decision === 'approve' && inspection.inspection_result === 'passed';
    const finalDocStatus = isApproved ? 'approved' : 'rejected';
    const finalResult = isApproved ? 'passed' : 'failed';

    // 1. อัปเดตสถานะใน qc_inspections
    const { error: inspErr } = await supabase
      .from('qc_inspections')
      .update({
        document_status: finalDocStatus,
        inspection_result: finalResult,
        approved_at: new Date().toISOString(),
        approved_by: actorUsername,
        updated_at: new Date().toISOString()
      })
      .eq('id', inspection.id);

    if (inspErr) throw inspErr;

    // 2. ซิงค์ไปยัง task_updates เพื่อให้ trigger และ views ของระบบเดิมทำงานต่อได้สมบูรณ์
    const finalP = isApproved ? 100 : 95;
    const actionLabel = isApproved ? 'QC อนุมัติ' : 'QC แจ้งแก้ไข';
    const summaryText = remarks || (isApproved 
      ? `ผ่านการตรวจ QC แบบฟอร์มใหม่ (${inspection.form_title} v${inspection.form_version} - ผ่าน ${inspection.passed_items}/${inspection.total_items} ข้อ)`
      : `ไม่ผ่านการตรวจ QC แบบฟอร์มใหม่ (${inspection.form_title} v${inspection.form_version} - ไม่ผ่าน ${inspection.failed_items} ข้อ)`
    );

    const { error: updErr } = await supabase.from('task_updates').insert([{
      plot_id: inspection.plot_id,
      task_template_id: inspection.task_template_id,
      user_name: actorUsername,
      role: actorRole || 'QC',
      action: actionLabel,
      text_content: summaryText,
      progress: finalP,
      is_completed: finalP === 100,
      image_url: (inspection.photo_urls || []).join(',')
    }]);

    if (updErr) throw updErr;

    // 3. จัดการ defects
    if (isApproved) {
      // ปลด defect ค้าง
      await supabase.from('defects')
        .update({ status: 'resolved', resolved_at: new Date().toISOString() })
        .eq('plot_id', inspection.plot_id)
        .eq('task_id', inspection.task_template_id)
        .eq('status', 'pending');
    } else {
      // สร้าง defect สำหรับข้อที่ไม่ผ่าน
      const failedAnswers = answers.filter(a => a.status === 'failed');
      const defectDescription = failedAnswers.map(a => `[${a.item_code}] ${a.item_text}${a.remarks ? `: ${a.remarks}` : ''}`).join('\n') || summaryText;

      await supabase.from('defects').insert([{
        plot_id: inspection.plot_id,
        task_id: inspection.task_template_id,
        description: `ข้อบกพร่องจากการตรวจ QC ฟอร์มใหม่ (รอบที่ ${inspection.round_number}):\n${defectDescription}`,
        reported_by: actorUsername,
        status: 'pending',
        image_url: (inspection.photo_urls || []).join(',')
      }]);

      // ส่งแจ้งเตือนไปยังโฟร์แมน
      await supabase.from('notifications').insert([{
        plot_id: inspection.plot_id,
        task_template_id: inspection.task_template_id,
        title: 'QC แจ้งแก้ไขงาน',
        message: `QC ตีกลับงาน "${inspection.task_name}" แปลง ${inspection.plot_id} (รอบที่ ${inspection.round_number})`,
        target_role: 'Foreman',
        is_read: false
      }]);
    }

    // 4. บันทึก Audit Log
    await supabase.from('qc_audit_logs').insert([{
      action_type: 'approve_inspection',
      entity_type: 'qc_inspections',
      entity_id: inspection.id,
      actor_username: actorUsername,
      actor_role: actorRole,
      details: {
        decision,
        finalDocStatus,
        finalResult,
        roundNumber: inspection.round_number
      }
    }]);

    return { success: true };
  } catch (err: any) {
    console.error('Error approving inspection:', err);
    return { success: false, error: err?.message || 'ไม่สามารถรับรองผลการตรวจได้' };
  }
}

/**
 * สร้างรอบการตรวจซ้ำ (Create Retest Round)
 * สืบทอดฟอร์มเวอร์ชันและแบบเดิมจากรอบแรกเสมอ!
 */
export async function createRetestRound(params: {
  previousInspection: QCInspection;
  previousAnswers: QCInspectionAnswer[];
  actorUsername: string;
  actorRole: string;
}): Promise<{ success: boolean; newInspectionId?: string; error?: string }> {
  const { previousInspection, previousAnswers, actorUsername, actorRole } = params;

  try {
    const nextRound = previousInspection.round_number + 1;

    // 1. สร้าง inspection ใหม่
    const { data: newInsp, error: insErr } = await supabase
      .from('qc_inspections')
      .insert([{
        project_name: previousInspection.project_name,
        plot_id: previousInspection.plot_id,
        task_template_id: previousInspection.task_template_id,
        task_name: previousInspection.task_name,
        round_number: nextRound,
        previous_inspection_id: previousInspection.id,
        inspection_method: 'form_v2', // สืบทอดระบบเดิม
        form_template_id: previousInspection.form_template_id,
        form_version: previousInspection.form_version, // ล็อกเวอร์ชันเดิม
        form_title: previousInspection.form_title,
        drawing_id: previousInspection.drawing_id,
        drawing_version: previousInspection.drawing_version,
        drawing_title: previousInspection.drawing_title,
        inspector_name: actorUsername,
        inspector_role: actorRole,
        document_status: 'draft',
        total_items: previousInspection.total_items,
        passed_items: 0,
        failed_items: 0,
        na_items: 0,
        notes: `ตรวจซ้ำรอบที่ ${nextRound} (สืบเนื่องจากรอบที่ ${previousInspection.round_number})`
      }])
      .select('id')
      .single();

    if (insErr) throw insErr;

    // 2. คัดลอกคำตอบ โดยข้อที่เคยผ่านอาจให้คงผ่าน หรือตั้ง uninspected สำหรับข้อที่เคยตก
    if (previousAnswers.length > 0) {
      const retestAnswers = previousAnswers.map(ans => ({
        inspection_id: newInsp.id,
        form_item_id: ans.form_item_id,
        item_code: ans.item_code,
        item_text: ans.item_text,
        item_type: ans.item_type,
        is_critical: ans.is_critical,
        // ข้อที่เคยผ่านคงผ่านไว้ ข้อที่เคยไม่ผ่านให้กลับมา uninspected เพื่อตรวจซ้ำ
        status: ans.status === 'passed' ? 'passed' : 'uninspected',
        numeric_value: ans.status === 'passed' ? ans.numeric_value : null,
        unit: ans.unit,
        text_value: ans.text_value,
        selected_options: ans.selected_options,
        remarks: ans.status === 'failed' ? `รอบก่อนหน้าไม่ผ่าน: ${ans.remarks || ''}` : null
      }));

      await supabase.from('qc_inspection_answers').insert(retestAnswers);
    }

    // 3. บันทึก Audit Log
    await supabase.from('qc_audit_logs').insert([{
      action_type: 'retest_created',
      entity_type: 'qc_inspections',
      entity_id: newInsp.id,
      actor_username: actorUsername,
      actor_role: actorRole,
      details: {
        previousInspectionId: previousInspection.id,
        roundNumber: nextRound
      }
    }]);

    return { success: true, newInspectionId: newInsp.id };
  } catch (err: any) {
    console.error('Error creating retest round:', err);
    return { success: false, error: err?.message || 'ไม่สามารถสร้างรอบตรวจซ้ำได้' };
  }
}

/**
 * เปิดผลที่รับรองแล้วกลับมาแก้ไข (Reopen Approved Inspection)
 * ต้องมีสิทธิ์ (Admin / Authorized) และระบุเหตุผลชัดเจน พร้อม Audit Trail
 */
export async function reopenInspection(params: {
  inspectionId: string;
  reason: string;
  actorUsername: string;
  actorRole: string;
}): Promise<{ success: boolean; error?: string }> {
  const { inspectionId, reason, actorUsername, actorRole } = params;

  if (!reason || !reason.trim()) {
    return { success: false, error: 'จำเป็นต้องระบุเหตุผลในการขอเปิดผลตรวจกลับมาแก้ไข' };
  }

  // อนุญาตเฉพาะ Admin หรือ Owner
  if (!['Admin', 'Owner'].includes(actorRole)) {
    return { success: false, error: 'คุณไม่มีสิทธิ์ในการเปิดผลการตรวจที่รับรองแล้วกลับมาแก้ไข' };
  }

  try {
    const { error: updErr } = await supabase
      .from('qc_inspections')
      .update({
        document_status: 'draft',
        reopened_at: new Date().toISOString(),
        reopened_by: actorUsername,
        reopened_reason: reason.trim(),
        updated_at: new Date().toISOString()
      })
      .eq('id', inspectionId);

    if (updErr) throw updErr;

    // บันทึก Audit Log
    await supabase.from('qc_audit_logs').insert([{
      action_type: 'reopen_inspection',
      entity_type: 'qc_inspections',
      entity_id: inspectionId,
      actor_username: actorUsername,
      actor_role: actorRole,
      details: {
        reason: reason.trim()
      }
    }]);

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'ไม่สามารถเปิดผลตรวจกลับมาแก้ไขได้' };
  }
}

/**
 * วิศวกรโครงการ (PE) ตรวจสอบและอนุมัติผลการตรวจแบบมีเงื่อนไข (Conditional Approval by PE)
 * - หากอนุมัติ: progress = 100%, สร้าง defect ติดตามส่งต่อไปยังงวดงานถัดไป (transferred_to_task_template_id)
 * - หากไม่อนุมัติ: progress = 95%, แจ้งเตือน Foreman ให้แก้ไข
 */
export async function reviewPEInspection(params: {
  inspection: QCInspection;
  decision: 'approve' | 'reject';
  peUsername: string;
  peRole: string;
  notes?: string;
  answers: QCInspectionAnswer[];
}): Promise<{ success: boolean; error?: string }> {
  const { inspection, decision, peUsername, peRole, notes, answers } = params;

  try {
    const isApproved = decision === 'approve';
    const finalDocStatus = isApproved ? 'approved' : 'rejected';
    const finalResult = isApproved ? 'conditional' : 'failed';

    // 1. อัปเดตสถานะใน qc_inspections
    const { error: inspErr } = await supabase
      .from('qc_inspections')
      .update({
        document_status: finalDocStatus,
        inspection_result: finalResult,
        pe_reviewer_name: peUsername,
        pe_reviewed_at: new Date().toISOString(),
        pe_review_decision: decision,
        pe_review_notes: notes || null,
        approved_at: isApproved ? new Date().toISOString() : null,
        approved_by: isApproved ? peUsername : null,
        updated_at: new Date().toISOString()
      })
      .eq('id', inspection.id);

    if (inspErr) throw inspErr;

    // 2. ซิงค์ไปยัง task_updates
    const finalProgress = isApproved ? 100 : 95;
    const actionLabel = isApproved ? 'PE อนุมัติผ่านมีเงื่อนไข' : 'PE สั่งแก้ไขงาน';
    const summaryText = notes || (isApproved 
      ? `ผ่านการตรวจ QC แบบมีเงื่อนไข (อนุมัติโดยวิศวกรโครงการ ${peUsername} - มีรายการส่งต่องานถัดไป)`
      : `ไม่ผ่านการตรวจ QC โดยวิศวกรโครงการ (${peUsername} แจ้งแก้ไขงาน)`
    );

    const { error: updErr } = await supabase.from('task_updates').insert([{
      plot_id: inspection.plot_id,
      task_template_id: inspection.task_template_id,
      user_name: peUsername,
      role: peRole || 'PE',
      action: actionLabel,
      text_content: summaryText,
      progress: finalProgress,
      is_completed: isApproved,
      image_url: (inspection.photo_urls || []).join(',')
    }]);

    if (updErr) throw updErr;

    // 3. ถ้าอนุมัติผ่านแบบมีเงื่อนไข: ส่งต่อ Defect ไปยังงวดงานปลายทาง (Downstream Task Transfer)
    if (isApproved) {
      const conditionalAnswers = answers.filter(a => a.status === 'conditional');
      const defectsToInsert: any[] = [];

      for (const a of conditionalAnswers) {
        const targetTaskId = a.transferred_to_task_template_id || inspection.task_template_id;
        const targetTaskName = a.transferred_to_task_name ? ` (ส่งต่อเข้า ${a.transferred_to_task_name})` : '';

        defectsToInsert.push({
          plot_id: inspection.plot_id,
          task_id: targetTaskId,
          description: `[QC มีเงื่อนไขจากงาน "${inspection.task_name}"] ${a.item_code} ${a.item_text}: ${a.remarks || 'มีข้อบกพร่องที่ต้องแก้ไขในงวดงานถัดไป'}${targetTaskName}`,
          reported_by: peUsername,
          status: 'pending',
          image_url: (a.photo_urls || []).join(',')
        });
      }

      if (defectsToInsert.length > 0) {
        await supabase.from('defects').insert(defectsToInsert);
      }
    } else {
      // สั่งแก้ไข
      await supabase.from('notifications').insert([{
        plot_id: inspection.plot_id,
        task_template_id: inspection.task_template_id,
        title: 'วิศวกรโครงการสั่งแก้ไขงาน (PE Reject)',
        message: `วิศวกรโครงการ ${peUsername} ไม่อนุมัติงาน "${inspection.task_name}" แปลง ${inspection.plot_id}: ${notes || 'กรุณาแก้ไขก่อนส่งตรวจใหม่'}`,
        target_role: 'Foreman',
        is_read: false
      }]);
    }

    // 4. บันทึก Audit Log
    await supabase.from('qc_audit_logs').insert([{
      action_type: 'pe_review',
      entity_type: 'qc_inspections',
      entity_id: inspection.id,
      actor_username: peUsername,
      actor_role: peRole,
      details: {
        decision,
        finalDocStatus,
        finalResult,
        notes
      }
    }]);

    return { success: true };
  } catch (err: any) {
    console.error('Error reviewing PE inspection:', err);
    return { success: false, error: err?.message || 'ไม่สามารถบันทึกผลการพิจารณาของ PE ได้' };
  }
}

/**
 * ดึงรายการข้อบกพร่องที่ส่งต่อมาจากงวดงานก่อนหน้า (Carried-over defects from upstream tasks)
 */
export async function fetchDownstreamDefects(plotId: string, taskTemplateId: string) {
  try {
    const { data, error } = await supabase
      .from('defects')
      .select('*')
      .eq('plot_id', plotId)
      .eq('task_id', taskTemplateId)
      .neq('status', 'resolved');

    if (error) {
      console.warn('Could not fetch downstream defects:', error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn('Error fetching downstream defects:', err);
    return [];
  }
}

/**
 * บันทึกการแก้ไขข้อบกพร่องที่ส่งต่อมาเรียบร้อยแล้ว
 */
export async function resolveDownstreamDefect(defectId: string, resolvedBy: string) {
  try {
    const { error } = await supabase
      .from('defects')
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString()
      })
      .eq('id', defectId);

    if (error) throw error;
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'ไม่สามารถปลดสถานะข้อบกพร่องได้' };
  }
}
