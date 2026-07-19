"use client";

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, Save, AlertCircle, Upload, Download } from 'lucide-react';
import * as XLSX from 'xlsx';

export default function SalesPricing({ project }: { project?: any }) {
  const [plots, setPlots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchPlots();
  }, []);

  const fetchPlots = async () => {
    setLoading(true);
    try {
      // For MVP, filter by project_name
      const projName = project?.name || 'ไอลิน6';
      const { data, error } = await supabase
        .from('plots')
        .select('*, house_types(*)')
        .eq('project_name', projName)
        .order('id', { ascending: true });

      if (error) throw error;

      // Robust numeric sorting for plot ID or plot name
      const sortedPlots = (data || []).sort((a: any, b: any) => {
        const nameA = (a.plot_name || a.id).toString().trim();
        const nameB = (b.plot_name || b.id).toString().trim();
        
        // Extract numbers and non-numbers for comparison
        const regex = /^(\D*)(\d+)(.*)$/;
        const matchA = nameA.match(regex);
        const matchB = nameB.match(regex);
        
        if (matchA && matchB) {
          if (matchA[1] === matchB[1]) {
            const numA = parseInt(matchA[2], 10);
            const numB = parseInt(matchB[2], 10);
            if (numA !== numB) return numA - numB;
          }
        }
        
        // Fallback to strict numeric if it's purely numbers
        if (!isNaN(Number(nameA)) && !isNaN(Number(nameB))) {
          return Number(nameA) - Number(nameB);
        }
        
        return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
      });

      setPlots(sortedPlots);
    } catch (err) {
      console.error("Error fetching plots for pricing:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (plotId: string, field: string, value: string) => {
    setPlots(plots.map(p => {
      if (p.id === plotId) {
        return { ...p, [field]: value };
      }
      return p;
    }));
  };

  const parseMoney = (val: any) => {
    if (val == null || val === '') return 0;
    const numStr = val.toString().replace(/[^0-9.-]+/g,"");
    const num = Number(numStr);
    return isNaN(num) ? 0 : num;
  };

  const saveChanges = async () => {
    setSaving(true);
    setSaveMessage('');
    try {
      // Upsert or update all plots
      // For simplicity in MVP, we loop and update
      for (const p of plots) {
        const { error } = await supabase
          .from('plots')
          .update({
            land_size: parseMoney(p.land_size),
            selling_price: parseMoney(p.selling_price)
          })
          .eq('id', p.id)
          .eq('project_name', p.project_name);
        
        if (error) throw error;
      }
      setSaveMessage('บันทึกข้อมูลราคาและที่ดินเรียบร้อยแล้ว');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (err) {
      console.error("Error saving pricing:", err);
      setSaveMessage('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadTemplate = () => {
    const templateData = plots.map(p => ({
      'Plot': p.plot_name || p.id,
      'Land Size (sq.w)': p.land_size || 0,
      'Selling Price (Baht)': p.selling_price || 0
    }));
    
    const ws = XLSX.utils.json_to_sheet(templateData.length > 0 ? templateData : [
      { 'Plot': 'A01', 'Land Size (sq.w)': 50, 'Selling Price (Baht)': 3500000 }
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pricing Template');
    XLSX.writeFile(wb, 'Pricing_Import_Template.xlsx');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const bstr = event.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);
        
        const newPlots = [...plots];
        let updateCount = 0;
        
        data.forEach((row: any) => {
          const plotId = row['Plot']?.toString()?.trim();
          if (!plotId) return;
          
          const index = newPlots.findIndex(p => p.id === plotId || p.plot_name === plotId);
          if (index !== -1) {
            newPlots[index].land_size = row['Land Size (sq.w)'] || newPlots[index].land_size;
            newPlots[index].selling_price = row['Selling Price (Baht)'] || newPlots[index].selling_price;
            updateCount++;
          }
        });
        
        setPlots(newPlots);
        setSaveMessage(`อัปเดตข้อมูล ${updateCount} รายการ (โปรดกดบันทึก)`);
      } catch (err) {
        console.error("Error importing pricing data:", err);
        setSaveMessage('ข้อผิดพลาด: ไฟล์ไม่ถูกต้อง');
      } finally {
        setIsImporting(false);
      }
    };
    reader.readAsBinaryString(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-full text-slate-500">
        <Loader2 size={32} className="animate-spin mb-4" />
        <p>กำลังดึงข้อมูลแปลง...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col h-full overflow-hidden animate-in fade-in duration-300 mx-8 mb-6">
      <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
        <div>
          <h2 className="text-xl font-bold text-slate-800">จัดการข้อมูลราคาและที่ดิน (Pricing)</h2>
          <p className="text-sm text-slate-500 mt-1">กำหนดขนาดที่ดินและราคาขายตั้งต้นสำหรับใช้ในระบบขาย</p>
        </div>
        <div className="flex items-center gap-4">
          {saveMessage && (
            <span className={`text-sm font-bold flex items-center gap-1.5 ${saveMessage.includes('ผิดพลาด') ? 'text-red-500' : (saveMessage.includes('โปรดกดบันทึก') ? 'text-blue-500' : 'text-emerald-600')}`}>
              <CheckIcon isError={saveMessage.includes('ผิดพลาด')} />
              {saveMessage}
            </span>
          )}
          
          <input 
            type="file" 
            accept=".xlsx, .xls" 
            className="hidden" 
            ref={fileInputRef}
            onChange={handleFileUpload}
          />
          <button 
            onClick={handleDownloadTemplate}
            className="bg-white border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-bold shadow-sm hover:bg-gray-50 transition-colors flex items-center gap-2"
          >
            <Download size={16} />
            โหลดเทมเพลต
          </button>
          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="bg-white border border-blue-200 text-blue-700 px-4 py-2.5 rounded-xl text-sm font-bold shadow-sm hover:bg-blue-50 transition-colors flex items-center gap-2"
          >
            {isImporting ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            นำเข้าข้อมูล
          </button>

          <button 
            onClick={saveChanges}
            disabled={saving}
            className="bg-[#0f172a] hover:bg-[#1e293b] disabled:bg-slate-400 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-sm transition-colors flex items-center gap-2"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? 'กำลังบันทึก...' : 'บันทึกทั้งหมด'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
              <tr>
                <th className="py-3 px-4">เลขแปลง</th>
                <th className="py-3 px-4">แบบบ้าน</th>
                <th className="py-3 px-4">ขนาดที่ดิน (ตร.ว.)</th>
                <th className="py-3 px-4">ราคาขาย (บาท)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {plots.map((plot) => (
                <tr key={plot.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="py-3 px-4 font-bold text-slate-800 w-24">แปลง {plot.plot_name || plot.id}</td>
                  <td className="py-3 px-4 text-slate-600 font-medium">
                    {plot.house_types?.type_name || plot.house_model || '-'}
                  </td>
                  <td className="py-3 px-4">
                    <input 
                      type="number" 
                      step="0.1"
                      value={plot.land_size || ''} 
                      onChange={e => handleInputChange(plot.id, 'land_size', e.target.value)}
                      placeholder="0.0"
                      className="w-full border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </td>
                  <td className="py-3 px-4">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">฿</span>
                      <input 
                        type="number" 
                        value={plot.selling_price || ''} 
                        onChange={e => handleInputChange(plot.id, 'selling_price', e.target.value)}
                        placeholder="0"
                        className="w-full border border-slate-200 rounded-lg pl-7 pr-3 py-1.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-semibold text-emerald-700"
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CheckIcon({ isError }: { isError: boolean }) {
  if (isError) return <AlertCircle size={16} />;
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  );
}
