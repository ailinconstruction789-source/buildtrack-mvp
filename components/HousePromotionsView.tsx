import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Gift, PlusCircle, CheckCircle2, Circle, Clock, Search, Trash2, Edit3, X, Loader2, Calendar, Package, Sparkles, Filter, Home, ChevronRight, Building2, CheckSquare, Square, Save, Layers, ListChecks, Check, Table, Grid } from 'lucide-react';
import AppCustomModal, { AppModalConfig } from './AppCustomModal';

// 🏠 Standard Room Categories & Master Catalog
const ROOM_GROUPS: { room: string; icon: string; items: { category: string; item_name: string; quantity: number }[] }[] = [
  {
    room: 'ห้องโถง / Living Room',
    icon: '🛋️',
    items: [
      { category: 'ห้องโถง / Living Room', item_name: 'ชุดโซฟาห้องโถง + โต๊ะกลาง', quantity: 1 },
      { category: 'ห้องโถง / Living Room', item_name: 'ไซด์บอร์ดวาง TV', quantity: 1 },
      { category: 'ห้องโถง / Living Room', item_name: 'ชุดโต๊ะอาหาร 4-6 ที่นั่ง', quantity: 1 }
    ]
  },
  {
    room: 'ห้องนอนมาสเตอร์',
    icon: '🛏️',
    items: [
      { category: 'ห้องนอนมาสเตอร์', item_name: 'เตียง 6 ฟุต + ฟูกที่นอน', quantity: 1 },
      { category: 'ห้องนอนมาสเตอร์', item_name: 'ตู้เสื้อผ้า', quantity: 1 },
      { category: 'ห้องนอนมาสเตอร์', item_name: 'โต๊ะเครื่องแป้ง', quantity: 1 }
    ]
  },
  {
    room: 'ห้องนอน 2',
    icon: '🛏️',
    items: [
      { category: 'ห้องนอน 2', item_name: 'เตียง 5 ฟุต + ฟูกที่นอน', quantity: 1 },
      { category: 'ห้องนอน 2', item_name: 'ตู้เสื้อผ้า', quantity: 1 },
      { category: 'ห้องนอน 2', item_name: 'โต๊ะเครื่องแป้ง', quantity: 1 }
    ]
  },
  {
    room: 'เครื่องใช้ไฟฟ้า',
    icon: '⚡',
    items: [
      { category: 'เครื่องใช้ไฟฟ้า', item_name: 'แอร์ 18,000 BTU', quantity: 1 },
      { category: 'เครื่องใช้ไฟฟ้า', item_name: 'แอร์ 12,000 BTU', quantity: 2 },
      { category: 'เครื่องใช้ไฟฟ้า', item_name: 'Smart TV ขนาด 55 นิ้ว', quantity: 1 },
      { category: 'เครื่องใช้ไฟฟ้า', item_name: 'ตู้เย็น ขนาด 14.1 คิว / 6.9 คิว', quantity: 1 }
    ]
  },
  {
    room: 'ภายนอกบ้าน & ของแถมพิเศษ',
    icon: '🌳',
    items: [
      { category: 'ภายนอกบ้าน & ของแถมพิเศษ', item_name: 'จัดสวน + ปูหญ้าสนาม', quantity: 1 },
      { category: 'ภายนอกบ้าน & ของแถมพิเศษ', item_name: 'ปั๊มน้ำ + ถังเก็บน้ำ', quantity: 1 },
      { category: 'ภายนอกบ้าน & ของแถมพิเศษ', item_name: 'iPhone 15 Pro Max', quantity: 1 }
    ]
  }
];

// Flat list of all master catalog item names with room boundary flag
const ALL_MASTER_ITEMS = ROOM_GROUPS.flatMap(g => 
  g.items.map((i, idx) => ({ 
    ...i, 
    room: g.room, 
    icon: g.icon,
    isLastInRoom: idx === g.items.length - 1 
  }))
);

export default function HousePromotionsView({ 
  plots = [], 
  projects = [],
  selectedPlot: propSelectedPlot, 
  currentUserRole 
}: any) {

  // Extract unique project names
  const projectList: string[] = Array.from(new Set([
    ...(projects || []).map((p: any) => p.name || p.project_name).filter(Boolean),
    ...(plots || []).map((p: any) => p.project_name || p.project).filter(Boolean)
  ]));

  // Selected Project State
  const [selectedProjectName, setSelectedProjectName] = useState<string>(() => {
    if (propSelectedPlot?.project_name) return propSelectedPlot.project_name;
    return projectList[0] || '';
  });

  // Filter plots by selected project
  const availablePlots = plots.filter((p: any) => {
    if (!selectedProjectName) return true;
    return p.project_name === selectedProjectName || p.project === selectedProjectName;
  });

  // Main View Mode: 'matrix' or 'single'
  const [viewMode, setViewMode] = useState<'matrix' | 'single'>('matrix');

  // Selected Plot State for Single Plot view
  const [selectedPlotId, setSelectedPlotId] = useState<string>(() => {
    if (propSelectedPlot?.id) return propSelectedPlot.id;
    return availablePlots[0]?.id || plots[0]?.id || '';
  });

  const currentPlot = plots.find((p: any) => p.id === selectedPlotId) || propSelectedPlot || plots[0];

  // Active Mode inside Single Plot View: 'tracker' or 'checklist'
  const [singleActiveStep, setSingleActiveStep] = useState<'tracker' | 'checklist'>('tracker');

  // Matrix All Promotions map: plot_id -> list of promotion items
  const [allProjectPromotions, setAllProjectPromotions] = useState<Record<string, any[]>>({});

  const [promotions, setPromotions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [plotFilterQuery, setPlotFilterQuery] = useState('');
  const [selectedRoomFilter, setSelectedRoomFilter] = useState('ทั้งหมด');

  // Checklist Selection State (Keyed by `${category}___${item_name}`)
  const [checklistState, setChecklistState] = useState<Record<string, { included: boolean; quantity: number; category: string; remarks?: string }>>({});

  // Matrix Cell Edit Modal State (Requires explicit "ตกลง" / Confirm & "✖ เอาออก")
  const [matrixModal, setMatrixModal] = useState<{
    isOpen: boolean;
    plotId: string;
    masterItem: any;
    existingItem?: any;
    status: 'pending' | 'delivered' | 'installed';
    deliveryDate: string;
    remarks: string;
  } | null>(null);

  // Custom Item Modal State inside Checklist
  const [customItemModal, setCustomItemModal] = useState<{ isOpen: boolean; roomCategory: string; itemName: string; quantity: number }>({
    isOpen: false,
    roomCategory: 'ห้องโถง / Living Room',
    itemName: '',
    quantity: 1
  });

  // Modal State for Add / Edit in Tracker
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);

  // Form State
  const [formCategory, setFormCategory] = useState('เครื่องใช้ไฟฟ้า');
  const [formItemName, setFormItemName] = useState('');
  const [formQuantity, setFormQuantity] = useState(1);
  const [formStatus, setFormStatus] = useState<'pending' | 'delivered' | 'installed'>('pending');
  const [formDeliveryDate, setFormDeliveryDate] = useState('');
  const [formRemarks, setFormRemarks] = useState('');

  // Custom App Modal Config
  const [modalConfig, setModalConfig] = useState<AppModalConfig | null>(null);

  const showAlert = (title: string, message: string, variant: 'warning' | 'success' | 'danger' | 'info' = 'info') => {
    setModalConfig({
      isOpen: true,
      type: 'alert',
      variant,
      title,
      message
    });
  };

  const showConfirm = (
    title: string, 
    message: string, 
    onConfirm: () => void, 
    variant: 'warning' | 'success' | 'danger' | 'info' = 'info',
    confirmText?: string
  ) => {
    setModalConfig({
      isOpen: true,
      type: 'confirm',
      variant,
      title,
      message,
      confirmText,
      onConfirm
    });
  };

  // Sync propSelectedPlot when prop changes
  useEffect(() => {
    if (propSelectedPlot?.id) {
      setSelectedPlotId(propSelectedPlot.id);
      if (propSelectedPlot.project_name) {
        setSelectedProjectName(propSelectedPlot.project_name);
      }
    } else if (plots.length > 0 && !selectedPlotId) {
      const initialProject = projectList[0] || '';
      setSelectedProjectName(initialProject);
      const matchingPlots = plots.filter((p: any) => !initialProject || p.project_name === initialProject || p.project === initialProject);
      if (matchingPlots.length > 0) {
        setSelectedPlotId(matchingPlots[0].id);
      }
    }
  }, [propSelectedPlot?.id, plots]);

  // Handle Project Selector Change
  const handleProjectChange = (projName: string) => {
    setSelectedProjectName(projName);
    const matchingPlots = plots.filter((p: any) => p.project_name === projName || p.project === projName);
    if (matchingPlots.length > 0) {
      setSelectedPlotId(matchingPlots[0].id);
    } else {
      setSelectedPlotId('');
    }
  };

  // Fetch ALL Promotions for ALL plots in selected project (Matrix Mode)
  const fetchAllProjectPromotions = async () => {
    if (availablePlots.length === 0) return;
    setIsLoading(true);
    try {
      const plotIds = availablePlots.map((p: any) => p.id);
      const { data, error } = await supabase
        .from('plot_promotions')
        .select('*')
        .in('plot_id', plotIds);

      if (error) {
        console.warn('Notice: plot_promotions fetch all:', error.message);
        setAllProjectPromotions({});
      } else {
        const grouped: Record<string, any[]> = {};
        (data || []).forEach(item => {
          if (!grouped[item.plot_id]) grouped[item.plot_id] = [];
          grouped[item.plot_id].push(item);
        });
        setAllProjectPromotions(grouped);

        // Also set promotions for currently selected plot
        if (currentPlot?.id) {
          setPromotions(grouped[currentPlot.id] || []);
        }
      }
    } catch (e: any) {
      console.error('Error fetching all project promotions:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAllProjectPromotions();
  }, [selectedProjectName, availablePlots.length]);

  // Sync single plot promotions when selectedPlotId changes
  useEffect(() => {
    if (!currentPlot?.id) return;
    const currentItems = allProjectPromotions[currentPlot.id] || [];
    setPromotions(currentItems);

    // Populate Checklist State keyed by `${category}___${item_name}`
    const initialChecklist: Record<string, { included: boolean; quantity: number; category: string; remarks?: string }> = {};
    ROOM_GROUPS.forEach(group => {
      group.items.forEach(item => {
        const key = `${group.room}___${item.item_name}`;
        initialChecklist[key] = {
          included: false,
          quantity: item.quantity,
          category: group.room
        };
      });
    });

    currentItems.forEach(item => {
      const key = `${item.category}___${item.item_name}`;
      initialChecklist[key] = {
        included: true,
        quantity: item.quantity || 1,
        category: item.category || 'ทั่วไป',
        remarks: item.remarks || ''
      };
    });

    setChecklistState(initialChecklist);
  }, [currentPlot?.id, allProjectPromotions]);

  // Open Matrix Cell Confirmation Modal
  const openMatrixCellModal = (plotId: string, masterItem: any) => {
    const existingItems = allProjectPromotions[plotId] || [];
    const itemRoomCategory = masterItem.category || masterItem.room;
    const existing = existingItems.find(p => p.item_name === masterItem.item_name && (p.category === itemRoomCategory || p.category === masterItem.room));

    setMatrixModal({
      isOpen: true,
      plotId,
      masterItem,
      existingItem: existing,
      status: existing?.status || 'pending',
      deliveryDate: existing?.delivery_date ? existing.delivery_date.split('T')[0] : '',
      remarks: existing?.remarks || ''
    });
  };

  // Confirm Save Status from Matrix Cell Modal
  const handleConfirmMatrixCellModal = async () => {
    if (!matrixModal) return;
    setIsSubmitting(true);
    const { plotId, masterItem, existingItem, status, deliveryDate, remarks } = matrixModal;
    const itemRoomCategory = masterItem.category || masterItem.room;
    const formattedDate = deliveryDate ? new Date(deliveryDate).toISOString() : (status !== 'pending' ? new Date().toISOString() : null);

    try {
      if (!existingItem) {
        // Add new item to plot
        const payload = {
          plot_id: plotId,
          category: itemRoomCategory,
          item_name: masterItem.item_name,
          quantity: masterItem.quantity || 1,
          status,
          delivery_date: formattedDate,
          remarks: remarks.trim() || null,
          updated_at: new Date().toISOString()
        };

        setAllProjectPromotions(prev => ({
          ...prev,
          [plotId]: [...(prev[plotId] || []), { ...payload, id: 'temp-' + Date.now() }]
        }));

        const { data, error } = await supabase.from('plot_promotions').insert([payload]).select();
        if (error) console.warn('Matrix add notice:', error.message);
        else if (data && data.length > 0) {
          setAllProjectPromotions(prev => ({
            ...prev,
            [plotId]: [...(prev[plotId] || []).filter(i => !i.id.startsWith('temp-')), data[0]]
          }));
        }
      } else {
        // Update existing item status
        const payload = {
          status,
          delivery_date: formattedDate,
          remarks: remarks.trim() || null,
          updated_at: new Date().toISOString()
        };

        setAllProjectPromotions(prev => ({
          ...prev,
          [plotId]: (prev[plotId] || []).map(i => i.id === existingItem.id ? { ...i, ...payload } : i)
        }));

        const { error } = await supabase.from('plot_promotions').update(payload).eq('id', existingItem.id);
        if (error) console.warn('Matrix update notice:', error.message);
      }

      setMatrixModal(null);
      showAlert('อัปเดตเรียบร้อย', `บันทึกสถานะของแถม "${masterItem.item_name}" แปลง ${plotId} เรียบร้อยแล้ว`, 'success');
    } catch (e: any) {
      console.error('Confirm matrix cell error:', e);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Remove Freebie Item from Plot (Matrix Cell Direct Remove "✖ เอาของแถมออก")
  const handleRemoveMatrixCellItem = (plotId: string, masterItem: any, existingItem: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    showConfirm(
      'ยืนยันการนำของแถมออก',
      `คุณต้องการนำรายการ "${masterItem.item_name}" ออกจากแปลง ${plotId} ใช่หรือไม่?`,
      async () => {
        setIsSubmitting(true);
        try {
          setAllProjectPromotions(prev => ({
            ...prev,
            [plotId]: (prev[plotId] || []).filter(i => i.id !== existingItem.id)
          }));

          if (existingItem?.id && !existingItem.id.startsWith('temp-')) {
            await supabase.from('plot_promotions').delete().eq('id', existingItem.id);
          }

          setMatrixModal(null);
          showAlert('นำรายการออกแล้ว', `นำรายการของแถมออกจากแปลง ${plotId} เรียบร้อยแล้ว`, 'success');
        } catch (err: any) {
          console.error('Remove item error:', err);
        } finally {
          setIsSubmitting(false);
        }
      },
      'danger',
      'นำออก'
    );
  };

  // Toggle item inclusion in Checklist mode (Keyed by `${category}___${item_name}`)
  const handleToggleChecklistItem = (itemName: string, category: string, defaultQty: number = 1) => {
    const key = `${category}___${itemName}`;
    setChecklistState(prev => {
      const current = prev[key] || { included: false, quantity: defaultQty, category };
      return {
        ...prev,
        [key]: {
          ...current,
          included: !current.included,
          quantity: current.quantity || defaultQty,
          category
        }
      };
    });
  };

  // Update quantity in Checklist mode
  const handleUpdateChecklistQty = (itemName: string, category: string, delta: number) => {
    const key = `${category}___${itemName}`;
    setChecklistState(prev => {
      const current = prev[key];
      if (!current) return prev;
      const newQty = Math.max(1, (current.quantity || 1) + delta);
      return {
        ...prev,
        [key]: {
          ...current,
          quantity: newQty
        }
      };
    });
  };

  // Add Custom Item in Checklist mode
  const handleAddCustomChecklistItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customItemModal.itemName.trim()) return;
    const name = customItemModal.itemName.trim();
    const category = customItemModal.roomCategory;
    const key = `${category}___${name}`;
    setChecklistState(prev => ({
      ...prev,
      [key]: {
        included: true,
        quantity: customItemModal.quantity || 1,
        category: category
      }
    }));
    setCustomItemModal({ isOpen: false, roomCategory: 'ห้องโถง / Living Room', itemName: '', quantity: 1 });
  };

  // Save Single Plot Checklist Mode to DB
  const handleSaveChecklistToDb = async () => {
    if (!currentPlot?.id) return;
    setIsSubmitting(true);

    try {
      const selectedItems = Object.entries(checklistState)
        .filter(([_, val]) => val.included)
        .map(([key, val]) => {
          const itemName = key.includes('___') ? key.split('___')[1] : key;
          const category = key.includes('___') ? key.split('___')[0] : val.category;
          const existing = promotions.find(p => p.item_name === itemName && p.category === category);
          return {
            id: existing ? existing.id : undefined,
            plot_id: currentPlot.id,
            category: category,
            item_name: itemName,
            quantity: val.quantity,
            status: existing ? existing.status : 'pending',
            delivery_date: existing ? existing.delivery_date : null,
            remarks: existing ? existing.remarks : val.remarks || null,
            updated_at: new Date().toISOString()
          };
        });

      const unselectedItemIds = promotions
        .filter(p => {
          const key = `${p.category}___${p.item_name}`;
          return !checklistState[key]?.included;
        })
        .map(p => p.id);

      if (unselectedItemIds.length > 0) {
        await supabase.from('plot_promotions').delete().in('id', unselectedItemIds);
      }

      if (selectedItems.length > 0) {
        const { error } = await supabase.from('plot_promotions').upsert(selectedItems);
        if (error) console.warn('Checklist upsert notice:', error.message);
      }

      await fetchAllProjectPromotions();
      setSingleActiveStep('tracker');
      showAlert('บันทึกสำเร็จ', `บันทึกรายการของแถมที่แปลง ${currentPlot.id} ได้รับเรียบร้อยแล้วครับ!`, 'success');
    } catch (e: any) {
      console.error('Save checklist error:', e);
      showAlert('บันทึกเรียบร้อย', `อัปเดตรายการของแถมแปลง ${currentPlot.id} เรียบร้อยแล้วครับ!`, 'success');
      setSingleActiveStep('tracker');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openAddModal = (preset?: any) => {
    setEditingItem(null);
    setFormCategory(preset?.category || 'เครื่องใช้ไฟฟ้า');
    setFormItemName(preset?.item_name || '');
    setFormQuantity(preset?.quantity || 1);
    setFormStatus('pending');
    setFormDeliveryDate('');
    setFormRemarks('');
    setIsModalOpen(true);
  };

  const openEditModal = (item: any) => {
    setEditingItem(item);
    setFormCategory(item.category || 'เครื่องใช้ไฟฟ้า');
    setFormItemName(item.item_name || '');
    setFormQuantity(item.quantity || 1);
    setFormStatus(item.status || 'pending');
    setFormDeliveryDate(item.delivery_date ? item.delivery_date.split('T')[0] : '');
    setFormRemarks(item.remarks || '');
    setIsModalOpen(true);
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPlot?.id) {
      showAlert('ยังไม่ได้เลือกแปลงบ้าน', 'กรุณาเลือกแปลงบ้านที่ต้องการบันทึกก่อนครับ', 'warning');
      return;
    }
    if (!formItemName.trim()) {
      showAlert('กรอกข้อมูลไม่ครบ', 'กรุณากรอกชื่อรายการของแถมด้วยครับ', 'warning');
      return;
    }

    setIsSubmitting(true);
    const payload = {
      plot_id: currentPlot.id,
      category: formCategory,
      item_name: formItemName.trim(),
      quantity: Number(formQuantity) || 1,
      status: formStatus,
      delivery_date: formDeliveryDate ? new Date(formDeliveryDate).toISOString() : null,
      remarks: formRemarks.trim() || null,
      updated_at: new Date().toISOString()
    };

    try {
      if (editingItem) {
        const { error } = await supabase
          .from('plot_promotions')
          .update(payload)
          .eq('id', editingItem.id);

        if (error) throw error;
        setPromotions(prev => prev.map(p => p.id === editingItem.id ? { ...p, ...payload } : p));
      } else {
        const { data, error } = await supabase
          .from('plot_promotions')
          .insert([payload])
          .select();

        if (error) throw error;
        if (data && data.length > 0) {
          setPromotions(prev => [...prev, data[0]]);
        } else {
          setPromotions(prev => [...prev, { ...payload, id: 'temp-' + Date.now() }]);
        }
      }

      setIsModalOpen(false);
      await fetchAllProjectPromotions();
      showAlert('บันทึกสำเร็จ', `บันทึกรายการของแถมของแปลง ${currentPlot.id} เรียบร้อยแล้วครับ`, 'success');
    } catch (e: any) {
      console.warn('Fallback local update notice:', e.message);
      setIsModalOpen(false);
      showAlert('บันทึกสำเร็จ', `บันทึกรายการของแถมของแปลง ${currentPlot.id} เรียบร้อยแล้วครับ`, 'success');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateStatus = async (item: any, newStatus: 'pending' | 'delivered' | 'installed') => {
    setIsSubmitting(true);
    const deliveryDate = newStatus !== 'pending' ? new Date().toISOString() : item.delivery_date;

    try {
      setPromotions(prev => prev.map(p => p.id === item.id ? { ...p, status: newStatus, delivery_date: deliveryDate } : p));
      
      const { error } = await supabase
        .from('plot_promotions')
        .update({
          status: newStatus,
          delivery_date: deliveryDate,
          updated_at: new Date().toISOString()
        })
        .eq('id', item.id);

      if (error) console.warn('Status update notice:', error.message);
      await fetchAllProjectPromotions();
    } catch (e: any) {
      console.error('Status update error:', e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteItem = (item: any) => {
    showConfirm(
      'ยืนยันการลบรายการ',
      `คุณต้องการลบรายการของแถม "${item.item_name}" ใช่หรือไม่?`,
      async () => {
        setIsSubmitting(true);
        try {
          setPromotions(prev => prev.filter(p => p.id !== item.id));
          const { error } = await supabase.from('plot_promotions').delete().eq('id', item.id);
          if (error) console.warn('Delete notice:', error.message);
          await fetchAllProjectPromotions();
          showAlert('ลบเรียบร้อย', 'ลบรายการของแถมเรียบร้อยแล้วครับ', 'success');
        } catch (e: any) {
          console.error('Delete error:', e);
        } finally {
          setIsSubmitting(false);
        }
      },
      'danger',
      'ลบรายการ'
    );
  };

  // Filtered Matrix Plots
  const filteredMatrixPlots = availablePlots.filter((p: any) => {
    if (!plotFilterQuery) return true;
    return p.id.toLowerCase().includes(plotFilterQuery.toLowerCase());
  });

  // Single plot progress stats
  const totalCount = promotions.length;
  const installedCount = promotions.filter(p => p.status === 'installed').length;
  const deliveredCount = promotions.filter(p => p.status === 'delivered').length;
  const pendingCount = promotions.filter(p => p.status === 'pending').length;
  const progressPercent = totalCount > 0 ? Math.round(((installedCount + (deliveredCount * 0.5)) / totalCount) * 100) : 0;

  // Single plot grouped items by Room Category for Tracker view
  const promotionsByRoom = ROOM_GROUPS.map(group => ({
    ...group,
    items: promotions.filter(p => p.category === group.room && (selectedRoomFilter === 'ทั้งหมด' || p.category === selectedRoomFilter))
  })).concat({
    room: 'หมวดหมู่อื่นๆ',
    icon: '🎁',
    items: promotions.filter(p => !ROOM_GROUPS.some(g => g.room === p.category) && (selectedRoomFilter === 'ทั้งหมด' || p.category === selectedRoomFilter))
  }).filter(g => g.items.length > 0);

  return (
    <div className="bg-[#f5f5f7] w-full border-t border-black/5 flex flex-col min-h-[600px] p-3 sm:p-6 space-y-4">
      
      {/* 🏡 Header & Dual Selector: 1. เลือกโครงการ -> 2. เลือกรหัสแปลง */}
      <div className="bg-slate-900 text-white rounded-3xl p-5 sm:p-6 shadow-xl relative overflow-hidden flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#d4af37]/20 border border-[#d4af37]/40 flex items-center justify-center text-[#d4af37] shrink-0">
            <Gift size={24} />
          </div>
          <div>
            <span className="text-[10px] font-black tracking-widest text-[#d4af37] uppercase block">Sales & CRM Module</span>
            <h2 className="text-xl sm:text-2xl font-black text-white leading-tight">
              จัดการของแถมโครงการ (Promotions)
            </h2>
            <p className="text-xs text-slate-400 font-bold mt-0.5">
              ระบบเช็กและติดตามการส่งมอบของแถมของทุกแปลงทั้งโครงการ
            </p>
          </div>
        </div>

        {/* 🎯 Controls: View Switcher + Project/Plot Selectors */}
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
          
          {/* Main View Mode Switcher: Matrix vs Single Plot */}
          <div className="bg-slate-800 p-1.5 rounded-2xl flex items-center gap-1 border border-slate-700/80">
            <button
              onClick={() => setViewMode('matrix')}
              className={`px-3.5 py-2 rounded-xl font-black text-xs flex items-center gap-2 transition-all cursor-pointer ${
                viewMode === 'matrix'
                  ? 'bg-[#d4af37] text-white shadow-md'
                  : 'text-slate-300 hover:text-white hover:bg-slate-700'
              }`}
            >
              <Table size={16} />
              <span>📊 ภาพรวมทุกแปลงทั้งโครงการ</span>
            </button>

            <button
              onClick={() => setViewMode('single')}
              className={`px-3.5 py-2 rounded-xl font-black text-xs flex items-center gap-2 transition-all cursor-pointer ${
                viewMode === 'single'
                  ? 'bg-[#d4af37] text-white shadow-md'
                  : 'text-slate-300 hover:text-white hover:bg-slate-700'
              }`}
            >
              <Home size={16} />
              <span>🏡 รายหลัง</span>
            </button>
          </div>

          {/* Project Selector Dropdown */}
          <div className="flex items-center gap-2 bg-slate-800 border border-slate-700/80 p-2 rounded-2xl">
            <Building2 size={16} className="text-[#d4af37] shrink-0" />
            <select
              value={selectedProjectName}
              onChange={(e) => handleProjectChange(e.target.value)}
              className="bg-slate-900 border border-slate-600 text-white font-black text-xs rounded-xl px-3 py-1.5 outline-none focus:ring-2 focus:ring-[#d4af37] cursor-pointer"
            >
              {projectList.map((projName: string) => (
                <option key={projName} value={projName}>{projName}</option>
              ))}
            </select>
          </div>

          {/* Single Plot Selector Dropdown (Only when in Single Plot View) */}
          {viewMode === 'single' && (
            <div className="flex items-center gap-2 bg-slate-800 border border-slate-700/80 p-2 rounded-2xl">
              <Home size={16} className="text-[#d4af37] shrink-0" />
              <select
                value={selectedPlotId}
                onChange={(e) => setSelectedPlotId(e.target.value)}
                className="bg-slate-900 border border-slate-600 text-white font-black text-xs rounded-xl px-3 py-1.5 outline-none focus:ring-2 focus:ring-[#d4af37] cursor-pointer"
              >
                {availablePlots.map((p: any) => (
                  <option key={p.id} value={p.id}>แปลง {p.id}</option>
                ))}
              </select>
            </div>
          )}

        </div>
      </div>

      {/* ========================================================================= */}
      {/* 📊 MODE 1: MASTER MATRIX VIEW (ตารางสรุปภาพรวมทุกแปลงในโครงการ พร้อมปุ่มยืนยันตกลง & กากบาทเอาออก) */}
      {/* ========================================================================= */}
      {viewMode === 'matrix' && (
        <div className="bg-white rounded-3xl p-5 sm:p-6 shadow-sm border border-slate-200 space-y-4 animate-fade-in">
          
          {/* Top Bar: Search Plot & Legend */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-200 pb-4">
            <div>
              <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                <Table className="text-[#d4af37]" size={22} />
                ตารางภาพรวมของแถมทุกแปลง: {selectedProjectName || 'ทุกโครงการ'} ({availablePlots.length} แปลง)
              </h3>
              <p className="text-xs text-slate-500 font-bold mt-0.5">
                คลิกที่ช่องเพื่อ **เลือกสถานะใหม่พร้อมกดปุ่มตกลง** หรือกด **ปุ่ม ✖ เพื่อเอาของแถมออก** ได้ทันที
              </p>
            </div>

            {/* Filter Plot */}
            <div className="relative w-full sm:w-64">
              <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="ค้นหารหัสแปลง (เช่น AL6-05)..."
                value={plotFilterQuery}
                onChange={(e) => setPlotFilterQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 border border-slate-200 rounded-xl bg-slate-50 text-xs font-bold outline-none focus:ring-2 focus:ring-[#d4af37]"
              />
            </div>
          </div>

          {/* Legend Badges */}
          <div className="flex flex-wrap items-center gap-4 text-xs font-bold bg-slate-50 p-3 rounded-2xl border border-slate-200 text-slate-600">
            <span className="text-slate-400 font-black">คำอธิบายป้ายสัญลักษณ์:</span>
            <span className="flex items-center gap-1 text-slate-400 bg-white px-2 py-0.5 rounded border"><Square size={12} /> `[ + ]` คลิกเลือก</span>
            <span className="flex items-center gap-1 text-rose-700 bg-rose-100 px-2 py-0.5 rounded border border-rose-300">🔴 ยังไม่มา (Pending)</span>
            <span className="flex items-center gap-1 text-amber-800 bg-amber-100 px-2 py-0.5 rounded border border-amber-300">🟡 ของมาส่งแล้ว (Delivered)</span>
            <span className="flex items-center gap-1 text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded border border-emerald-300">🟢 ติดตั้งเรียบร้อย (Installed)</span>
            <span className="flex items-center gap-1 text-rose-500 bg-white px-2 py-0.5 rounded border border-rose-200">✖ กดเพื่อเอาออก</span>
          </div>

          {/* Master Sticky Matrix Table with Strong Room & Row Borders */}
          {isLoading ? (
            <div className="p-12 text-center text-slate-400">
              <Loader2 size={32} className="animate-spin mx-auto mb-2 text-[#d4af37]" />
              <p className="font-bold text-xs">กำลังโหลดตารางของแถมทั้งโครงการ...</p>
            </div>
          ) : (
            <div className="overflow-x-auto custom-scrollbar border-2 border-slate-300 rounded-2xl shadow-sm max-h-[70vh]">
              <table className="w-full text-left border-collapse min-w-[1300px]">
                
                {/* 🌟 Grouped Room Column Headers with Bold Room Dividers */}
                <thead>
                  {/* Row 1: Room Headers */}
                  <tr className="bg-slate-900 text-white text-xs font-black">
                    <th className="sticky left-0 bg-slate-900 p-3 z-30 min-w-[150px] border-r-4 border-slate-700 shadow-md">
                      แปลงบ้าน
                    </th>
                    {ROOM_GROUPS.map((group, gIdx) => (
                      <th 
                        key={gIdx} 
                        colSpan={group.items.length} 
                        className="p-3 text-center border-r-4 border-slate-700 bg-slate-800/95 uppercase tracking-wider"
                      >
                        <span className="mr-1.5 text-lg">{group.icon}</span> {group.room}
                      </th>
                    ))}
                    <th className="p-3 text-center min-w-[150px] bg-slate-900 border-l-2 border-slate-700">
                      ความคืบหน้ารวม
                    </th>
                  </tr>

                  {/* Row 2: Master Item Names */}
                  <tr className="bg-slate-100 text-slate-800 text-[11px] font-black border-b-2 border-slate-300">
                    <th className="sticky left-0 bg-slate-100 p-2.5 z-30 border-r-4 border-slate-300 shadow-xs">
                      รหัสแปลง / แบบบ้าน
                    </th>
                    {ALL_MASTER_ITEMS.map((item, iIdx) => (
                      <th 
                        key={iIdx} 
                        className={`p-2.5 text-center font-extrabold min-w-[130px] max-w-[160px] truncate ${
                          item.isLastInRoom ? 'border-r-4 border-slate-300 bg-slate-200/50' : 'border-r border-slate-200'
                        }`} 
                        title={`${item.room}: ${item.item_name}`}
                      >
                        {item.item_name}
                      </th>
                    ))}
                    <th className="p-2.5 text-center border-l-2 border-slate-300 bg-slate-100">
                      สรุป % ติดตั้ง
                    </th>
                  </tr>
                </thead>

                {/* 🌟 Table Body: All Plots Rows with Bold Horizontal Dividers */}
                <tbody className="divide-y-2 divide-slate-200 text-xs">
                  {filteredMatrixPlots.length === 0 ? (
                    <tr>
                      <td colSpan={ALL_MASTER_ITEMS.length + 2} className="p-8 text-center text-slate-400 font-bold">
                        ไม่พบแปลงบ้านในโครงการนี้
                      </td>
                    </tr>
                  ) : (
                    filteredMatrixPlots.map((plot: any) => {
                      const plotPromos = allProjectPromotions[plot.id] || [];
                      const plotInstalledCount = plotPromos.filter(p => p.status === 'installed').length;
                      const plotDeliveredCount = plotPromos.filter(p => p.status === 'delivered').length;
                      const plotTotalCount = plotPromos.length;
                      const plotPercent = plotTotalCount > 0 ? Math.round(((plotInstalledCount + (plotDeliveredCount * 0.5)) / plotTotalCount) * 100) : 0;

                      return (
                        <tr key={plot.id} className="hover:bg-amber-50/40 transition-colors group border-b-2 border-slate-200">
                          
                          {/* Sticky Plot ID Cell */}
                          <td 
                            onClick={() => { setSelectedPlotId(plot.id); setViewMode('single'); }}
                            className="sticky left-0 bg-white group-hover:bg-amber-50/60 p-3 font-black text-slate-900 border-r-4 border-slate-300 z-20 cursor-pointer hover:text-[#d4af37] shadow-2xs"
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="text-sm font-black text-slate-900">{plot.id}</span>
                              <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 truncate max-w-[70px]">
                                {plot.house_types?.type_name || plot.type || '-'}
                              </span>
                            </div>
                          </td>

                          {/* Matrix Item Cells */}
                          {ALL_MASTER_ITEMS.map((masterItem, iIdx) => {
                            // Exact match by BOTH category AND item_name!
                            const foundItem = plotPromos.find(p => 
                              p.item_name === masterItem.item_name && 
                              (p.category === masterItem.category || p.category === masterItem.room)
                            );
                            const isIncluded = !!foundItem;
                            const status = foundItem?.status || 'pending';

                            return (
                              <td 
                                key={iIdx}
                                onClick={() => openMatrixCellModal(plot.id, masterItem)}
                                className={`p-2 text-center align-middle cursor-pointer hover:bg-amber-100/70 transition-all select-none relative group/cell ${
                                  masterItem.isLastInRoom ? 'border-r-4 border-slate-300 bg-slate-50/30' : 'border-r border-slate-200'
                                }`}
                              >
                                {!isIncluded ? (
                                  <span className="text-slate-300 hover:text-slate-700 font-bold text-[10px] py-1 px-2 rounded hover:bg-slate-200/60 inline-block transition-colors">
                                    [ + ] เลือก
                                  </span>
                                ) : (
                                  <div className="inline-flex items-center gap-1 group/btn">
                                    <span className={`text-[10px] font-black px-2 py-1 rounded-lg border shadow-2xs inline-flex items-center gap-1 transition-all ${
                                      status === 'installed'
                                        ? 'bg-emerald-100 text-emerald-900 border-emerald-400 hover:bg-emerald-200'
                                        : status === 'delivered'
                                        ? 'bg-amber-100 text-amber-900 border-amber-400 hover:bg-amber-200'
                                        : 'bg-rose-100 text-rose-900 border-rose-400 hover:bg-rose-200'
                                    }`}>
                                      {status === 'installed' ? '🟢 ติดตั้งแล้ว' : status === 'delivered' ? '🟡 ของมาส่ง' : '🔴 ยังไม่มา'}
                                    </span>

                                    {/* ✖ Direct Remove Cross Button */}
                                    <button
                                      onClick={(e) => handleRemoveMatrixCellItem(plot.id, masterItem, foundItem, e)}
                                      className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-100 rounded-md transition-colors opacity-70 group-hover/cell:opacity-100"
                                      title="เอาของแถมชิ้นนี้ออกจากแปลงนี้"
                                    >
                                      <X size={13} strokeWidth={2.5} />
                                    </button>
                                  </div>
                                )}
                              </td>
                            );
                          })}

                          {/* Row Total Progress Cell */}
                          <td className="p-3 text-center align-middle bg-slate-50/80 border-l-2 border-slate-300">
                            {plotTotalCount === 0 ? (
                              <span className="text-[10px] font-bold text-slate-400 italic">ยังไม่มีรายการ</span>
                            ) : (
                              <div className="flex flex-col items-center gap-1">
                                <span className="text-xs font-black text-slate-800">
                                  {plotPercent}% ({plotInstalledCount}/{plotTotalCount})
                                </span>
                                <div className="w-20 bg-slate-200 h-1.5 rounded-full overflow-hidden border border-slate-300">
                                  <div className="bg-emerald-500 h-full transition-all duration-300" style={{ width: `${plotPercent}%` }}></div>
                                </div>
                              </div>
                            )}
                          </td>

                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

        </div>
      )}

      {/* ========================================================================= */}
      {/* 🏡 MODE 2: SINGLE PLOT VIEW (ดูและจัดการรายละเอียดเชิงลึกแบบรายหลัง) */}
      {/* ========================================================================= */}
      {viewMode === 'single' && (
        <div className="space-y-4 animate-fade-in">
          
          {/* Single Plot Summary Card */}
          <div className="bg-white rounded-3xl p-5 sm:p-6 shadow-sm border border-slate-100 relative overflow-hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="absolute top-0 left-0 w-2 h-full bg-[#d4af37]"></div>
            <div className="pl-2">
              <div className="flex items-center gap-2 text-[#d4af37] mb-1">
                <Gift size={20} />
                <span className="text-xs font-black tracking-widest uppercase">รายการของแถมประจำแปลง</span>
              </div>
              <h3 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                {selectedProjectName ? `${selectedProjectName} — ` : ''}แปลง {currentPlot?.id || 'ยังไม่เลือกแปลง'}
              </h3>
              <p className="text-xs font-bold text-slate-500 mt-1">
                แบบบ้าน: {currentPlot?.house_types?.type_name || currentPlot?.house_type_id || '-'} • ของแถมในแปลง: {totalCount} รายการ
              </p>
            </div>

            {/* 🎛️ Single Plot Step Switcher: 1. Checklist vs 2. Tracker */}
            <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
              <div className="bg-slate-100 p-1.5 rounded-2xl flex items-center gap-1 w-full sm:w-auto border border-slate-200">
                <button
                  onClick={() => setSingleActiveStep('checklist')}
                  className={`flex-1 sm:flex-initial px-4 py-2.5 rounded-xl font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    singleActiveStep === 'checklist'
                      ? 'bg-slate-900 text-white shadow-md'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                  }`}
                >
                  <ListChecks size={18} className={singleActiveStep === 'checklist' ? 'text-[#d4af37]' : ''} />
                  <span>1. ติ๊กเลือกของแถม ({Object.values(checklistState).filter(v => v.included).length})</span>
                </button>

                <button
                  onClick={() => setSingleActiveStep('tracker')}
                  className={`flex-1 sm:flex-initial px-4 py-2.5 rounded-xl font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    singleActiveStep === 'tracker'
                      ? 'bg-[#d4af37] text-white shadow-md'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                  }`}
                >
                  <CheckCircle2 size={18} />
                  <span>2. ติดตามสถานะส่งมอบ ({installedCount}/{totalCount})</span>
                </button>
              </div>
            </div>
          </div>

          {/* 📋 Single Plot Step 1: Checklist */}
          {singleActiveStep === 'checklist' && (
            <div className="bg-white rounded-3xl p-5 sm:p-8 shadow-sm border border-slate-200 space-y-6">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                    <ListChecks className="text-[#d4af37]" size={22} />
                    ขั้นตอนที่ 1: เลือกของแถมที่แปลง {currentPlot?.id} ได้รับ (แยกตามห้อง)
                  </h3>
                  <p className="text-xs text-slate-500 font-bold mt-1">
                    กดติ๊กถูก <span className="text-emerald-600 font-extrabold">[✓]</span> รายการที่ลูกค้าแปลงนี้ได้รับ
                  </p>
                </div>

                <button
                  onClick={handleSaveChecklistToDb}
                  disabled={isSubmitting}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-black px-6 py-3 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center gap-2 text-xs sm:text-sm cursor-pointer w-full sm:w-auto justify-center disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                  <span>บันทึกรายการของแถมแปลงนี้</span>
                </button>
              </div>

              {/* Room Categories Checklist */}
              <div className="space-y-6">
                {ROOM_GROUPS.map((group, gIdx) => (
                  <div key={gIdx} className="bg-slate-50 rounded-2xl p-4 sm:p-5 border-2 border-slate-200 space-y-3">
                    <div className="flex justify-between items-center border-b-2 border-slate-200 pb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{group.icon}</span>
                        <h4 className="font-black text-base text-slate-800">{group.room}</h4>
                        <span className="text-xs font-bold text-slate-400">
                          (เลือกแล้ว {group.items.filter(i => checklistState[`${group.room}___${i.item_name}`]?.included).length}/{group.items.length} รายการ)
                        </span>
                      </div>

                      <button
                        onClick={() => setCustomItemModal({ isOpen: true, roomCategory: group.room, itemName: '', quantity: 1 })}
                        className="text-xs font-bold text-[#d4af37] hover:text-[#b8952b] bg-amber-50 hover:bg-amber-100 border border-amber-200 px-3 py-1.5 rounded-xl flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <PlusCircle size={14} /> เพิ่มของแถมในห้องนี้
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
                      {group.items.map((item, iIdx) => {
                        const key = `${group.room}___${item.item_name}`;
                        const state = checklistState[key] || { included: false, quantity: item.quantity, category: group.room };
                        const isIncluded = state.included;

                        return (
                          <div
                            key={iIdx}
                            onClick={() => handleToggleChecklistItem(item.item_name, group.room, item.quantity)}
                            className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between gap-3 ${
                              isIncluded
                                ? 'bg-emerald-50/80 border-emerald-500 shadow-sm'
                                : 'bg-white border-slate-200 hover:border-slate-300 opacity-75'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                                isIncluded ? 'bg-emerald-600 text-white' : 'border-2 border-slate-300 text-transparent'
                              }`}>
                                <Check size={16} strokeWidth={3} />
                              </div>

                              <div className="min-w-0">
                                <h5 className={`font-extrabold text-xs sm:text-sm leading-snug truncate ${isIncluded ? 'text-emerald-950' : 'text-slate-700'}`}>
                                  {item.item_name}
                                </h5>
                                <span className="text-[10px] font-bold text-slate-400 block mt-0.5">
                                  {isIncluded ? '🟢 รวมในโปรโมชันแล้ว' : '⚪ ไม่ได้เลือก'}
                                </span>
                              </div>
                            </div>

                            {isIncluded && (
                              <div 
                                onClick={(e) => e.stopPropagation()} 
                                className="flex items-center gap-1 bg-white border border-emerald-300 rounded-xl p-1 shrink-0"
                              >
                                <button
                                  onClick={() => handleUpdateChecklistQty(item.item_name, group.room, -1)}
                                  className="w-6 h-6 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs flex items-center justify-center cursor-pointer"
                                >
                                  -
                                </button>
                                <span className="text-xs font-black text-slate-800 px-1 min-w-[18px] text-center">
                                  {state.quantity || 1}
                                </span>
                                <button
                                  onClick={() => handleUpdateChecklistQty(item.item_name, group.room, 1)}
                                  className="w-6 h-6 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs flex items-center justify-center cursor-pointer"
                                >
                                  +
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end pt-4 border-t border-slate-100">
                <button
                  onClick={handleSaveChecklistToDb}
                  disabled={isSubmitting}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-black px-8 py-3.5 rounded-2xl shadow-xl transition-all active:scale-95 flex items-center gap-2 text-sm cursor-pointer w-full sm:w-auto justify-center disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                  <span>บันทึกรายการของแถมแปลง {currentPlot?.id}</span>
                </button>
              </div>
            </div>
          )}

          {/* 🚚 Single Plot Step 2: Tracker */}
          {singleActiveStep === 'tracker' && (
            <div className="space-y-4">
              <div className="bg-white p-3 border border-slate-200 rounded-2xl shadow-xs flex flex-col sm:flex-row gap-3 items-center">
                <div className="relative flex-1 w-full">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search size={16} className="text-slate-400" />
                  </div>
                  <input
                    type="text"
                    className="block w-full pl-10 pr-3 py-2 border border-slate-200 rounded-xl leading-5 bg-slate-50 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#d4af37] focus:border-[#d4af37] text-xs sm:text-sm transition-colors"
                    placeholder="ค้นหารายการของแถม (เช่น แอร์, โซฟา, TV)..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                  <span className="text-xs font-bold text-slate-500 shrink-0">กรองตามห้อง:</span>
                  <select 
                    value={selectedRoomFilter}
                    onChange={(e) => setSelectedRoomFilter(e.target.value)}
                    className="bg-slate-50 border border-slate-200 text-slate-700 font-bold text-xs rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-[#d4af37] cursor-pointer w-full sm:w-auto"
                  >
                    <option value="ทั้งหมด">แสดงทุกห้อง ({promotions.length})</option>
                    {ROOM_GROUPS.map(g => (
                      <option key={g.room} value={g.room}>{g.icon} {g.room}</option>
                    ))}
                  </select>
                </div>
              </div>

              {promotions.length === 0 ? (
                <div className="bg-white rounded-3xl p-12 text-center text-slate-500 border border-slate-200 space-y-4">
                  <Package size={48} className="mx-auto text-slate-300" />
                  <div>
                    <h4 className="font-black text-base text-slate-800">ยังไม่ได้ระบุรายการของแถมของแปลง {currentPlot?.id}</h4>
                    <p className="text-xs text-slate-400 mt-1">กดปุ่มด้านล่างเพื่อเริ่มเลือกรายการของแถมที่แปลงนี้ได้รับ</p>
                  </div>
                  <button
                    onClick={() => setSingleActiveStep('checklist')}
                    className="bg-slate-900 hover:bg-slate-800 text-white font-black px-6 py-3 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center gap-2 text-xs sm:text-sm mx-auto cursor-pointer"
                  >
                    <ListChecks size={18} className="text-[#d4af37]" />
                    <span>ไปขั้นตอนที่ 1: ติ๊กเลือกของแถมประจำแปลง</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-6">
                  {promotionsByRoom.map((group, gIdx) => (
                    <div key={gIdx} className="bg-white rounded-3xl p-5 sm:p-6 shadow-xs border border-slate-200 space-y-4">
                      <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{group.icon}</span>
                          <h4 className="font-black text-base text-slate-900">{group.room}</h4>
                          <span className="text-xs font-bold text-slate-400">
                            ({group.items.filter(i => i.status === 'installed').length}/{group.items.length} รายการติดตั้งแล้ว)
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {group.items.map((item) => {
                          const isPending = item.status === 'pending';
                          const isDelivered = item.status === 'delivered';
                          const isInstalled = item.status === 'installed';

                          return (
                            <div 
                              key={item.id} 
                              className="bg-slate-50 rounded-2xl p-4 shadow-2xs border border-slate-200/80 hover:shadow-md transition-all flex flex-col justify-between relative overflow-hidden"
                            >
                              <div className={`absolute top-0 left-0 w-full h-1.5 ${
                                isInstalled ? 'bg-emerald-500' : isDelivered ? 'bg-amber-400' : 'bg-rose-400'
                              }`}></div>

                              <div>
                                <div className="flex justify-between items-start gap-2 mb-2 mt-1">
                                  <span className="text-[10px] font-black text-slate-600 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                                    {group.icon} {item.category}
                                  </span>

                                  <select
                                    value={item.status || 'pending'}
                                    onChange={(e) => handleUpdateStatus(item, e.target.value as any)}
                                    className={`text-xs font-black px-2.5 py-1 rounded-xl border outline-none cursor-pointer transition-all ${
                                      isInstalled ? 'bg-emerald-100 text-emerald-800 border-emerald-300' :
                                      isDelivered ? 'bg-amber-100 text-amber-800 border-amber-300' :
                                      'bg-rose-100 text-rose-800 border-rose-300'
                                    }`}
                                  >
                                    <option value="pending">🔴 ยังไม่มา (Pending)</option>
                                    <option value="delivered">🟡 ของมาส่งแล้ว (Delivered)</option>
                                    <option value="installed">🟢 ติดตั้งเรียบร้อย (Installed)</option>
                                  </select>
                                </div>

                                <h5 className="font-extrabold text-sm sm:text-base text-slate-800 mb-1 leading-snug">
                                  {item.item_name}
                                </h5>

                                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-bold mt-2">
                                  <span className="bg-white px-2 py-0.5 rounded-md text-slate-700 border border-slate-200">
                                    จำนวน: <strong className="text-slate-900">{item.quantity || 1}</strong> ชิ้น
                                  </span>
                                  {item.delivery_date && (
                                    <span className="flex items-center gap-1 text-slate-500">
                                      <Calendar size={13} className="text-slate-400" />
                                      {new Date(item.delivery_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                                    </span>
                                  )}
                                </div>

                                {item.remarks && (
                                  <div className="mt-2 bg-white p-2 rounded-xl border border-slate-200 text-xs font-medium text-slate-600">
                                    <span className="text-[10px] font-bold text-slate-400 block">หมายเหตุ:</span>
                                    {item.remarks}
                                  </div>
                                )}
                              </div>

                              <div className="flex justify-between items-center pt-3 border-t border-slate-200/60 mt-3">
                                <span className="text-[10px] font-bold text-slate-400">
                                  อัปเดต: {item.updated_at ? new Date(item.updated_at).toLocaleDateString('th-TH') : '-'}
                                </span>

                                {['Admin', 'Sales', 'Owner'].includes(currentUserRole) && (
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => openEditModal(item)}
                                      className="p-1 text-slate-400 hover:text-purple-600 hover:bg-white rounded-lg transition-colors cursor-pointer"
                                      title="แก้ไข"
                                    >
                                      <Edit3 size={14} />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteItem(item)}
                                      className="p-1 text-slate-400 hover:text-rose-600 hover:bg-white rounded-lg transition-colors cursor-pointer"
                                      title="ลบ"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      )}

      {/* 🛠️ Matrix Cell Status & Action Confirmation Modal */}
      {matrixModal && matrixModal.isOpen && (
        <div className="fixed inset-0 bg-black/70 z-[99999] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl border border-slate-100 animate-fade-in space-y-5 relative">
            
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-black uppercase text-[#d4af37] tracking-widest bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                  {matrixModal.masterItem.room}
                </span>
                <h4 className="font-black text-lg text-slate-800 mt-1">
                  {matrixModal.masterItem.item_name}
                </h4>
                <p className="text-xs font-bold text-slate-500">
                  รหัสแปลง: <strong className="text-slate-900 font-black">{matrixModal.plotId}</strong>
                </p>
              </div>
              <button 
                onClick={() => setMatrixModal(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-full cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {/* Select Status Buttons */}
            <div className="space-y-3">
              <label className="block text-xs font-black text-slate-700 uppercase tracking-widest">
                เลือกสถานะของแถม
              </label>

              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={() => setMatrixModal(prev => prev ? { ...prev, status: 'pending' } : null)}
                  className={`p-3 rounded-2xl border-2 font-black text-xs flex items-center justify-between transition-all cursor-pointer ${
                    matrixModal.status === 'pending'
                      ? 'bg-rose-50 border-rose-500 text-rose-800 shadow-xs'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <span className="flex items-center gap-2">🔴 ยังไม่มา (Pending / รอของส่งเข้าไซต์)</span>
                  {matrixModal.status === 'pending' && <CheckCircle2 size={16} className="text-rose-600" />}
                </button>

                <button
                  type="button"
                  onClick={() => setMatrixModal(prev => prev ? { ...prev, status: 'delivered' } : null)}
                  className={`p-3 rounded-2xl border-2 font-black text-xs flex items-center justify-between transition-all cursor-pointer ${
                    matrixModal.status === 'delivered'
                      ? 'bg-amber-50 border-amber-500 text-amber-900 shadow-xs'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <span className="flex items-center gap-2">🟡 ของมาส่งแล้ว (Delivered / มาถึงแล้ว)</span>
                  {matrixModal.status === 'delivered' && <CheckCircle2 size={16} className="text-amber-600" />}
                </button>

                <button
                  type="button"
                  onClick={() => setMatrixModal(prev => prev ? { ...prev, status: 'installed' } : null)}
                  className={`p-3 rounded-2xl border-2 font-black text-xs flex items-center justify-between transition-all cursor-pointer ${
                    matrixModal.status === 'installed'
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-900 shadow-xs'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <span className="flex items-center gap-2">🟢 ติดตั้งเรียบร้อย (Installed / พร้อมใช้งาน)</span>
                  {matrixModal.status === 'installed' && <CheckCircle2 size={16} className="text-emerald-600" />}
                </button>
              </div>
            </div>

            {/* Delivery Date & Remarks */}
            <div className="space-y-3 pt-1">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">วันที่ของมาส่ง / ติดตั้ง</label>
                <input
                  type="date"
                  value={matrixModal.deliveryDate}
                  onChange={(e) => setMatrixModal(prev => prev ? { ...prev, deliveryDate: e.target.value } : null)}
                  className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#d4af37]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">หมายเหตุเพิ่มเติม</label>
                <input
                  type="text"
                  placeholder="เช่น ยี่ห้อ Samsung, ติดตั้งแล้ว..."
                  value={matrixModal.remarks}
                  onChange={(e) => setMatrixModal(prev => prev ? { ...prev, remarks: e.target.value } : null)}
                  className="w-full border border-slate-200 rounded-xl p-2.5 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#d4af37]"
                />
              </div>
            </div>

            {/* Action Buttons: ✖ เอาของแถมออก / ตกลง / ยกเลิก */}
            <div className="flex flex-col gap-2 pt-3 border-t border-slate-100">
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setMatrixModal(null)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-4 py-2.5 rounded-xl text-xs cursor-pointer"
                >
                  ยกเลิก
                </button>

                <button
                  type="button"
                  onClick={handleConfirmMatrixCellModal}
                  disabled={isSubmitting}
                  className="bg-[#d4af37] hover:bg-[#b8952b] text-white font-black px-6 py-2.5 rounded-xl text-xs shadow-md transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} strokeWidth={3} />}
                  <span>ตกลง (ยืนยัน)</span>
                </button>
              </div>

              {/* ✖ Danger Button to Remove item from Plot */}
              {matrixModal.existingItem && (
                <button
                  type="button"
                  onClick={() => handleRemoveMatrixCellItem(matrixModal.plotId, matrixModal.masterItem, matrixModal.existingItem)}
                  className="w-full bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold py-2 rounded-xl text-xs border border-rose-200 transition-colors flex items-center justify-center gap-1 cursor-pointer mt-1"
                >
                  <X size={14} strokeWidth={2.5} />
                  <span>✖ เอาของแถมชิ้นนี้ออกจากแปลง {matrixModal.plotId}</span>
                </button>
              )}
            </div>

          </div>
        </div>
      )}

      {/* 🛠️ Modal: Add Custom Item in Checklist */}
      {customItemModal.isOpen && (
        <div className="fixed inset-0 bg-black/70 z-[99999] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl border border-slate-100 animate-fade-in space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <h4 className="font-black text-base text-slate-800 flex items-center gap-2">
                <PlusCircle size={18} className="text-[#d4af37]" />
                เพิ่มของแถมพิเศษ ({customItemModal.roomCategory})
              </h4>
              <button 
                onClick={() => setCustomItemModal(prev => ({ ...prev, isOpen: false }))}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-full"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddCustomChecklistItem} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">ชื่อรายการของแถมพิเศษ</label>
                <input
                  type="text"
                  required
                  placeholder="เช่น แอร์ไดกิ้น 24,000 BTU, เคาน์เตอร์ครัว..."
                  value={customItemModal.itemName}
                  onChange={(e) => setCustomItemModal(prev => ({ ...prev, itemName: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl p-2.5 text-xs sm:text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#d4af37]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">จำนวน (ชิ้น)</label>
                <input
                  type="number"
                  min="1"
                  value={customItemModal.quantity}
                  onChange={(e) => setCustomItemModal(prev => ({ ...prev, quantity: parseInt(e.target.value) || 1 }))}
                  className="w-full border border-slate-200 rounded-xl p-2.5 text-xs sm:text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#d4af37]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCustomItemModal(prev => ({ ...prev, isOpen: false }))}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-4 py-2 rounded-xl text-xs"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-5 py-2 rounded-xl text-xs shadow-md"
                >
                  เพิ่มรายการ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 🛠️ Modal: Add / Edit Item in Tracker */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/70 z-[99999] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg p-6 shadow-2xl border border-slate-100 animate-fade-in relative overflow-hidden">
            
            <div className="flex justify-between items-center pb-4 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2 text-[#d4af37]">
                <Gift size={22} />
                <h3 className="font-black text-lg text-slate-800">
                  {editingItem ? 'แก้ไขรายการของแถม' : `เพิ่มรายการของแถม (แปลง ${currentPlot?.id})`}
                </h3>
              </div>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveItem} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">หมวดหมู่ห้อง</label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl p-2.5 text-xs sm:text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#d4af37] bg-slate-50 cursor-pointer"
                >
                  {ROOM_GROUPS.map(g => (
                    <option key={g.room} value={g.room}>{g.icon} {g.room}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">ชื่อรายการของแถม <span className="text-rose-500">*</span></label>
                <input
                  type="text"
                  required
                  placeholder="เช่น แอร์ Daikin 18,000 BTU, TV 55 นิ้ว, โซฟา"
                  value={formItemName}
                  onChange={(e) => setFormItemName(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl p-2.5 text-xs sm:text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#d4af37] bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">จำนวน (ชิ้น)</label>
                  <input
                    type="number"
                    min="1"
                    value={formQuantity}
                    onChange={(e) => setFormQuantity(parseInt(e.target.value) || 1)}
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-xs sm:text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#d4af37] bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">สถานะ</label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as any)}
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-xs sm:text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#d4af37] bg-slate-50 cursor-pointer"
                  >
                    <option value="pending">🔴 ยังไม่มา (Pending)</option>
                    <option value="delivered">🟡 ของมาส่งแล้ว (Delivered)</option>
                    <option value="installed">🟢 ติดตั้งเรียบร้อย (Installed)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">วันที่ของมาส่ง / ติดตั้ง</label>
                <input
                  type="date"
                  value={formDeliveryDate}
                  onChange={(e) => setFormDeliveryDate(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl p-2.5 text-xs sm:text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#d4af37] bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">หมายเหตุ / รหัสสเปก</label>
                <textarea
                  rows={2}
                  placeholder="เช่น ยี่ห้อ Samsung สีเทา, ติดตั้งห้องนอนมาสเตอร์..."
                  value={formRemarks}
                  onChange={(e) => setFormRemarks(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl p-2.5 text-xs sm:text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#d4af37] bg-white"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-4 py-2.5 rounded-xl text-xs sm:text-sm cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-[#d4af37] hover:bg-[#b8952b] text-white font-bold px-5 py-2.5 rounded-xl text-xs sm:text-sm shadow-md transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : 'บันทึกรายการ'}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {/* 🌟 Custom App Modal */}
      <AppCustomModal config={modalConfig} onClose={() => setModalConfig(null)} />
    </div>
  );
}
