// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { reviewedSharedShape, sharedSchemaFixtureSql, assertReviewedSharedShape } from './shared-schema-fixture.mjs';

describe('reviewed shared schema synthetic fixture', () => {
    it('renders all observed legacy columns before the foundation install', () => {
        const sql = sharedSchemaFixtureSql();
        expect(reviewedSharedShape.columns).toHaveLength(130);
        expect(reviewedSharedShape.constraints).toHaveLength(10);
        expect(reviewedSharedShape.columns.filter(column => column.table === 'sales')).toHaveLength(14);
        expect(sql).toContain('"sale_price" numeric(15,2) DEFAULT 0');
        expect(sql).toContain('"foreman_name" text NOT NULL');
        expect(sql).toContain('"customer_name" character varying NOT NULL');
        expect(sql).toContain('FOREIGN KEY (plot_id) REFERENCES plots(id) ON DELETE SET NULL');
        expect(sql).toContain('FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE');
        expect(sql).toContain('update_sales_table_updated_at BEFORE UPDATE');
    });
    it('accepts only unchanged original shape with additional CRM objects explicitly allowed', () => {
        const actual = structuredClone(reviewedSharedShape);
        actual.columns.push({ table: 'sales', name: 'project_interest_id', type: 'uuid', default: null, generated: '', notnull: false });
        expect(() => assertReviewedSharedShape(actual)).toThrow();
        expect(() => assertReviewedSharedShape(actual, { allowCrmAdditions: true })).not.toThrow();
    });
    it.each(['type', 'default', 'notnull'])('rejects legacy column %s drift even when new CRM additions allowed', field => {
        const actual = structuredClone(reviewedSharedShape);
        actual.columns.find(column => column.table === 'sales' && column.name === 'sale_price')[field] = 'changed';
        expect(() => assertReviewedSharedShape(actual, { allowCrmAdditions: true })).toThrow(/Reviewed legacy column changed/);
    });
    it('rejects missing or weakened original FK', () => {
        const actual = structuredClone(reviewedSharedShape);
        actual.constraints.find(constraint => constraint.name === 'sales_lead_id_fkey').def = 'FOREIGN KEY (lead_id) REFERENCES leads(id)';
        expect(() => assertReviewedSharedShape(actual, { allowCrmAdditions: true })).toThrow(/Reviewed legacy constraint changed/);
    });
});
