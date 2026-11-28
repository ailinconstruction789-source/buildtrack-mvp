import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function verifyPurchaseCancellation({ psql, asUser, quote, jsonLiteral, parseJsonLine, pass, sales, admin, owner, foreman, migration }) {
  await psql('ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS occupation text');
  await psql(migration);
  const call = (user, rpc, id, input) => psql(asUser(user,
    `SELECT public.${rpc}(${quote(id)}, ${jsonLiteral(input)});`));
  const book = parseJsonLine(await call(sales,'sales_tx_book_purchase',randomUUID(), {
    projectName:'ไอลิน 6', plotId:'P-01', customerName:'Fixture Buyer', salePrice:2000000, bookingAmount:5000,
  }));
  const id = randomUUID();
  const payload = parseJsonLine(await psql(`SELECT json_build_object('saleId',s.id,'plotId',s.plot_id,'leadId',s.lead_id,
    'expectedSaleUpdatedAt',s.updated_at,'expectedLeadUpdatedAt',l.updated_at,'category','booking_cancelled','reason','Fixture reason','eventDate','2026-11-28')
    FROM public.sales s JOIN public.leads l ON s.lead_id=l.id WHERE s.id=${quote(book.saleId)};`));
  const cancel = (user, patch={}) => call(user,'sales_tx_cancel_purchase',id,{...payload,...patch});
  for (const user of [owner,foreman]) await assert.rejects(cancel(user),/SALES_TX_FORBIDDEN/);
  await assert.rejects(psql(asUser(sales,`SELECT public.cancel_plot_sale_and_release('P-01',null,'x');`)),/permission denied/);
  await assert.rejects(cancel(sales,{plotId:'P-02'}),/STALE_STATE/);
  await assert.rejects(cancel(sales,{expectedSaleUpdatedAt:null}),/STALE_STATE/);
  await assert.rejects(cancel(sales,{reason:'  '}),/INVALID_INPUT/);
  const holder = randomUUID();
  await psql(`INSERT INTO public.leads(id,customer_name,project_name,status,interested_plot_id)
    VALUES(${quote(holder)},'Existing holder','ไอลิน 6','Booked','P-01');`);
  await assert.rejects(cancel(sales),/NATIVE_SIDEBAR_STOCK_EVIDENCE_REQUIRED|SALES_TX_PLOT_HELD_BY_OTHER/);
  assert.equal(await psql(`SELECT status FROM public.leads WHERE id=${quote(holder)}`),'Booked');
  await psql(`DELETE FROM public.leads WHERE id=${quote(holder)}`);
  await psql("ALTER TABLE public.status_history ADD CONSTRAINT fixture_reject_cancel CHECK(new_status <> 'cancelled')");
  await assert.rejects(cancel(sales),/fixture_reject_cancel/);
  const state = () => psql(`SELECT concat_ws('|',s.contract_status,l.status,p.has_customer,p.sale_status)
      FROM public.sales s JOIN public.leads l ON s.lead_id=l.id JOIN public.plots p ON p.id=s.plot_id WHERE s.id=${quote(book.saleId)};`);
  assert.equal(await state(),'Reserved|Booked|t|reserved');
  await psql('ALTER TABLE public.status_history DROP CONSTRAINT fixture_reject_cancel');
  const receipt = parseJsonLine(await cancel(admin));
  assert.equal(receipt.plotReleased,true);
  assert.equal(receipt.saleId,book.saleId);
  assert.deepEqual(parseJsonLine(await cancel(admin)),receipt);
  await assert.rejects(cancel(admin,{reason:'different'}),/IDEMPOTENCY_CONFLICT/);
  assert.equal(await state(),'Cancelled|Cancelled|f|ready_for_sale');
  assert.equal(await psql("SELECT count(*) FROM public.status_history WHERE new_status='cancelled'"),'2');
  pass('Purchase cancellation permissions, exact identity, rollback, release and replay');
}
