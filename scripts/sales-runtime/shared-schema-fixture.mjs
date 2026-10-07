// Reviewed structure only: 2026-09-29 live catalog capture; no customer rows.
// Used exclusively inside the verified, disposable native runtime.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

export const reviewedSharedShape = JSON.parse(readFileSync(new URL('./shared-schema-reviewed-shape.json', import.meta.url), 'utf8'));
const tables = ['projects', 'plots', 'leads', 'sales', 'customer_voices'];
const identifier = value => { assert.match(value, /^[a-z][a-z_0-9]*$/); return `"${value}"`; };
const types = new Set(['uuid', 'text', 'character varying', 'timestamp with time zone', 'boolean', 'integer', 'numeric', 'numeric(15,2)', 'numeric(4,2)', 'date', 'jsonb']);
const defaultExpressions = new Set([null, 'gen_random_uuid()', 'now()', "timezone('utc'::text, now())", 'false', '0', '1', "'[]'::jsonb", "''::text", "'โครงการที่ 1'::text", "'active'::character varying", "'NotStarted'::character varying", "'pending'::text", "'Walk-in'::character varying", "'New'::character varying", "'Walk in'::character varying", "'Follow-up — อยู่ระหว่างติดตาม'::character varying", "'Lead เข้า'::character varying", "'Reserved'::character varying", "'Pending'::character varying"]);

export function sharedSchemaFixtureSql() {
    const definitions = tables.map(table => {
        const columns = reviewedSharedShape.columns.filter(column => column.table === table).map(column => {
            assert.ok(types.has(column.type));
            assert.ok(defaultExpressions.has(column.default));
            assert.equal(column.generated, '');
            return `${identifier(column.name)} ${column.type}${column.notnull ? ' NOT NULL' : ''}${column.default === null ? '' : ` DEFAULT ${column.default}`}`;
        });
        const constraints = reviewedSharedShape.constraints.filter(constraint => constraint.table === table).map(constraint => {
            assert.match(constraint.def, /^(PRIMARY KEY \([a-z_]+\)|FOREIGN KEY \([a-z_]+\) REFERENCES [a-z_]+\([a-z_]+\) ON DELETE (CASCADE|SET NULL))$/);
            return `CONSTRAINT ${identifier(constraint.name)} ${constraint.def}`;
        });
        return `CREATE TABLE public.${identifier(table)} (${[...columns, ...constraints].join(',\n')});`;
    });
    return `CREATE TABLE public.house_types(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),type_name text NOT NULL);\n${definitions.join('\n')}
      CREATE FUNCTION public.update_sales_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;
      CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.update_sales_updated_at_column();
      CREATE TRIGGER update_sales_table_updated_at BEFORE UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.update_sales_updated_at_column();
      CREATE TRIGGER update_customer_voices_updated_at BEFORE UPDATE ON public.customer_voices FOR EACH ROW EXECUTE FUNCTION public.update_sales_updated_at_column();
      -- Minimal child fixtures reproduce the observed incoming FK actions, not full department schemas.
      CREATE TABLE public.house_visit_checklists(id integer PRIMARY KEY,lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,note text);
      CREATE TABLE public.plot_promotions(id integer PRIMARY KEY,plot_id text REFERENCES public.plots(id) ON DELETE CASCADE,note text);
      ALTER TABLE public.task_material_requests ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        ADD COLUMN plot_id text REFERENCES public.plots(id) ON DELETE CASCADE, ADD COLUMN note text;
      CREATE VIEW public.synthetic_shared_department_view WITH(security_invoker=true) AS
        SELECT p.id,p.foreman_name,p.is_completed,p.handover_notes,p.sale_status,m.note
        FROM public.plots p LEFT JOIN public.task_material_requests m ON m.plot_id=p.id;`;
}

export const sharedShapeQuery = `SELECT jsonb_build_object('columns',(
    SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
      'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'generated',a.attgenerated) ORDER BY c.relname,a.attnum)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relname IN ('projects','plots','leads','sales','customer_voices') AND a.attnum>0 AND NOT a.attisdropped),
    'constraints',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',x.conname,'kind',x.contype,
       'ref',r.relname,'def',pg_get_constraintdef(x.oid)) ORDER BY c.relname,x.conname)
    FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_class r ON r.oid=x.confrelid
    WHERE n.nspname='public' AND c.relname IN ('projects','plots','leads','sales','customer_voices')));`;

export function assertReviewedSharedShape(actual, { allowCrmAdditions = false } = {}) {
    for (const expected of reviewedSharedShape.columns) {
        assert.deepEqual(actual.columns.find(column => column.table === expected.table && column.name === expected.name), expected,
            `Reviewed legacy column changed: ${expected.table}.${expected.name}`);
    }
    for (const expected of reviewedSharedShape.constraints) {
        assert.deepEqual(actual.constraints.find(constraint => constraint.table === expected.table && constraint.name === expected.name), expected,
            `Reviewed legacy constraint changed: ${expected.name}`);
    }
    if (!allowCrmAdditions) {
        assert.equal(actual.columns.length, reviewedSharedShape.columns.length);
        assert.equal(actual.constraints.length, reviewedSharedShape.constraints.length);
    }
}

export const sharedDepartmentSnapshotQuery = `SELECT jsonb_build_object(
  'checklists',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.house_visit_checklists v),
  'promotions',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.plot_promotions v),
  'materials',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.task_material_requests v),
  'view',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.synthetic_shared_department_view v),
  'viewDefinition',pg_get_viewdef('public.synthetic_shared_department_view'::regclass,true));`;
