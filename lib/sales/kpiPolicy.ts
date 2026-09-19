/**
 * Approved Master v2 templates, NOT deployed employee assignments or a scorer.
 * Profile IDs describe jobs, never Auth roles. Future commands must load a
 * verified, effective-dated employee assignment; never infer one from a name,
 * browser payload, user_metadata, or membership in the CRM Sales role.
 * Pending business decisions are deliberately not given guessed defaults.
 */
export const KPI_PROFILE_IDS = Object.freeze(['head_sales', 'sales_specialist', 'content_sales', 'legal_sales', 'legal_support_sales'] as const);
export type KpiProfileId = typeof KPI_PROFILE_IDS[number];

export interface KpiComponent {
    readonly key: string;
    readonly label: string;
    readonly weight: number;
}

export interface KpiProfileTemplate {
    readonly id: KpiProfileId;
    readonly referenceStaffLabel: string;
    readonly monthlyConfirmedBookingTarget: number;
    readonly monthlyTeamBookingTarget: number | null;
    readonly core: readonly KpiComponent[];
    readonly shared: readonly KpiComponent[];
}

const component = (key: string, label: string, weight: number): KpiComponent => Object.freeze({ key, label, weight });
const shared = Object.freeze([
    component('mindset', 'Mindset & Organization', 10),
    component('learning', 'Learning & Organization Development', 10),
    component('attendance', 'Attendance', 10),
]);

const profile = (
    id: KpiProfileId, referenceStaffLabel: string, monthlyConfirmedBookingTarget: number,
    core: readonly KpiComponent[], monthlyTeamBookingTarget: number | null = null,
): KpiProfileTemplate => Object.freeze({
    id, referenceStaffLabel, monthlyConfirmedBookingTarget, monthlyTeamBookingTarget,
    core: Object.freeze([...core]), shared,
});

export const KPI_PROFILE_TEMPLATES: Readonly<Record<KpiProfileId, KpiProfileTemplate>> = Object.freeze({
    head_sales: profile('head_sales', 'Bell', 3, [
        component('sales_result', 'Sales Result', 30), component('qualified_lead', 'Qualified Lead', 10),
        component('team_sales_result', 'Team Sales Result', 10), component('crm_discipline', 'Pipeline / Follow-up / CRM', 10),
        component('leadership', 'Leadership / Coaching / Forecast', 10),
    ], 9),
    sales_specialist: profile('sales_specialist', 'PIEW (Piwe)', 3, [
        component('sales_result', 'Sales Result', 35), component('qualified_lead', 'Qualified Lead', 15),
        component('appointment_conversion', 'Appointment / Walk-in Conversion', 10),
        component('crm_discipline', 'Lead Follow-up / CRM Discipline', 10),
    ]),
    content_sales: profile('content_sales', 'Ying', 1, [
        component('sales_result', 'Sales Result', 20), component('qualified_lead', 'Qualified Lead', 15),
        component('content_output', 'Content Output ตาม Plan', 15), component('content_qualified', 'Content → Qualified Lead', 10),
        component('crm_appointment', 'Lead Follow-up / CRM / Appointment', 10),
    ]),
    legal_sales: profile('legal_sales', 'Nook', 1, [
        component('sales_result', 'Sales Result', 15), component('qualified_lead', 'Qualified Lead', 10),
        component('legal_accuracy', 'Legal / Document Accuracy', 15), component('legal_on_time', 'Transfer / Legal On-time', 15),
        component('case_crm_checklist', 'Case Management / CRM / Checklist', 15),
    ]),
    legal_support_sales: profile('legal_support_sales', 'Field', 1, [
        component('sales_result', 'Sales Result', 15), component('qualified_lead', 'Qualified Lead', 10),
        component('task_on_time', 'Task On-time', 15), component('document_accuracy', 'Document Accuracy', 15),
        component('crm_legal_support', 'Follow-up / CRM / Legal Support', 15),
    ]),
});

/** Exact profile key only: names and Auth roles are NOT profile assignment APIs. */
export function getKpiProfileTemplate(profileId: string): KpiProfileTemplate | null {
    return typeof profileId === 'string' && Object.prototype.hasOwnProperty.call(KPI_PROFILE_TEMPLATES, profileId)
        ? KPI_PROFILE_TEMPLATES[profileId as KpiProfileId] : null;
}

export const CRM_DISCIPLINE_COMPONENTS = Object.freeze([
    component('visit_form_complete', 'Customer Visit Form ครบถ้วน', 20),
    component('post_visit_same_day', 'Post-Visit Checklist ภายในวันเดียวกัน', 20),
    component('active_next_action', 'Active Lead มี Next Action / Follow-up Date', 20),
    component('follow_up_on_time', 'Follow-up ตรงตามกำหนด', 25),
    component('attempt_log_complete', 'มี Attempt Log และบันทึกผล', 15),
]);

export const KPI_MASTER_V2 = Object.freeze({
    version: 'ailin-sales-master-v2-local-2026-09-16',
    sourceFile: 'md file/AILIN_Sales_JD_KPI_Master_v2.md',
    salesResultBasis: 'confirmed_bookings_net_of_cancellations',
    countTransferAsAdditionalSale: false,
    disciplineTargetPercent: 95,
    qualifiedLeadTarget: null,
    calculationMode: 'evidence_only',
    // No effective date, HR deduction, critical warning, or final score is enabled.
    pendingDecisions: Object.freeze([
        'effective_dates_and_verified_staff_assignments',
        'qualified_target_credit_and_period',
        'cross_month_cancellation_and_negative_net_review',
        'team_membership_and_shared_credit',
        'mixed_component_scoring_and_target_conversion',
        'metric_eligibility_due_dates_and_na_policy',
        'discipline_threshold_scope_and_attempt_quality',
        'mindset_rubric_conversion_and_reviewers',
        'attendance_source_period_and_hr_policy_approval',
    ] as const),
});

export type KpiTemplateIssue = 'INVALID_TARGET' | 'INVALID_WEIGHT' | 'DUPLICATE_COMPONENT'
    | 'CORE_WEIGHT_NOT_70' | 'SHARED_WEIGHT_NOT_30' | 'TOTAL_WEIGHT_NOT_100';

/** Structural check for internally constructed templates, not an untrusted JSON parser. */
export function validateKpiTemplate(template: KpiProfileTemplate): readonly KpiTemplateIssue[] {
    const issues = new Set<KpiTemplateIssue>();
    if (!Number.isInteger(template.monthlyConfirmedBookingTarget) || template.monthlyConfirmedBookingTarget <= 0
        || (template.monthlyTeamBookingTarget !== null
            && (!Number.isInteger(template.monthlyTeamBookingTarget) || template.monthlyTeamBookingTarget <= 0))) {
        issues.add('INVALID_TARGET');
    }
    const all = [...template.core, ...template.shared];
    if (all.some(item => !Number.isFinite(item.weight) || item.weight <= 0 || item.weight > 100)) issues.add('INVALID_WEIGHT');
    if (new Set(all.map(item => item.key)).size !== all.length) issues.add('DUPLICATE_COMPONENT');
    const coreTotal = template.core.reduce((total, item) => total + item.weight, 0);
    const sharedTotal = template.shared.reduce((total, item) => total + item.weight, 0);
    if (coreTotal !== 70) issues.add('CORE_WEIGHT_NOT_70');
    if (sharedTotal !== 30) issues.add('SHARED_WEIGHT_NOT_30');
    if (coreTotal + sharedTotal !== 100) issues.add('TOTAL_WEIGHT_NOT_100');
    return [...issues];
}
