'use client';

import React from 'react';
import { HousePlot, SiteCharacter, SiteTeam } from '@/lib/livingSite/types';
import { CheckCircle2, AlertTriangle, Clock, HardHat, Building, ArrowRight } from 'lucide-react';

export interface LivingSiteListViewProps {
  houses: HousePlot[];
  characters: SiteCharacter[];
  teams: SiteTeam[];
  onSelectHouse: (house: HousePlot) => void;
  onSelectCharacter: (char: SiteCharacter) => void;
}

export const LivingSiteListView: React.FC<LivingSiteListViewProps> = ({
  houses,
  characters,
  teams,
  onSelectHouse,
  onSelectCharacter
}) => {
  return (
    <div className="w-full bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm space-y-6 animate-in fade-in duration-200">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <div>
          <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <span>📋 รายการสรุปงานและบุคลากรในไซต์งาน (Accessible List View)</span>
          </h3>
          <p className="text-xs text-slate-500">
            แสดงข้อมูลบ้านทุกแปลงและทีมงานทั้งหมดในรูปแบบตาราง เหมาะสำหรับการอ่านข้อมูลเชิงลึกและอุปกรณ์ที่ไม่รองรับ 3D
          </p>
        </div>
      </div>

      {/* 🏡 Plots Section */}
      <div className="space-y-3">
        <h4 className="text-sm font-black text-slate-800 flex items-center gap-2">
          <Building size={16} className="text-indigo-600" />
          <span>สถานะการก่อสร้างรายแปลง ({houses.length} แปลง)</span>
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {houses.map(h => (
            <div
              key={h.id}
              onClick={() => onSelectHouse(h)}
              className="p-4 rounded-2xl border border-slate-200 hover:border-indigo-400 hover:shadow-md transition cursor-pointer bg-slate-50/50 space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-base font-black text-indigo-700">แปลง {h.plotName}</span>
                    {h.floorCount === 1 ? (
                      <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                        1 ชั้น
                      </span>
                    ) : h.floorCount === 2 ? (
                      <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold">
                        2 ชั้น
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold">
                        ยังไม่ระบุชั้น
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 font-medium">{h.houseType}</p>
                </div>
                <div className="text-right">
                  <span className="text-lg font-black text-slate-900">{h.overallProgress}%</span>
                  <span className="block text-[10px] text-slate-400">คืบหน้า</span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-indigo-600 h-full rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, h.overallProgress)}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-200/60">
                <span className="text-slate-600 font-bold">{h.currentStage}</span>
                {h.defectCount > 0 ? (
                  <span className="text-rose-600 font-bold flex items-center gap-1">
                    <AlertTriangle size={12} />
                    <span>ดีเฟกต์ {h.defectCount}</span>
                  </span>
                ) : (
                  <span className="text-emerald-600 font-medium flex items-center gap-1">
                    <CheckCircle2 size={12} />
                    <span>เรียบร้อย</span>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 👷 Workers & Roles Section */}
      <div className="space-y-3 pt-4 border-t border-slate-200">
        <h4 className="text-sm font-black text-slate-800 flex items-center gap-2">
          <HardHat size={16} className="text-amber-500" />
          <span>ทีมงานและบุคลากรประจำไซต์ ({characters.length} คน)</span>
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {characters.map(c => (
            <div
              key={c.id}
              onClick={() => onSelectCharacter(c)}
              className="p-3.5 rounded-2xl border border-slate-200 hover:border-amber-400 hover:shadow-md transition cursor-pointer bg-white space-y-2"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h5 className="text-xs font-black text-slate-900">{c.name}</h5>
                  <span className="text-[11px] font-bold text-amber-600">{c.roleLabel}</span>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-bold">
                  {c.businessState === 'in_progress' ? 'ทำงาน' : c.businessState === 'resting' ? 'พัก' : 'ตรวจงาน'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 truncate">{c.taskName}</p>
              {c.speechText && (
                <div className="text-[10px] text-indigo-700 bg-indigo-50 p-1.5 rounded-lg italic">
                  "{c.speechText}"
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
