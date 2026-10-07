'use client';

import React, { useState } from 'react';
import { Plot } from '@/types/database.types';
import MeterPhotoConfirmationModal from './MeterPhotoConfirmationModal';
import { X, Eye } from 'lucide-react';

interface MeterStatusBadgesProps {
  plot: Plot | any;
  size?: 'xs' | 'sm' | 'md';
  interactive?: boolean;
  onRefresh?: () => void;
  className?: string;
}

export default function MeterStatusBadges({
  plot,
  size = 'sm',
  interactive = true,
  onRefresh,
  className = ''
}: MeterStatusBadgesProps) {
  const [selectedMeterModal, setSelectedMeterModal] = useState<{
    isOpen: boolean;
    meterType: 'water_meter' | 'electric_meter';
  }>({
    isOpen: false,
    meterType: 'water_meter'
  });

  const [lightbox, setLightbox] = useState<{
    isOpen: boolean;
    url: string;
    title: string;
    meterNo?: string;
    date?: string;
  } | null>(null);

  if (!plot) return null;

  const waterStatus = plot.water_meter_status || 'NotStarted';
  const waterImg = plot.water_meter_image_url;
  const isWaterPaid = waterStatus === 'Paid' && !waterImg && waterStatus !== 'Installed';
  const isWaterInstalled = waterStatus === 'Installed' || waterStatus === 'Received' || !!waterImg;

  const electricStatus = plot.electric_meter_status || 'NotStarted';
  const electricImg = plot.electric_meter_image_url;
  const isElectricPaid = electricStatus === 'Paid' && !electricImg && electricStatus !== 'Installed';
  const isElectricInstalled = electricStatus === 'Installed' || electricStatus === 'Received' || !!electricImg;

  // If neither has any status or photo, return null
  if (!isWaterPaid && !isWaterInstalled && !isElectricPaid && !isElectricInstalled) {
    return null;
  }

  const badgeTextSize = size === 'xs' ? 'text-[9px]' : size === 'md' ? 'text-xs' : 'text-[10px] sm:text-[11px]';
  const iconSizeClass = size === 'xs' ? 'text-[10px]' : size === 'md' ? 'text-sm' : 'text-xs';

  const handleWaterClick = (e: React.MouseEvent) => {
    if (!interactive) return;
    e.stopPropagation();
    if (isWaterPaid) {
      setSelectedMeterModal({ isOpen: true, meterType: 'water_meter' });
    } else if (waterImg) {
      setLightbox({
        isOpen: true,
        url: waterImg,
        title: `มิเตอร์น้ำ · แปลง ${plot.plot_name || plot.id}`,
        meterNo: plot.water_meter_meter_no,
        date: plot.water_meter_installed_date || plot.water_meter_date
      });
    } else if (isWaterInstalled) {
      setSelectedMeterModal({ isOpen: true, meterType: 'water_meter' });
    }
  };

  const handleElectricClick = (e: React.MouseEvent) => {
    if (!interactive) return;
    e.stopPropagation();
    if (isElectricPaid) {
      setSelectedMeterModal({ isOpen: true, meterType: 'electric_meter' });
    } else if (electricImg) {
      setLightbox({
        isOpen: true,
        url: electricImg,
        title: `มิเตอร์ไฟฟ้า · แปลง ${plot.plot_name || plot.id}`,
        meterNo: plot.electric_meter_meter_no,
        date: plot.electric_meter_installed_date || plot.electric_meter_date
      });
    } else if (isElectricInstalled) {
      setSelectedMeterModal({ isOpen: true, meterType: 'electric_meter' });
    }
  };

  // If non-interactive, render simple span badges with pointer-events-none
  if (!interactive) {
    return (
      <div className={`inline-flex items-center gap-0.5 shrink-0 pointer-events-none select-none ${className}`}>
        {/* 💧 มิเตอร์น้ำ */}
        {isWaterPaid && (
          <span
            className={`inline-flex items-center justify-center gap-0.5 px-1 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-black ${badgeTextSize} animate-pulse`}
            title="จ่ายค่าน้ำแล้ว (รอโฟร์แมนถ่ายรูปมิเตอร์)"
          >
            <span className={iconSizeClass}>💧📸</span>
          </span>
        )}

        {isWaterInstalled && (
          <span
            className={`inline-flex items-center justify-center p-0.5 text-cyan-600 ${iconSizeClass}`}
            title={`ติดตั้งมิเตอร์น้ำแล้ว ${plot.water_meter_meter_no ? `(เลข: ${plot.water_meter_meter_no})` : ''}`}
          >
            <span>💧</span>
          </span>
        )}

        {/* ⚡️ มิเตอร์ไฟฟ้า */}
        {isElectricPaid && (
          <span
            className={`inline-flex items-center justify-center gap-0.5 px-1 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-black ${badgeTextSize} animate-pulse`}
            title="จ่ายค่าไฟแล้ว (รอโฟร์แมนถ่ายรูปมิเตอร์)"
          >
            <span className={iconSizeClass}>⚡️📸</span>
          </span>
        )}

        {isElectricInstalled && (
          <span
            className={`inline-flex items-center justify-center p-0.5 text-amber-500 ${iconSizeClass}`}
            title={`ติดตั้งมิเตอร์ไฟฟ้าแล้ว ${plot.electric_meter_meter_no ? `(เลข: ${plot.electric_meter_meter_no})` : ''}`}
          >
            <span>⚡️</span>
          </span>
        )}
      </div>
    );
  }

  return (
    <>
      <div className={`inline-flex items-center gap-1 shrink-0 ${className}`}>
        
        {/* 💧 มิเตอร์น้ำ */}
        {isWaterPaid && (
          <button
            type="button"
            onClick={handleWaterClick}
            className={`inline-flex items-center justify-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 font-black ${badgeTextSize} shadow-xs animate-pulse transition-transform hover:scale-105 cursor-pointer`}
            title="จ่ายค่าน้ำแล้ว (รอโฟร์แมนถ่ายรูปมิเตอร์)"
          >
            <span className={iconSizeClass}>💧📸</span>
          </button>
        )}

        {isWaterInstalled && (
          <button
            type="button"
            onClick={handleWaterClick}
            className={`inline-flex items-center justify-center p-0.5 rounded hover:bg-cyan-50 text-cyan-600 transition-transform hover:scale-110 cursor-pointer ${iconSizeClass}`}
            title={`ติดตั้งมิเตอร์น้ำแล้ว ${plot.water_meter_meter_no ? `(เลข: ${plot.water_meter_meter_no})` : ''} ${waterImg ? '· คลิกเพื่อดูรูป' : ''}`}
          >
            <span>💧</span>
          </button>
        )}

        {/* ⚡️ มิเตอร์ไฟฟ้า */}
        {isElectricPaid && (
          <button
            type="button"
            onClick={handleElectricClick}
            className={`inline-flex items-center justify-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 font-black ${badgeTextSize} shadow-xs animate-pulse transition-transform hover:scale-105 cursor-pointer`}
            title="จ่ายค่าไฟแล้ว (รอโฟร์แมนถ่ายรูปมิเตอร์)"
          >
            <span className={iconSizeClass}>⚡️📸</span>
          </button>
        )}

        {isElectricInstalled && (
          <button
            type="button"
            onClick={handleElectricClick}
            className={`inline-flex items-center justify-center p-0.5 rounded hover:bg-amber-50 text-amber-500 transition-transform hover:scale-110 cursor-pointer ${iconSizeClass}`}
            title={`ติดตั้งมิเตอร์ไฟฟ้าแล้ว ${plot.electric_meter_meter_no ? `(เลข: ${plot.electric_meter_meter_no})` : ''} ${electricImg ? '· คลิกเพื่อดูรูป' : ''}`}
          >
            <span>⚡️</span>
          </button>
        )}

      </div>

      {/* Meter Photo Confirmation Modal */}
      {selectedMeterModal.isOpen && (
        <MeterPhotoConfirmationModal
          isOpen={selectedMeterModal.isOpen}
          onClose={() => setSelectedMeterModal({ isOpen: false, meterType: 'water_meter' })}
          plot={plot}
          meterType={selectedMeterModal.meterType}
          onSuccess={onRefresh}
        />
      )}

      {/* Lightbox Modal */}
      {lightbox?.isOpen && (
        <div 
          onClick={(e) => { e.stopPropagation(); setLightbox(null); }}
          className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-3xl max-w-xl w-full overflow-hidden shadow-2xl flex flex-col"
          >
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <h4 className="font-black text-sm">{lightbox.title}</h4>
                {lightbox.meterNo && (
                  <p className="text-xs text-slate-300">หมายเลขมิเตอร์: {lightbox.meterNo}</p>
                )}
              </div>
              <button 
                onClick={() => setLightbox(null)}
                className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>
            <div className="bg-slate-950 p-2 flex items-center justify-center max-h-[70vh] overflow-hidden">
              <img 
                src={lightbox.url} 
                alt={lightbox.title} 
                className="max-h-[68vh] w-auto object-contain rounded-xl"
              />
            </div>
            {lightbox.date && (
              <div className="p-3 bg-slate-50 border-t border-slate-100 text-center text-xs text-slate-500 font-bold">
                วันที่ติดตั้งเสร็จจริง: {new Date(lightbox.date).toLocaleDateString('th-TH')}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
