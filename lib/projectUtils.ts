/**
 * Project Utilities & Settings Helper
 *
 * Supports designating projects as "External / Custom-built sites" (งานนอกโครงการ / บ้านสั่งสร้างพิเศษ)
 * so they are excluded from company-wide commercial dashboard summaries while preserving
 * all operational, inspection, and foreman features.
 */

/**
 * Checks whether a project or project name represents an external/custom-built site.
 */
export function isExternalProject(project: any | string | null | undefined): boolean {
  if (!project) return false;

  // Handle string project name
  if (typeof project === 'string') {
    const clean = project.trim();
    if (clean === 'บ้านคุณโอ') return true;
    return false;
  }

  // Handle object: direct is_external property
  if (project.is_external !== undefined && project.is_external !== null) {
    return Boolean(project.is_external);
  }

  // Handle object: configuration stored in layout_data
  if (Array.isArray(project.layout_data)) {
    const conf = project.layout_data.find((c: any) => c?.type === 'config');
    if (conf && conf.is_external !== undefined && conf.is_external !== null) {
      return Boolean(conf.is_external);
    }
  }

  // Known built-in external jobs fallback
  const pName = String(project.name || '').trim();
  if (pName === 'บ้านคุณโอ') {
    return true;
  }

  return false;
}

/**
 * Updates project external status in Supabase with resilient fallback.
 * First attempts to update `is_external` column directly; if the column does not exist
 * in the schema cache, falls back to storing the flag in `layout_data` config.
 */
export async function updateProjectExternalStatus(
  supabaseClient: any,
  projectName: string,
  isExternal: boolean,
  existingLayoutData?: any[]
): Promise<{ success: boolean; error?: string }> {
  if (!supabaseClient || !projectName) {
    return { success: false, error: 'Invalid parameters' };
  }

  const cleanName = projectName.trim();

  try {
    // 1. Attempt to update is_external column directly
    const { error: colError } = await supabaseClient
      .from('projects')
      .update({ is_external: isExternal })
      .eq('name', cleanName);

    if (!colError) {
      return { success: true };
    }

    // 2. Fallback to layout_data config if column not present in schema
    const isColMissing =
      colError.message?.includes('is_external') ||
      colError.code === '42703' ||
      colError.message?.includes('schema cache');

    if (isColMissing) {
      let layout = Array.isArray(existingLayoutData) ? [...existingLayoutData] : [];
      if (layout.length === 0) {
        const { data: proj } = await supabaseClient
          .from('projects')
          .select('layout_data')
          .eq('name', cleanName)
          .maybeSingle();
        layout = Array.isArray(proj?.layout_data) ? [...proj.layout_data] : [];
      }

      const confIdx = layout.findIndex((c: any) => c?.type === 'config');
      if (confIdx >= 0) {
        layout[confIdx] = { ...layout[confIdx], is_external: isExternal };
      } else {
        layout.push({ id: 'GRID_CONFIG', cols: 40, rows: 24, type: 'config', is_external: isExternal });
      }

      const { error: layoutError } = await supabaseClient
        .from('projects')
        .update({ layout_data: layout })
        .eq('name', cleanName);

      if (layoutError) {
        return { success: false, error: layoutError.message };
      }
      return { success: true };
    }

    return { success: false, error: colError.message };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Creates a new project with optional external project settings.
 */
export async function createProjectWithSettings(
  supabaseClient: any,
  projectName: string,
  isExternal: boolean = false
): Promise<{ success: boolean; error?: string }> {
  if (!supabaseClient || !projectName?.trim()) {
    return { success: false, error: 'กรุณาระบุชื่อโครงการก่อนบันทึก' };
  }

  const cleanName = projectName.trim();

  try {
    const payload: any = {
      name: cleanName,
      is_external: isExternal,
    };
    if (isExternal) {
      payload.layout_data = [{ id: 'GRID_CONFIG', cols: 40, rows: 24, type: 'config', is_external: true }];
    }

    const { error } = await supabaseClient.from('projects').insert([payload]);
    if (error) {
      // Fallback if is_external column does not exist
      if (error.message?.includes('is_external') || error.code === '42703') {
        const fallbackPayload: any = {
          name: cleanName,
          layout_data: [{ id: 'GRID_CONFIG', cols: 40, rows: 24, type: 'config', is_external: isExternal }],
        };
        const { error: fbErr } = await supabaseClient.from('projects').insert([fallbackPayload]);
        if (fbErr) return { success: false, error: fbErr.message };
        return { success: true };
      }
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}
