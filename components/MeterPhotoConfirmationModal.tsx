'use client';

import React, { useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  Camera, X, CheckCircle2, Loader2, Upload, Droplets, Zap, 
  Calendar, Hash, FileText, Image as ImageIcon, Trash2
} from 'lucide-react';
import { Plot } from '@/types/database.types';

interface MeterPhotoConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  plot: Plot | any;
  meterType: 'water_meter' | 'electric_meter';
  onSuccess?: () => void;
  currentUserRole?: string;
  currentUserName?: string;
}

// Compress image helper using canvas
const compressImage = (file: File): Promise<File> => {
  return new Promise((resolve) => {
    const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name);
    if (!isImage) return resolve(file);

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.src = objectUrl;

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(file);

      const MAX_WIDTH = 1280;
      const MAX_HEIGHT = 1280;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
      } else {
        if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
      }
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob((blob) => {
        if (blob) {
          const outputName = file.name.replace(/\.(heic|heif|png|webp)$/i, '.jpg');
          const compressed = new File([blob], outputName, { type: 'image/jpeg', lastModified: Date.now() });
          resolve(compressed);
        } else {
          resolve(file);
        }
      }, 'image/jpeg', 0.75);
    };
  });
};

export default function MeterPhotoConfirmationModal({
  isOpen,
  onClose,
  plot,
  meterType,
  onSuccess,
  currentUserRole,
  currentUserName
}: MeterPhotoConfirmationModalProps) {
  if (!isOpen || !plot) return null;

  const isWater = meterType === 'water_meter';
  const meterTitle = isWater ? 'มิเตอร์น้ำ' : 'มิเตอร์ไฟฟ้า';
  const Icon = isWater ? Droplets : Zap;
  const iconColor = isWater ? 'text-cyan-500' : 'text-amber-500';
  const iconBg = isWater ? 'bg-cyan-50 border-cyan-200' : 'bg-amber-50 border-amber-200';
  const headerGradient = isWater ? 'from-cyan-600 to-blue-700' : 'from-amber-600 to-orange-700';

  const existingImageUrl = isWater ? plot.water_meter_image_url : plot.electric_meter_image_url;
  const existingMeterNo = (isWater ? plot.water_meter_meter_no : plot.electric_meter_meter_no) || '';
  const existingDate = (isWater ? plot.water_meter_installed_date || plot.water_meter_date : plot.electric_meter_installed_date || plot.electric_meter_date) || '';
  const existingStatus = (isWater ? plot.water_meter_status : plot.electric_meter_status) || 'NotStarted';

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(existingImageUrl || null);
  const [meterNo, setMeterNo] = useState<string>(existingMeterNo);
  const [installedDate, setInstalledDate] = useState<string>(
    existingDate ? new Date(existingDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
  );
  const [status, setStatus] = useState<string>(
    existingStatus === 'Paid' || existingStatus === 'NotStarted' || existingStatus === 'Submitting' || existingStatus === 'Waiting'
      ? 'Installed'
      : existingStatus
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const rawFile = e.target.files[0];
      const compressed = await compressImage(rawFile);
      setSelectedFile(compressed);
      setPreviewUrl(URL.createObjectURL(compressed));
    }
  };

  const handleSave = async () => {
    setIsSubmitting(true);
    try {
      let finalImageUrl = existingImageUrl || null;

      // Upload new image if selected
      if (selectedFile) {
        const fileExt = selectedFile.name.split('.').pop() || 'jpg';
        const safePlotId = String(plot.id).replace(/[^a-zA-Z0-9-]/g, '');
        const fileName = `${safePlotId}/${meterType}-${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('task_images')
          .upload(fileName, selectedFile, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage
          .from('task_images')
          .getPublicUrl(fileName);

        finalImageUrl = publicUrlData.publicUrl;
      }

      const updatePayload: any = {
        [`${meterType}_status`]: status,
        [`${meterType}_meter_no`]: meterNo.trim() || null,
        [`${meterType}_installed_date`]: installedDate ? new Date(installedDate).toISOString() : new Date().toISOString(),
        [`${meterType}_image_url`]: finalImageUrl
      };

      // Also ensure standard date field is updated
      if (!plot[`${meterType}_date`]) {
        updatePayload[`${meterType}_date`] = installedDate;
      }

      const { error: updateError } = await supabase
        .from('plots')
        .update(updatePayload)
        .eq('id', plot.id);

      if (updateError) throw updateError;

      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error saving meter confirmation:', err);
      alert('บันทึกข้อมูลไม่สำเร็จ: ' + (err.message || 'โปรดลองอีกครั้ง'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[92vh] border border-slate-200">
        
        {/* Header */}
        <div className={`p-5 text-white bg-gradient-to-r ${headerGradient} flex items-center justify-between shadow-md`}>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-white/20 backdrop-blur-md border border-white/30 text-white">
              <Icon size={24} />
            </div>
            <div>
              <h3 className="font-black text-lg sm:text-xl tracking-tight flex items-center gap-2">
                ยืนยันการติดตั้ง {meterTitle}
              </h3>
              <p className="text-xs text-white/80 font-medium">
                แปลง {plot.plot_name || plot.id} · โครงการ {plot.project_name}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 custom-scrollbar flex-1">
          
          {/* Photo Upload & Preview Section */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              📸 รูปถ่ายมิเตอร์หน้างาน {previewUrl ? '(มีรูปแล้ว)' : '(จำเป็นสำหรับการยืนยัน)'}
            </label>

            {previewUrl ? (
              <div className="relative rounded-2xl overflow-hidden border-2 border-slate-200 bg-slate-900 group aspect-video sm:h-56 w-full flex items-center justify-center">
                <img
                  src={previewUrl}
                  alt={`ภาพถ่าย ${meterTitle}`}
                  className="w-full h-full object-contain"
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2 bg-white/90 hover:bg-white text-slate-800 text-xs font-bold rounded-xl shadow-lg flex items-center gap-1.5 transition-transform hover:scale-105 cursor-pointer"
                  >
                    <Camera size={16} /> เปลี่ยนรูป
                  </button>
                  {selectedFile && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFile(null);
                        setPreviewUrl(existingImageUrl || null);
                      }}
                      className="p-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-lg transition-transform hover:scale-105 cursor-pointer"
                      title="ยกเลิกรูปที่เพิ่งเลือก"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-44 rounded-2xl border-2 border-dashed border-slate-300 hover:border-blue-500 bg-slate-50 hover:bg-blue-50/50 flex flex-col items-center justify-center cursor-pointer transition-all group"
              >
                <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform shadow-inner">
                  <Camera size={24} />
                </div>
                <p className="text-xs sm:text-sm font-bold text-slate-700 group-hover:text-blue-600">
                  คลิกเพื่อถ่ายรูป หรือเลือกรูปมิเตอร์
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  รองรับไฟล์ภาพ JPG, PNG, HEIC จากมือถือ
                </p>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {/* Meter Number & Date Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1">
                <Hash size={14} className="text-slate-400" />
                หมายเลขมิเตอร์ (Meter No.)
              </label>
              <input
                type="text"
                placeholder="เช่น M-884920 หรือระบุเลขบนหน้าปัด"
                value={meterNo}
                onChange={(e) => setMeterNo(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1">
                <Calendar size={14} className="text-slate-400" />
                วันที่ติดตั้งเสร็จจริง
              </label>
              <input
                type="date"
                value={installedDate}
                onChange={(e) => setInstalledDate(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>
          </div>

          {/* Status Selection */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              สถานะหลังการบันทึก
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setStatus('Installed')}
                className={`p-3 rounded-xl border text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer ${
                  status === 'Installed'
                    ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-sm ring-2 ring-blue-500/20'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <CheckCircle2 size={16} className={status === 'Installed' ? 'text-blue-600' : 'text-slate-400'} />
                <span>📸 ติดตั้งเสร็จแล้ว (มีรูป)</span>
              </button>

              <button
                type="button"
                onClick={() => setStatus('Received')}
                className={`p-3 rounded-xl border text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer ${
                  status === 'Received'
                    ? 'bg-emerald-50 border-emerald-500 text-emerald-700 shadow-sm ring-2 ring-emerald-500/20'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <CheckCircle2 size={16} className={status === 'Received' ? 'text-emerald-600' : 'text-slate-400'} />
                <span>✅ ได้รับเอกสาร/สมบูรณ์</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 sm:p-5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2.5 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-xl border border-slate-200 transition-colors cursor-pointer"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSubmitting}
            className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-xs font-black rounded-xl shadow-md transition-all flex items-center gap-2 hover:scale-[1.02] cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={16} className="animate-spin" /> กำลังบันทึก...
              </>
            ) : (
              <>
                <CheckCircle2 size={16} /> ยืนยันบันทึกข้อมูล
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
