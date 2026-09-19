// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CRM_DISCIPLINE_COMPONENTS, getKpiProfileTemplate, KPI_MASTER_V2, KPI_PROFILE_IDS, KPI_PROFILE_TEMPLATES,
    validateKpiTemplate, type KpiProfileTemplate } from '../kpiPolicy';

describe('Master v2 templates, without enabling scoring or assigning employees', () => {
    it.each(KPI_PROFILE_IDS)('%s has Core 70 / shared 30 / total 100', id => {
        const profile = KPI_PROFILE_TEMPLATES[id];
        expect(validateKpiTemplate(profile)).toEqual([]);
        expect(profile.core.reduce((sum, item) => sum + item.weight, 0)).toBe(70);
        expect(profile.shared.map(item => item.weight)).toEqual([10, 10, 10]);
    });

    it('uses approved individual targets 3/3/1/1/1 and only Head Sales team target 9', () => {
        expect(KPI_PROFILE_IDS.map(id => KPI_PROFILE_TEMPLATES[id].monthlyConfirmedBookingTarget)).toEqual([3, 3, 1, 1, 1]);
        expect(KPI_PROFILE_IDS.map(id => KPI_PROFILE_TEMPLATES[id].monthlyTeamBookingTarget)).toEqual([9, null, null, null, null]);
        expect(KPI_PROFILE_TEMPLATES.sales_specialist.referenceStaffLabel).toBe('PIEW (Piwe)');
    });

    it('preserves the exact per-position component weights', () => {
        expect(KPI_PROFILE_IDS.map(id => KPI_PROFILE_TEMPLATES[id].core.map(item => item.weight))).toEqual([
            [30, 10, 10, 10, 10], [35, 15, 10, 10], [20, 15, 15, 10, 10], [15, 10, 15, 15, 15], [15, 10, 15, 15, 15],
        ]);
        expect(CRM_DISCIPLINE_COMPONENTS.map(item => item.weight)).toEqual([20, 20, 20, 25, 15]);
        expect(CRM_DISCIPLINE_COMPONENTS.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
    });

    it.each(['Bell', 'PIEW', 'Piwe', 'TAEW', 'JEEJEE', 'owner', 'admin', 'sales', '__proto__', 'constructor', '', ' sales_specialist'])('does not infer a profile from %j', value => {
        expect(getKpiProfileTemplate(value)).toBeNull();
    });

    it('returns a template only for an exact explicit profile ID', () => {
        expect(getKpiProfileTemplate('legal_sales')).toBe(KPI_PROFILE_TEMPLATES.legal_sales);
        expect(getKpiProfileTemplate(['sales_specialist'] as unknown as string)).toBeNull();
        expect(getKpiProfileTemplate(null as unknown as string)).toBeNull();
    });

    it('retains unresolved business policy and never counts transfer as an additional sale', () => {
        expect(KPI_MASTER_V2.salesResultBasis).toBe('confirmed_bookings_net_of_cancellations');
        expect(KPI_MASTER_V2.countTransferAsAdditionalSale).toBe(false);
        expect(KPI_MASTER_V2.qualifiedLeadTarget).toBeNull();
        expect(KPI_MASTER_V2.calculationMode).toBe('evidence_only');
        expect(KPI_MASTER_V2.pendingDecisions).toContain('cross_month_cancellation_and_negative_net_review');
        expect(KPI_MASTER_V2.pendingDecisions).toContain('attendance_source_period_and_hr_policy_approval');
    });

    it('freezes nested templates so one report cannot alter every staff target or weight', () => {
        expect(Object.isFrozen(KPI_PROFILE_TEMPLATES)).toBe(true);
        expect(Object.isFrozen(KPI_PROFILE_IDS)).toBe(true);
        for (const profile of Object.values(KPI_PROFILE_TEMPLATES)) {
            expect(Object.isFrozen(profile)).toBe(true);
            expect(Object.isFrozen(profile.core)).toBe(true);
            expect(Object.isFrozen(profile.shared)).toBe(true);
            for (const item of [...profile.core, ...profile.shared]) expect(Object.isFrozen(item)).toBe(true);
        }
        expect(Object.isFrozen(KPI_MASTER_V2.pendingDecisions)).toBe(true);
        expect(() => { (KPI_PROFILE_TEMPLATES.sales_specialist as { monthlyConfirmedBookingTarget: number }).monthlyConfirmedBookingTarget = 2; }).toThrow();
        expect(KPI_PROFILE_TEMPLATES.sales_specialist.monthlyConfirmedBookingTarget).toBe(3);
    });

    it.each([0, -1, 1.5, NaN, Infinity])('rejects malformed target %s in a future internal configuration', value => {
        expect(validateKpiTemplate({ ...KPI_PROFILE_TEMPLATES.sales_specialist, monthlyConfirmedBookingTarget: value })).toContain('INVALID_TARGET');
        expect(validateKpiTemplate({ ...KPI_PROFILE_TEMPLATES.sales_specialist, monthlyTeamBookingTarget: value })).toContain('INVALID_TARGET');
    });

    it('detects bad sums, duplicate components and invalid weights without mutation', () => {
        const original = KPI_PROFILE_TEMPLATES.sales_specialist;
        const changed: KpiProfileTemplate = { ...original, core: [...original.core, { key: 'mindset', label: 'duplicate', weight: NaN }] };
        expect(validateKpiTemplate(changed)).toEqual(expect.arrayContaining(['INVALID_WEIGHT', 'DUPLICATE_COMPONENT', 'CORE_WEIGHT_NOT_70', 'TOTAL_WEIGHT_NOT_100']));
        expect(validateKpiTemplate(original)).toEqual([]);
        expect(validateKpiTemplate({ ...original, shared: [] })).toEqual(expect.arrayContaining(['SHARED_WEIGHT_NOT_30', 'TOTAL_WEIGHT_NOT_100']));
    });
});
