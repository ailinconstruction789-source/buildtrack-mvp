"use client";

import React, { useState, useEffect } from 'react';
import { getDashboardKPIs, getFunnelData, getCycleTimeData } from '@/lib/sales_api';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { TrendingUp, Users, Home, AlertCircle, Calendar, ChevronDown } from 'lucide-react';

export default function OwnerAnalyticsDashboard() {
  const [kpis, setKpis] = useState<any>(null);
  const [funnelData, setFunnelData] = useState<any[]>([]);
  const [cycleData, setCycleData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      const [kpiRes, funnelRes, cycleRes] = await Promise.all([
        getDashboardKPIs(),
        getFunnelData(),
        getCycleTimeData()
      ]);
      setKpis(kpiRes);
      setFunnelData(funnelRes);
      setCycleData(cycleRes);
      setLoading(false);
    }
    loadData();
  }, []);

  if (loading) {
    return <div className="min-h-screen bg-[#0f172a] flex items-center justify-center text-white">Loading Analytics...</div>;
  }

  return (
    <div className="min-h-screen bg-[#0f172a] text-white p-6 font-sans">
      {/* Header */}
      <header className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-wide">Owner Analytics</h1>
          <p className="text-gray-400 text-sm mt-1">Executive Dashboard Overview</p>
        </div>
        
        <div className="flex gap-4">
          <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-xl px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-white/20 transition">
            <span className="text-sm font-medium">All Projects</span>
            <ChevronDown size={16} />
          </div>
          <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-xl px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-white/20 transition">
            <Calendar size={16} />
            <span className="text-sm font-medium">This Month</span>
            <ChevronDown size={16} />
          </div>
        </div>
      </header>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <KPICard title="Walk-ins" value={kpis.walkIns} icon={<Users size={20} />} trend="+12%" />
        <KPICard title="Bookings" value={kpis.bookings} icon={<TrendingUp size={20} />} trend="+5%" />
        <KPICard title="Transfers" value={kpis.transfers} icon={<Home size={20} />} trend="-2%" negative />
        <KPICard title="Cancellations" value={kpis.cancellations} icon={<AlertCircle size={20} />} trend="+1%" negative />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Cycle Time Chart */}
        <div className="bg-white text-gray-900 rounded-[2rem] p-6 shadow-xl relative overflow-hidden border border-gray-100">
          <h2 className="text-lg font-bold mb-1 text-[#0f172a]">Process Cycle Time</h2>
          <p className="text-sm text-gray-500 mb-6">Average time spent in each pipeline stage</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cycleData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#e2e8f0" />
                <XAxis type="number" />
                <YAxis dataKey="stage" type="category" width={150} tick={{ fontSize: 12, fill: '#64748b' }} />
                <Tooltip cursor={{fill: '#f1f5f9'}} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                <Legend />
                <Bar dataKey="time" name="Actual Time" fill="#0f172a" radius={[0, 4, 4, 0]} barSize={16} />
                <Bar dataKey="target" name="Target SLA" fill="#d4af37" radius={[0, 4, 4, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Sales Funnel Chart */}
        <div className="bg-white text-gray-900 rounded-[2rem] p-6 shadow-xl relative overflow-hidden border border-gray-100">
          <h2 className="text-lg font-bold mb-1 text-[#0f172a]">Sales Funnel Conversion</h2>
          <p className="text-sm text-gray-500 mb-6">Lead drop-off rates across stages</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                <Tooltip cursor={{fill: '#f1f5f9'}} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                <Bar dataKey="value" fill="#d4af37" radius={[4, 4, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      
      {/* Footer Banner */}
      <div className="bg-gradient-to-r from-[#d4af37] to-[#eab308] rounded-2xl p-6 flex justify-between items-center shadow-lg">
        <div>
          <h3 className="text-white font-bold text-xl">Revenue Forecast</h3>
          <p className="text-white/80 text-sm mt-1">Expected transfers this month based on bank approvals.</p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-extrabold text-white">฿ 45.2M</div>
          <div className="text-white/90 text-sm mt-1">Target: ฿ 50.0M</div>
        </div>
      </div>
    </div>
  );
}

function KPICard({ title, value, icon, trend, negative = false }: { title: string, value: string | number, icon: React.ReactNode, trend: string, negative?: boolean }) {
  return (
    <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-[2rem] p-6 relative overflow-hidden hover:bg-white/15 transition-all duration-300">
      <div className="flex justify-between items-start mb-4">
        <div className="p-3 bg-white/10 rounded-xl text-[#d4af37]">
          {icon}
        </div>
        <div className={`px-2 py-1 rounded-md text-xs font-semibold ${negative ? 'bg-red-500/20 text-red-300' : 'bg-green-500/20 text-green-300'}`}>
          {trend}
        </div>
      </div>
      <h3 className="text-gray-400 text-sm font-medium">{title}</h3>
      <div className="text-3xl font-bold text-white mt-1">{value}</div>
    </div>
  );
}
