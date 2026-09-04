import os

file_path = r'd:\buildtrack\buildtrack-mvp-main\app\page.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

functions = """
  const updateInspectionRound = async (plotId: string, newRound: number) => {
    try {
      const { error } = await supabase.from('plots').update({ inspection_round: newRound }).eq('id', plotId);
      if (error) throw error;
      setPlots(plots.map(p => p.id === plotId ? { ...p, inspection_round: newRound } : p));
      return true;
    } catch (e: any) {
      showToast('Error updating inspection round: ' + e.message, 'error');
      return false;
    }
  };

  const resetHandoverCycle = async (plotId: string, currentCycle: number) => {
    try {
      const { error } = await supabase.from('plots').update({ handover_cycle: (currentCycle || 1) + 1, inspection_round: 1 }).eq('id', plotId);
      if (error) throw error;
      setPlots(plots.map(p => p.id === plotId ? { ...p, handover_cycle: (currentCycle || 1) + 1, inspection_round: 1 } : p));
      showToast('เริ่มรอบการขายใหม่ (Cycleใหม่) เรียบร้อยแล้ว', 'success');
      return true;
    } catch (e: any) {
      showToast('Error resetting handover cycle: ' + e.message, 'error');
      return false;
    }
  };
"""

for i, line in enumerate(lines):
    if "const checkMobile = () => setIsRealMobile(window.innerWidth < 768);" in line:
        insert_idx = i - 1
        break

lines.insert(insert_idx, functions)

for i, line in enumerate(lines):
    if '<HouseDetailView' in line:
        lines[i] = line.replace('<HouseDetailView', '<HouseDetailView updateInspectionRound={updateInspectionRound} resetHandoverCycle={resetHandoverCycle}')

with open(file_path, 'w', encoding='utf-8') as f:
    f.writelines(lines)
print('Functions added to page.tsx')
