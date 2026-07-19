import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Camera, XCircle, Loader2, Send } from 'lucide-react';

interface ReceiptUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newReceipt: any) => void;
  plotId: string;
  taskId: string;
  taskName: string;
  requestId: string;
  requestStatus: string;
  currentUserRole: string;
  currentUserName: string;
}

export default function ReceiptUploadModal({
  isOpen,
  onClose,
  onSuccess,
  plotId,
  taskId,
  taskName,
  requestId,
  requestStatus,
  currentUserRole,
  currentUserName
}: ReceiptUploadModalProps) {
  const [receiptUploadNote, setReceiptUploadNote] = useState('');
  const [receiptUploadFile, setReceiptUploadFile] = useState<File | null>(null);
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);

  const handleUploadReceipt = async () => {
    setIsUploadingReceipt(true);
    try {
      let uploadedUrl = null;
      if (receiptUploadFile) {
        const fileExt = receiptUploadFile.name.split('.').pop();
        const fileName = `${plotId}/receipt-${requestId}-${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('task_images')
          .upload(fileName, receiptUploadFile);
        if (uploadError) throw uploadError;
        
        const { data: publicUrlData } = supabase.storage
          .from('task_images')
          .getPublicUrl(fileName);
        uploadedUrl = publicUrlData.publicUrl;
      }
      
      const { data: insertedRows, error: insertError } = await supabase
        .from('task_material_receipts')
        .insert([{
          request_id: requestId,
          image_url: uploadedUrl,
          notes: receiptUploadNote,
          received_by_role: currentUserRole,
          received_by_name: currentUserName
        }])
        .select('*');
        
      if (insertError) throw insertError;
      
      if (requestStatus !== 'received') {
        const { error: dbError } = await supabase
          .from('task_material_requests')
          .update({
            status: 'partial',
            updated_by: currentUserName,
            updated_at: new Date().toISOString()
          })
          .eq('id', requestId);
        if (dbError) throw dbError;
      }
      
      // Notify parent to instantly update local state with the returned db row
      if (insertedRows && insertedRows.length > 0) {
        onSuccess(insertedRows[0]);
      }
      
      onClose();
    } catch (e: any) {
      alert('เกิดข้อผิดพลาดในการอัปโหลด: ' + e.message);
    } finally {
      setIsUploadingReceipt(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
        <div className="bg-slate-800 p-4 text-white flex justify-between items-center">
          <div>
            <h3 className="font-bold text-lg">เพิ่มรูปรับของ</h3>
            <p className="text-xs text-slate-300">แปลง {plotId} - {taskName}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-700 rounded-full transition-colors">
            <XCircle size={20} />
          </button>
        </div>
        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">รูปถ่ายบิล / รถส่งของ</label>
            <div className="flex items-center gap-3">
              <label className="flex-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 border-dashed rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer transition-colors">
                <Camera size={24} className="text-slate-400 mb-2"/>
                <span className="text-xs font-bold text-slate-500">คลิกเพื่อเลือกรูปภาพ</span>
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { if(e.target.files?.[0]) setReceiptUploadFile(e.target.files[0]) }} />
              </label>
              {receiptUploadFile && (
                <div className="w-20 h-20 rounded-xl overflow-hidden border border-slate-200 relative shrink-0">
                  <img src={URL.createObjectURL(receiptUploadFile)} className="w-full h-full object-cover" />
                  <button onClick={() => setReceiptUploadFile(null)} className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1"><XCircle size={12}/></button>
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">หมายเหตุ (เช่น ทราย 2 คิว)</label>
            <textarea 
              value={receiptUploadNote}
              onChange={(e) => setReceiptUploadNote(e.target.value)}
              placeholder="ระบุจำนวน หรือหมายเหตุเพิ่มเติม..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:border-blue-500 outline-none h-24 resize-none"
            ></textarea>
          </div>
        </div>
        <div className="p-4 border-t border-slate-100 flex gap-2">
          <button onClick={onClose} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors">ยกเลิก</button>
          <button 
            onClick={handleUploadReceipt} 
            disabled={isUploadingReceipt || !receiptUploadFile}
            className={`flex-1 py-3 font-bold rounded-xl flex justify-center items-center gap-2 transition-colors ${receiptUploadFile ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
          >
            {isUploadingReceipt ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} บันทึกรูปรับของ
          </button>
        </div>
      </div>
    </div>
  );
}
