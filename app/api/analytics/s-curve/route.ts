import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: "Missing Supabase credentials" }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Try fetching from the new optimized SQL View first
    const { data: viewData, error: viewError } = await supabase.from('vw_scurve_metrics').select('*');

    if (!viewError && viewData && viewData.length > 0) {
      return NextResponse.json({ source: 'sql_view', data: viewData });
    }

    // Fallback: Calculate on the server (Node.js) if SQL View doesn't exist yet
    // This removes the calculation burden from the user's browser
    const { data: templates } = await supabase.from('task_templates').select('id, cost');
    const { data: schedules } = await supabase.from('plot_task_schedules').select('task_template_id, planned_start');
    const { data: assignments } = await supabase.from('plot_task_assignments').select('task_template_id, actual_end_date, current_progress');

    const templateCost = (templates || []).reduce((acc: any, t: any) => {
      acc[t.id] = t.cost || 0;
      return acc;
    }, {});

    const monthlyData: any = {};

    // Calculate Planned Value
    (schedules || []).forEach((s: any) => {
      if (s.planned_start) {
        const month = s.planned_start.substring(0, 7);
        if (!monthlyData[month]) monthlyData[month] = { month, planned_value: 0, earned_value: 0 };
        monthlyData[month].planned_value += templateCost[s.task_template_id] || 0;
      }
    });

    // Calculate Earned Value
    (assignments || []).forEach((a: any) => {
      if (a.actual_end_date && a.current_progress === 100) {
        const month = a.actual_end_date.substring(0, 7);
        if (!monthlyData[month]) monthlyData[month] = { month, planned_value: 0, earned_value: 0 };
        monthlyData[month].earned_value += templateCost[a.task_template_id] || 0;
      }
    });

    const sortedMonths = Object.keys(monthlyData).sort();
    let cumulative_planned = 0;
    let cumulative_earned = 0;

    const finalData = sortedMonths.map(month => {
      cumulative_planned += monthlyData[month].planned_value;
      cumulative_earned += monthlyData[month].earned_value;
      return {
        month,
        planned_value: monthlyData[month].planned_value,
        earned_value: monthlyData[month].earned_value,
        cumulative_planned_value: cumulative_planned,
        cumulative_earned_value: cumulative_earned
      };
    });

    return NextResponse.json({ source: 'node_fallback', data: finalData });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
