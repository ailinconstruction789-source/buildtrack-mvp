"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, User, Phone, MapPin, Check, Plus, X, Sparkles, Building2, Tag, ChevronDown, ChevronUp, Clock, UserCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Lead } from '@/types/sales';

interface LeadPickerProps {
  selectedLeadId?: string | null;
  selectedLead?: any | null;
  onSelectLead: (lead: any | null) => void;
  projectName?: string;
  currentPlotName?: string;
  label?: string;
  placeholder?: string;
  allowCreateNew?: boolean;
  onToggleCreateNew?: (isNew: boolean) => void;
  isCreateNewMode?: boolean;
}

export default function LeadPicker({
  selectedLeadId,
  selectedLead,
  onSelectLead,
  projectName,
  currentPlotName,
  label = "เลือกลูกค้าจาก Lead CRM",
  placeholder = "🔍 คลิกเพื่อค้นหา หรือ เลือกลูกค้าจาก Lead CRM...",
  allowCreateNew = true,
  onToggleCreateNew,
  isCreateNewMode = false
}: LeadPickerProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Fetch leads on mount or when search modal is opened
  useEffect(() => {
    let isCancelled = false;
    const fetchLeads = async () => {
      setLoading(true);
      try {
        if (typeof supabase?.from !== 'function') {
          if (!isCancelled) setLoading(false);
          return;
        }

        let queryBuilder = supabase
          .from('leads')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100);

        const { data, error } = await queryBuilder;
        if (error) throw error;
        if (!isCancelled && data) {
          setLeads(data);
        }
      } catch (err) {
        console.error('Error fetching leads for LeadPicker:', err);
      } finally {
        if (!isCancelled) setLoading(false);
      }
    };

    fetchLeads();
    return () => { isCancelled = true; };
  }, [projectName]);

  // Click outside listener
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Autofocus search input when opened
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  // Filter and sort leads:
  // 1. Leads matching current plot (highest priority)
  // 2. Leads matching project
  // 3. Other leads
  const filteredLeads = useMemo(() => {
    const q = query.trim().toLowerCase();
    
    let result = leads.filter(l => {
      if (!q) return true;
      const name = (l.customer_name || '').toLowerCase();
      const phone = (l.phone || '').replace(/[^0-9]/g, '');
      const cleanQ = q.replace(/[^0-9a-zA-Z\u0E00-\u0E7F]/g, '');
      const lineId = (l.line_id || '').toLowerCase();
      const plot = (l.interested_plot_name || '').toLowerCase();
      return name.includes(q) || phone.includes(cleanQ) || lineId.includes(q) || plot.includes(q);
    });

    // Score for sorting
    return result.sort((a, b) => {
      let scoreA = 0;
      let scoreB = 0;

      // Match current plot exactly
      if (currentPlotName) {
        if (a.interested_plot_name === currentPlotName || a.interested_plot_id === currentPlotName) scoreA += 50;
        if (b.interested_plot_name === currentPlotName || b.interested_plot_id === currentPlotName) scoreB += 50;
      }

      // Match project
      if (projectName) {
        if (a.project_name === projectName) scoreA += 20;
        if (b.project_name === projectName) scoreB += 20;
      }

      // Active / in progress leads higher than lost
      if (a.crm_status && !a.crm_status.includes('Lost') && !a.crm_status.includes('Cancelled')) scoreA += 10;
      if (b.crm_status && !b.crm_status.includes('Lost') && !b.crm_status.includes('Cancelled')) scoreB += 10;

      return scoreB - scoreA;
    });
  }, [leads, query, currentPlotName, projectName]);

  // Current active lead
  const currentLead = selectedLead || leads.find(l => l.id === selectedLeadId);

  const handleSelect = (lead: any) => {
    onSelectLead(lead);
    setIsOpen(false);
    setQuery('');
    if (onToggleCreateNew) onToggleCreateNew(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelectLead(null);
    setQuery('');
  };

  return (
    <div className="space-y-1.5" ref={dropdownRef}>
      <div className="flex items-center justify-between">
        <label className="block text-xs font-bold text-slate-800 flex items-center gap-1.5">
          <User size={13} className="text-blue-600" />
          <span>{label}</span>
        </label>
        {allowCreateNew && onToggleCreateNew && (
          <button
            type="button"
            onClick={() => {
              const nextMode = !isCreateNewMode;
              onToggleCreateNew(nextMode);
              if (nextMode) {
                onSelectLead(null);
                setIsOpen(false);
              }
            }}
            className={`text-[11px] font-bold px-2 py-0.5 rounded-lg border transition-colors flex items-center gap-1 cursor-pointer ${
              isCreateNewMode 
                ? 'bg-blue-600 text-white border-blue-600 shadow-sm' 
                : 'bg-white text-blue-700 border-blue-200 hover:bg-blue-50'
            }`}
          >
            {isCreateNewMode ? (
              <>
                <User size={11} /> สลับไปเลือกลูกค้าเดิม
              </>
            ) : (
              <>
                <Plus size={11} /> + ลูกค้าใหม่ (Walk-in)
              </>
            )}
          </button>
        )}
      </div>

      {!isCreateNewMode && (
        <div className="relative">
          {/* Searchable Select Trigger Box */}
          <div
            onClick={() => setIsOpen(!isOpen)}
            className={`w-full bg-white border-2 rounded-xl px-3 py-2 text-xs transition-all cursor-pointer flex items-center justify-between gap-2 shadow-2xs ${
              isOpen 
                ? 'border-blue-500 ring-2 ring-blue-500/20' 
                : currentLead 
                  ? 'border-blue-300 bg-blue-50/30 hover:border-blue-400' 
                  : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            {currentLead ? (
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="w-5 h-5 rounded-md bg-blue-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                  {(currentLead.customer_name || currentLead.customerName || currentLead.name || '').slice(0, 1) || <User size={10} />}
                </div>
                <div className="min-w-0 flex items-center gap-1.5 truncate">
                  <span className="font-bold text-slate-900 truncate">
                    {currentLead.customer_name || currentLead.customerName || currentLead.name}
                  </span>
                  {(currentLead.phone || currentLead.phoneNumber) && (
                    <span className="text-[11px] text-slate-500 font-medium">
                      ({currentLead.phone || currentLead.phoneNumber})
                    </span>
                  )}
                  {(currentLead.interested_plot_name || currentLead.interestedPlotName || currentLead.interested_plot_id) && (
                    <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.2 rounded border border-amber-200 shrink-0">
                      แปลง {currentLead.interested_plot_name || currentLead.interestedPlotName || currentLead.interested_plot_id}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <span className="text-slate-400 font-medium truncate flex items-center gap-1.5">
                <Search size={13} className="text-slate-400" />
                {placeholder}
              </span>
            )}

            <div className="flex items-center gap-1 shrink-0 text-slate-400">
              {currentLead && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="hover:text-rose-600 p-0.5 rounded-full hover:bg-rose-50 transition-colors cursor-pointer"
                  title="ล้างการเลือก"
                >
                  <X size={14} />
                </button>
              )}
              {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </div>
          </div>

          {/* Searchable Select Dropdown Menu */}
          {isOpen && (
            <div className="absolute z-50 left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
              {/* Dropdown Search Input Header */}
              <div className="p-2 border-b border-slate-100 bg-slate-50/80">
                <div className="relative flex items-center">
                  <Search size={14} className="absolute left-2.5 text-slate-400 pointer-events-none" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="พิมพ์ชื่อ, เบอร์โทร หรือ แปลง..."
                    className="w-full bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-inner"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      className="absolute right-2 text-slate-400 hover:text-slate-600"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>

              {/* Dropdown Options List */}
              <div className="max-h-60 overflow-y-auto p-1.5 space-y-1">
                <div className="px-2 py-0.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                  <span>รายชื่อลูกค้า CRM ({filteredLeads.length} รายการ)</span>
                  {loading && <span className="text-blue-600 animate-pulse">กำลังโหลด...</span>}
                </div>

                {filteredLeads.length === 0 ? (
                  <div className="text-center py-5 px-3 text-xs text-slate-500">
                    <User size={20} className="mx-auto text-slate-300 mb-1" />
                    <div>ไม่พบรายชื่อลูกค้าที่ตรงกับ "{query}"</div>
                    {allowCreateNew && onToggleCreateNew && (
                      <button
                        type="button"
                        onClick={() => {
                          onToggleCreateNew(true);
                          setIsOpen(false);
                        }}
                        className="mt-2 text-xs font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg inline-flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <Plus size={12} /> + สร้างเป็นลูกค้าใหม่ (Walk-in)
                      </button>
                    )}
                  </div>
                ) : (
                  filteredLeads.map(lead => {
                    const isCurrentPlot = currentPlotName && (lead.interested_plot_name === currentPlotName || lead.interested_plot_id === currentPlotName);
                    const isSelected = (currentLead?.id === lead.id);

                    return (
                      <div
                        key={lead.id}
                        onClick={() => handleSelect(lead)}
                        className={`p-2 rounded-xl cursor-pointer transition-all flex items-center justify-between gap-2 text-left ${
                          isSelected
                            ? 'bg-blue-600 text-white shadow-sm'
                            : isCurrentPlot
                              ? 'bg-amber-50/90 hover:bg-amber-100 border border-amber-200'
                              : 'hover:bg-slate-100/90 border border-transparent'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`font-bold text-xs ${isSelected ? 'text-white' : 'text-slate-900'}`}>
                              {lead.customer_name}
                            </span>
                            {isCurrentPlot && !isSelected && (
                              <span className="text-[10px] font-black bg-amber-500 text-white px-1.5 py-0.2 rounded-full shadow-2xs">
                                ⭐ สนใจแปลงนี้
                              </span>
                            )}
                            {lead.interested_plot_name && !isCurrentPlot && !isSelected && (
                              <span className="text-[10px] font-bold bg-slate-100 text-slate-700 px-1.5 py-0.2 rounded border border-slate-200">
                                เล็งแปลง {lead.interested_plot_name}
                              </span>
                            )}
                            {lead.crm_status && !isSelected && (
                              <span className="text-[10px] font-semibold bg-slate-200/80 text-slate-700 px-1.5 py-0.2 rounded">
                                {lead.crm_status.split('—')[0] || lead.crm_status}
                              </span>
                            )}
                          </div>
                          <div className={`text-[11px] flex items-center gap-2.5 mt-0.5 ${isSelected ? 'text-blue-100' : 'text-slate-500'}`}>
                            {lead.phone && <span>📞 {lead.phone}</span>}
                            {lead.project_name && <span>🏢 {lead.project_name}</span>}
                            {lead.channel && <span>📢 {lead.channel}</span>}
                          </div>
                        </div>

                        {isSelected && (
                          <div className="shrink-0 text-white">
                            <Check size={16} />
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Bottom Walk-in Quick Option in Dropdown */}
              {allowCreateNew && onToggleCreateNew && (
                <div className="p-2 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs">
                  <span className="text-[11px] text-slate-500">เป็นลูกค้า Walk-in ใหม่?</span>
                  <button
                    type="button"
                    onClick={() => {
                      onToggleCreateNew(true);
                      setIsOpen(false);
                    }}
                    className="text-xs font-bold text-blue-700 hover:text-blue-900 bg-white border border-blue-200 hover:bg-blue-50 px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
                  >
                    <Plus size={11} /> + สร้าง Lead ใหม่
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
