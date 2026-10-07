import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf-8');
let url = '', key = '';
env.split('\n').forEach(l => {
  if (l.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) url = l.split('=')[1].trim();
  if (l.startsWith('NEXT_PUBLIC_SUPABASE_ANON_KEY=')) key = l.split('=')[1].trim();
});
const supabase = createClient(url, key);

async function run() {
  const { data: plots } = await supabase.from('plots').select('id, plot_name, project_name, sale_status, highlight_note, has_customer');
  const { data: sales } = await supabase.from('sales').select('plot_id, contract_status');
  const occupiedSales = new Set((sales || []).filter(s => s.contract_status && s.contract_status.toLowerCase() !== 'cancelled').map(s => s.plot_id));

  const invalid = [];
  const valid = [];
  plots.forEach(p => {
    const isOccupied = p.has_customer === true || 
      ['transferred', 'sold', 'reserved', 'booked', 'contracted', 'downpayment', 'loan_processing', 'loan_approved', 'document_prep', 'handover'].includes((p.sale_status || '').toLowerCase()) ||
      occupiedSales.has(p.id);
    if (p.highlight_note === 'sample_house' || p.sale_status === 'sample_house') {
      if (isOccupied) {
        invalid.push(p);
      } else {
        valid.push(p);
      }
    }
  });

  console.log('Valid sample houses:', valid.map(p => `${p.project_name}: ${p.plot_name} (${p.id})`));
  console.log('Invalid sample houses (occupied/transferred/booked):', invalid.map(p => `${p.project_name}: ${p.plot_name} (${p.id}) [status=${p.sale_status}, has_customer=${p.has_customer}]`));

  // Reset highlight_note for invalid occupied plots
  for (const p of invalid) {
    console.log('Clearing sample_house flag for occupied plot:', p.id);
    const updatePayload = { highlight_note: null };
    if (p.sale_status === 'sample_house') {
      updatePayload.sale_status = p.has_customer ? 'transferred' : 'active';
    }
    await supabase.from('plots').update(updatePayload).eq('id', p.id);
  }

  // Find strictly available plots in each project to assign sample houses
  const byProj = {};
  plots.forEach(p => {
    byProj[p.project_name] = byProj[p.project_name] || [];
    byProj[p.project_name].push(p);
  });

  for (const proj in byProj) {
    const list = byProj[proj];
    const strictlyAvailable = list.filter(p => 
      p.has_customer !== true && 
      (!p.sale_status || ['active', 'normal', 'ready_for_sale', 'available', 'vacant', 'sample_house', ''].includes(p.sale_status.toLowerCase())) &&
      !occupiedSales.has(p.id)
    );
    const currentSample = strictlyAvailable.filter(p => p.highlight_note === 'sample_house');
    console.log(`Project "${proj}": strictly available count=${strictlyAvailable.length}, current valid sample houses=${currentSample.length}`);
    if (currentSample.length < 2 && strictlyAvailable.length >= 2) {
      const needed = 2 - currentSample.length;
      const candidates = strictlyAvailable.filter(p => p.highlight_note !== 'sample_house').slice(0, needed);
      for (const c of candidates) {
        console.log(`Setting available plot as sample house for ${proj}:`, c.plot_name || c.id);
        await supabase.from('plots').update({ highlight_note: 'sample_house' }).eq('id', c.id);
      }
    }
  }
}
run();
