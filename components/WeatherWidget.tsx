import React from 'react';
import { Map as MapIcon, X } from 'lucide-react';

interface WeatherWidgetProps {
  weatherInfo: any;
  showWeatherWidget: boolean;
  setShowWeatherWidget: (val: boolean) => void;
}

export default function WeatherWidget({ weatherInfo, showWeatherWidget, setShowWeatherWidget }: WeatherWidgetProps) {
  if (!showWeatherWidget || !weatherInfo) return null;

  return (
    <div className="absolute right-0 top-full mt-3 w-[280px] bg-white rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.2)] border border-slate-100 p-4 animate-in fade-in slide-in-from-top-2">
      <div className="flex justify-between items-start mb-3">
        <div>
          <h4 className="text-sm font-black text-slate-800 flex items-center gap-1"><MapIcon size={14} className="text-rose-500" /> {weatherInfo.location}</h4>
          <p className="text-[10px] text-slate-500 font-bold">{new Date().toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
        <button onClick={() => setShowWeatherWidget(false)} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
      </div>

      <div className="flex items-center gap-3 bg-blue-50/50 p-3 rounded-xl mb-3 border border-blue-50">
        <span className="text-4xl">{weatherInfo.currentDetails.icon}</span>
        <div>
          <div className="text-2xl font-black text-blue-700 leading-none">{weatherInfo.currentTemp}°C</div>
          <div className="text-xs font-bold text-blue-600/80 mt-1">{weatherInfo.currentDetails.text}</div>
        </div>
      </div>

      {weatherInfo.alert && (
        <div className={`p-2.5 rounded-lg mb-4 text-[10px] font-bold border ${weatherInfo.alert.type === 'rain' ? 'bg-blue-100 text-blue-800 border-blue-200' : weatherInfo.alert.type === 'uv-high' ? 'bg-rose-100 text-rose-800 border-rose-200' : 'bg-orange-100 text-orange-800 border-orange-200'}`}>
          {weatherInfo.alert.msg}
        </div>
      )}

      <div className="border-t border-slate-100 pt-3">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">พยากรณ์ 4 ชม. ข้างหน้า</p>
        <div className="flex justify-between gap-1">
          {weatherInfo.hourly.map((h: any, i: number) => (
            <div key={i} className="flex flex-col items-center justify-center bg-slate-50 rounded-lg p-2 flex-1 border border-slate-100">
              <span className="text-[10px] font-bold text-slate-500">{h.time}</span>
              <span className="text-lg my-1">{h.details.icon}</span>
              <span className="text-[11px] font-black text-slate-700">{h.temp}°</span>
              {h.rainProb > 20 && <span className="text-[8px] font-bold text-blue-500 mt-0.5">{h.rainProb}%</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
