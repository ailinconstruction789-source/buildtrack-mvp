// Actual deployed construction functions, triggers and schema metadata; synthetic rows only.
// Called only after the manager has initialized and verified a fresh owned cluster.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPlainSql } from './safety.mjs';

const ident = value => '"' + value.replaceAll('"', '""') + '"';
const lit = value => "'" + value.replaceAll("'", "''") + "'";
const qualified = (schema, name) => ident(schema) + '.' + ident(name);
const encodeBody = definition => definition.replace(/\$function\$([\s\S]*?)\$function\$/, (_match, body) =>
  "E'" + body.replaceAll('\\', '\\\\').replaceAll("'", "''").replaceAll('\r', '\\r').replaceAll('\n', '\\n') + "'");

export async function runConstructionIntegration({ query, root, applyDraft }) {
  if (typeof query !== 'function' || typeof applyDraft !== 'function') throw Error('Verified manager callbacks required');
  const fixture = JSON.parse(readFileSync(join(root, 'reports/anonymous-construction-integration-fixture-2026-10-08.json'), 'utf8'));
  const deferredForeignKeys = [];
  let assertions = 0;
  const equal = (actual, expected, label) => {
    if (actual !== expected) throw Error(label + ': ' + actual + ' != ' + expected);
    assertions++;
  };
  const execute = async sql => { assertPlainSql(sql); return query(sql); };
  const reject = async (sql, pattern, label) => {
    try { await execute(sql); } catch (error) {
      if (!pattern.test(error.message)) throw Error(label + ': ' + error.message);
      assertions++; return;
    }
    throw Error(label + ': accepted');
  };
  await execute(`DO $$ BEGIN
    IF current_database() !~ '^buildtrack_sales_runtime_[a-f0-9]+$'
      OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1'
      OR current_setting('buildtrack.synthetic_runtime',true) IS DISTINCT FROM 'on'
      OR to_regclass('public.task_updates') IS NULL OR to_regprocedure('auth.uid()') IS NULL
      OR to_regprocedure('auth.jwt()') IS NULL THEN RAISE EXCEPTION 'OWNED_INTEGRATION_BASE_REQUIRED'; END IF;
    END $$;
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
    CREATE SCHEMA IF NOT EXISTS crm_external_private AUTHORIZATION postgres;`);

  // No extra privileges to authenticated/anon on private tables or their schema.
  for (const relation of fixture.relations) {
    const target = qualified(relation.schema, relation.name);
    if (await execute(`SELECT to_regclass(${lit(target)}) IS NOT NULL;`) === 't') continue;
    const columns = fixture.columns.filter(c => c.schema === relation.schema && c.table === relation.name);
    await execute(`CREATE TABLE ${target} (${columns.map(c => ident(c.column) + ' ' + c.type).join(',')});
      ALTER TABLE ${target} OWNER TO ${ident(relation.owner)};
      ALTER TABLE ${target} ${relation.rls ? 'ENABLE' : 'DISABLE'} ROW LEVEL SECURITY;
      ALTER TABLE ${target} ${relation.forceRls ? 'FORCE' : 'NO FORCE'} ROW LEVEL SECURITY;`);
    if (relation.schema === 'public') {
      if (relation.name !== 'house_types' || relation.acl !== '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}') throw Error('Unreviewed dependency ACL');
      await execute(`GRANT ALL ON TABLE ${target} TO anon,authenticated,service_role;`);
    } else if (relation.acl !== null) throw Error('Unreviewed private table ACL');
  }
  const columnChanges = [];
  for (const column of fixture.columns) {
    if (column.generated) throw Error('Generated column requires separate reviewed replay');
    const target = qualified(column.schema, column.table), name = ident(column.column);
    if (column.identity) {
      const sequence = fixture.sequences.find(s => s.schema === column.schema && s.name === column.table + '_' + column.column + '_seq');
      if (!sequence) throw Error('Missing identity sequence metadata');
      const present = await execute(`SELECT attidentity FROM pg_attribute WHERE attrelid=${lit(target)}::regclass AND attname=${lit(column.column)};`);
      if (!present) await execute(`ALTER TABLE ${target} ALTER COLUMN ${name} DROP DEFAULT;
        ALTER TABLE ${target} ALTER COLUMN ${name} ADD GENERATED ${column.identity === 'a' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY
        (SEQUENCE NAME ${qualified(sequence.schema, sequence.name)} START WITH ${sequence.start} INCREMENT BY ${sequence.increment}
        MINVALUE ${sequence.min} MAXVALUE ${sequence.max} CACHE ${sequence.cache} ${sequence.cycle ? 'CYCLE' : 'NO CYCLE'});`);
      for (const role of ['anon', 'authenticated', 'service_role']) {
        if (!sequence.acl?.includes(role + '=rwU/')) throw Error('Unreviewed identity ACL');
        await execute(`GRANT SELECT,UPDATE,USAGE ON SEQUENCE ${qualified(sequence.schema, sequence.name)} TO ${ident(role)};`);
      }
    } else {
      columnChanges.push(`ALTER TABLE ${target} ALTER COLUMN ${name} ${column.default === null ? 'DROP DEFAULT' : 'SET DEFAULT ' + column.default};`);
    }
    columnChanges.push(`ALTER TABLE ${target} ALTER COLUMN ${name} ${column.notNull ? 'SET' : 'DROP'} NOT NULL;`);
  }
  await execute(columnChanges.join('\n'));
  // Add keys/checks first, then actual foreign keys whose referenced tables exist.
  for (const constraint of [...fixture.constraints.filter(c => c.type !== 'f'), ...fixture.constraints.filter(c => c.type === 'f')]) {
    const target = qualified(constraint.schema, constraint.table);
    if (constraint.type === 'f' && await execute(`SELECT to_regclass(${lit(qualified(constraint.referencedSchema, constraint.referencedTable))}) IS NOT NULL;`) !== 't') {
      deferredForeignKeys.push({ table: constraint.schema + '.' + constraint.table, name: constraint.name,
        reference: constraint.referencedSchema + '.' + constraint.referencedTable, definition: constraint.definition });
      continue;
    }
    const existing = await execute(`SELECT coalesce((SELECT pg_get_constraintdef(oid,true) FROM pg_constraint
      WHERE conrelid=${lit(target)}::regclass AND conname=${lit(constraint.name)}),'');`);
    if (existing) equal(existing, constraint.definition, 'existing constraint ' + constraint.name);
    else await execute(`ALTER TABLE ${target} ADD CONSTRAINT ${ident(constraint.name)} ${constraint.definition};`);
  }
  for (const fn of fixture.functions) {
    const definition = encodeBody(fn.definition); assertPlainSql(definition);
    await execute(definition + `; ALTER FUNCTION ${fn.signature} OWNER TO ${ident(fn.owner)};`);
    if (fn.acl === null) {
      // Default function ACL is owner EXECUTE + PUBLIC EXECUTE.
      await execute(`GRANT EXECUTE ON FUNCTION ${fn.signature} TO PUBLIC;`);
    } else if (fn.schema === 'crm_external_private') {
      if (!/^\{postgres=X\/postgres\}$/.test(fn.acl)) throw Error('Unreviewed private function ACL');
      await execute(`REVOKE ALL ON FUNCTION ${fn.signature} FROM PUBLIC,anon,authenticated,service_role;`);
    } else {
      if (fn.acl !== '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}') throw Error('Unreviewed public trigger function ACL');
      await execute(`GRANT EXECUTE ON FUNCTION ${fn.signature} TO PUBLIC,anon,authenticated,service_role;`);
    }
    equal(await execute(`SELECT md5(pg_get_functiondef(${lit(fn.signature)}::regprocedure));`), fn.definitionHash, 'actual trigger function ' + fn.name);
  }
  for (const trigger of fixture.triggerDefinitions) {
    await execute(trigger.definition + ';');
  }

  const house = 'c0261008-0000-4000-8000-000000000101';
  const taskA = 'd0261008-0000-4000-8000-000000000101', taskB = 'd0261008-0000-4000-8000-000000000102';
  const taskN = 'd0261008-0000-4000-8000-000000000103';
  const batch = 'b0261008-0000-4000-8000-000000000101';
  const actorUid = 'a0261008-0000-4000-8000-000000000101';
  const update1 = 'e0261008-0000-4000-8000-000000000101', update2 = 'e0261008-0000-4000-8000-000000000102';
  const project = 'construction-integration-project';
  const plots = ['construction-free', 'construction-occupied', 'construction-transferred'];
  await execute(`INSERT INTO public.house_types(id,type_name) VALUES(${lit(house)},'construction-integration-house');
    INSERT INTO public.projects(name) VALUES(${lit(project)});
    INSERT INTO public.task_templates(id,house_type_id,task_name,task_order,is_progress_counted) VALUES
      (${lit(taskA)},${lit(house)},'counted-a',1,true),(${lit(taskB)},${lit(house)},'counted-b',2,true),(${lit(taskN)},${lit(house)},'not-counted',3,false);
    ${plots.map(plot => `INSERT INTO public.plots(id,project_name,house_type_id,foreman_name,has_customer,sale_status)
      VALUES(${lit(plot)},${lit(project)},${lit(house)},'synthetic-foreman',${plot === 'construction-occupied'},${lit(plot === 'construction-transferred' ? 'transferred' : 'active')});`).join('\n')}
    ${plots.map(plot => `INSERT INTO public.plot_task_assignments(plot_id,task_template_id,current_progress)
      VALUES(${lit(plot)},${lit(taskA)},0),(${lit(plot)},${lit(taskB)},0);`).join('\n')}
    INSERT INTO public.defects(plot_id,task_id,description) VALUES('construction-free',${lit(taskA)},'synthetic-task-id-defect');
    INSERT INTO public.defects(plot_id,task_template_id,description) VALUES('construction-free',${lit(taskA)},'synthetic-template-id-defect'),('construction-free',${lit(taskB)},'synthetic-other-task-defect');
    INSERT INTO crm_external_private.snapshot_batches(id,feed,source_sha256,plan_digest,payload)
      VALUES(${lit(batch)},'customer-sheet',repeat('0',64),repeat('1',64),'{}');
    INSERT INTO crm_external_private.bridge_receipts(batch_id,request,response) VALUES(${lit(batch)},'{}','{}');
    INSERT INTO crm_external_private.booking_release_receipts(batch_id,request,legacy_snapshot,response) VALUES(${lit(batch)},'{}','{}','{}');
    INSERT INTO crm_external_private.sales_cutover_receipts(batch_id,request,before_sales,after_sales,before_plot_flags,after_plot_flags,dependency_image,response)
      VALUES(${lit(batch)},'{}','[]','[]','[]','[]','{}','{}');
    INSERT INTO crm_external_private.booking_writer_releases(batch_id,plan_digest,review_reference)
      VALUES(${lit(batch)},repeat('1',64),'synthetic integration release');`);
  equal(await execute('SELECT count(*) FROM crm_external_private.booking_writer_releases;'), '1', 'stock guard is activated');

  const roles = ['Admin', 'Owner', 'Project Planner', 'Site Engineer', 'Foreman', 'QC', 'Procurement'];
  const asActor = (businessRole, sql, databaseRole = 'authenticated') => {
    const claims = { sub: actorUid, role: databaseRole, user_metadata: { role: businessRole } };
    return `BEGIN; SET LOCAL ROLE ${ident(databaseRole)};
      SET LOCAL request.jwt.claims=${lit(JSON.stringify(claims))};
      SET LOCAL request.jwt.claim.sub=${lit(actorUid)};
      SET LOCAL request.jwt.claim.role=${lit(databaseRole)};
      ${sql} ROLLBACK;`;
  };
  const insertUpdate = (plot, task, progress, id, stamp, businessRole) => `INSERT INTO public.task_updates(id,plot_id,task_template_id,user_name,role,action,progress,created_at)
    VALUES(${lit(id)},${lit(plot)},${lit(task)},'synthetic-construction-actor',${lit(businessRole)},${lit('integration ' + progress)},${progress},${lit(stamp)});`;
  const snapshot = plot => `SELECT jsonb_build_object('assignment',(SELECT jsonb_agg(jsonb_build_array(task_template_id,current_progress,actual_start_date,actual_end_date,latest_action,latest_role,latest_update_created_at) ORDER BY task_template_id)
    FROM public.plot_task_assignments WHERE plot_id=${lit(plot)}),'plot',(SELECT jsonb_build_array(sale_status,has_customer) FROM public.plots WHERE id=${lit(plot)}),
    'defects',(SELECT coalesce(jsonb_agg(jsonb_build_array(description,progress) ORDER BY description),'[]') FROM public.defects WHERE plot_id=${lit(plot)}));`;
  const t1 = '2026-10-01T00:00:00Z', t2 = '2026-10-02T00:00:00Z', t3 = '2026-10-03T00:00:00Z';
  const exercise = async (businessRole, databaseRole = 'authenticated') => {
    const states = {};
    states.start = await execute(asActor(businessRole, insertUpdate('construction-free',taskA,40,update1,t1,businessRole) + snapshot('construction-free'), databaseRole));
    const start = JSON.parse(states.start);
    equal(start.assignment[0][1],40,'partial assignment ' + businessRole);
    equal(start.assignment[0][3],null,'partial has no end ' + businessRole);
    equal(start.plot[0],'active','partial stock state ' + businessRole);
    equal(start.defects.filter(d => d[0] !== 'synthetic-other-task-defect').every(d => d[1] === 40),true,'both defect task links ' + businessRole);
    equal(start.defects.find(d => d[0] === 'synthetic-other-task-defect')[1],0,'other task defect unchanged ' + businessRole);
    states.halfComplete = await execute(asActor(businessRole,
      insertUpdate('construction-free',taskA,100,update1,t1,businessRole) + snapshot('construction-free'), databaseRole));
    equal(JSON.parse(states.halfComplete).plot[0],'active','one counted task cannot advance stock ' + businessRole);
    states.complete = await execute(asActor(businessRole,
      insertUpdate('construction-free',taskA,40,update1,t1,businessRole) + insertUpdate('construction-free',taskA,100,update2,t2,businessRole) +
      insertUpdate('construction-free',taskB,100,'e0261008-0000-4000-8000-000000000103',t3,businessRole) + snapshot('construction-free'), databaseRole));
    const complete = JSON.parse(states.complete);
    equal(complete.assignment.every(a => a[1] === 100 && a[2] !== null && a[3] !== null),true,'both counted tasks complete ' + businessRole);
    equal(complete.plot[0],'ready_for_sale','construction advances free stock ' + businessRole);
    equal(complete.defects.every(d => d[1] === 100),true,'defects synchronized completion ' + businessRole);
    // Out-of-order historical insert must not override the latest progress/action.
    states.outOfOrder = await execute(asActor(businessRole,
      insertUpdate('construction-free',taskA,100,update1,t2,businessRole) + insertUpdate('construction-free',taskA,20,update2,t1,businessRole) + snapshot('construction-free'), databaseRole));
    equal(JSON.parse(states.outOfOrder).assignment[0][1],100,'latest event wins ' + businessRole);
    states.reopen = await execute(asActor(businessRole,
      insertUpdate('construction-free',taskA,100,update1,t1,businessRole) + `UPDATE public.task_updates SET progress=25,action='integration reopened',created_at=${lit(t2)} WHERE id=${lit(update1)};` + snapshot('construction-free'), databaseRole));
    const reopen = JSON.parse(states.reopen);
    equal(reopen.assignment[0][1],25,'update recomputes progress ' + businessRole);
    equal(reopen.assignment[0][3],null,'reopen clears end ' + businessRole);
    states.delete = await execute(asActor(businessRole,
      insertUpdate('construction-free',taskA,100,update1,t1,businessRole) + `DELETE FROM public.task_updates WHERE id=${lit(update1)};` + snapshot('construction-free'), databaseRole));
    equal(JSON.parse(states.delete).assignment[0][1],0,'delete recomputes zero ' + businessRole);
    equal(JSON.parse(states.delete).assignment[0][2],null,'delete clears start ' + businessRole);
    states.completionUndone = await execute(asActor(businessRole,
      insertUpdate('construction-free',taskA,100,update1,t1,businessRole) + insertUpdate('construction-free',taskB,100,update2,t2,businessRole) +
      `DELETE FROM public.task_updates WHERE id=${lit(update2)};` + snapshot('construction-free'), databaseRole));
    equal(JSON.parse(states.completionUndone).assignment[1][1],0,'undo completion recomputes assignment ' + businessRole);
    // Capture the deployed function's one-way stock transition without claiming it is the desired business rule.
    equal(JSON.parse(states.completionUndone).plot[0],'ready_for_sale','existing one-way stock transition ' + businessRole);
    for (const plot of ['construction-occupied','construction-transferred']) {
      states[plot] = await execute(asActor(businessRole,insertUpdate(plot,taskA,100,update1,t1,businessRole) + insertUpdate(plot,taskB,100,update2,t2,businessRole) + snapshot(plot), databaseRole));
      equal(JSON.parse(states[plot]).plot[0],plot === 'construction-occupied' ? 'active' : 'transferred','construction never confirms transfer ' + businessRole + plot);
    }
    states.upsert = await execute(asActor(businessRole,`DELETE FROM public.plot_task_assignments WHERE plot_id='construction-free' AND task_template_id=${lit(taskA)};` +
      insertUpdate('construction-free',taskA,10,update1,t1,businessRole) + `SELECT count(*) FROM public.plot_task_assignments WHERE plot_id='construction-free' AND task_template_id=${lit(taskA)};`, databaseRole));
    equal(states.upsert,'1','identity/unique insertion path ' + businessRole);
    await reject(asActor(businessRole,`UPDATE public.plots SET has_customer=true WHERE id='construction-free';`,databaseRole), /EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED/, 'guard rejects occupancy spoof ' + businessRole);
    await reject(asActor(businessRole,`UPDATE public.plots SET sale_status='transferred' WHERE id='construction-free';`,databaseRole), /EXTERNAL_WRITER_STOCK_COMMAND_REQUIRED/, 'guard rejects transfer spoof ' + businessRole);
    return states;
  };
  const before = {};
  for (const role of roles) before[role] = await exercise(role);
  before.service_role = await exercise('Admin','service_role');
  await applyDraft();
  for (const role of roles) equal(JSON.stringify(await exercise(role)),JSON.stringify(before[role]),'full trigger state parity ' + role);
  equal(JSON.stringify(await exercise('Admin','service_role')),JSON.stringify(before.service_role),'full trigger state parity service_role');
  for (const operation of [
    insertUpdate('construction-free',taskA,100,update1,t1,'Foreman'),
    `UPDATE public.plot_task_assignments SET current_progress=100 WHERE plot_id='construction-free';`,
    `UPDATE public.defects SET progress=100 WHERE plot_id='construction-free';`,
    `UPDATE public.plots SET sale_status='ready_for_sale' WHERE id='construction-free';`,
  ]) await reject(asActor('Foreman',operation,'anon'),/permission denied for table/,'anonymous construction writes blocked');
  for (const fn of fixture.functions) equal(await execute(`SELECT md5(pg_get_functiondef(${lit(fn.signature)}::regprocedure));`),fn.definitionHash,'trigger body preserved after ACL ' + fn.name);
  return { assertions, functions: fixture.functions.map(f => ({ signature:f.signature,definitionHash:f.definitionHash })),
    businessRoles:roles, protectedDatabaseRoles:['authenticated','service_role'], triggerCount:fixture.triggerDefinitions.length,
    activatedStockGuard:true, stateParity:true, anonymousWritesBlocked:true, deferredForeignKeys,
    preservedExistingBehavior:['Undoing a previously completed counted task resets assignment/defect progress, but the deployed stock trigger leaves ready_for_sale unchanged. This is existing behavior, not introduced by ACL changes.'],
    limitations:fixture.evidenceLimits };
}
