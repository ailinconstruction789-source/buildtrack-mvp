import React from 'react';
import { AlertTriangle, CheckCircle, Info, HelpCircle, X, Trash2, ShieldAlert } from 'lucide-react';

export interface AppModalConfig {
  isOpen: boolean;
  type: 'confirm' | 'alert';
  variant?: 'warning' | 'success' | 'danger' | 'info';
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface AppCustomModalProps {
  config: AppModalConfig | null;
  onClose: () => void;
}

export default function AppCustomModal({ config, onClose }: AppCustomModalProps) {
  if (!config || !config.isOpen) return null;

  const {
    type = 'alert',
    variant = 'info',
    title,
    message,
    confirmText = type === 'confirm' ? 'ยืนยัน' : 'ตกลง',
    cancelText = 'ยกเลิก',
    onConfirm,
    onCancel
  } = config;

  const handleConfirm = () => {
    if (onConfirm) onConfirm();
    onClose();
  };

  const handleCancel = () => {
    if (onCancel) onCancel();
    onClose();
  };

  const getVariantStyles = () => {
    switch (variant) {
      case 'danger':
        return {
          iconBg: 'bg-rose-100 text-rose-600 border-rose-200',
          btnBg: 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-200',
          icon: <Trash2 size={28} />
        };
      case 'warning':
        return {
          iconBg: 'bg-amber-100 text-amber-600 border-amber-200',
          btnBg: 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-200',
          icon: <AlertTriangle size={28} />
        };
      case 'success':
        return {
          iconBg: 'bg-emerald-100 text-emerald-600 border-emerald-200',
          btnBg: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200',
          icon: <CheckCircle size={28} />
        };
      case 'info':
      default:
        return {
          iconBg: 'bg-purple-100 text-purple-600 border-purple-200',
          btnBg: 'bg-purple-600 hover:bg-purple-700 text-white shadow-purple-200',
          icon: <ShieldAlert size={28} />
        };
    }
  };

  const style = getVariantStyles();

  return (
    <div className="fixed inset-0 bg-black/70 z-[999999] flex items-center justify-center p-4 overflow-y-auto animate-fade-in backdrop-blur-xs">
      <div className="bg-white rounded-3xl w-full max-w-sm sm:max-w-md p-6 shadow-2xl border border-slate-100 relative overflow-hidden text-center transform transition-all animate-scale-up">
        
        {/* Top Decorative Color Bar */}
        <div className={`absolute top-0 left-0 w-full h-2 ${
          variant === 'danger' ? 'bg-rose-500' :
          variant === 'warning' ? 'bg-amber-500' :
          variant === 'success' ? 'bg-emerald-500' : 'bg-purple-500'
        }`}></div>

        {/* Close Button */}
        <button 
          onClick={handleCancel}
          className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
        >
          <X size={18} />
        </button>

        {/* Icon Header */}
        <div className="flex justify-center mb-4 mt-2">
          <div className={`w-16 h-16 rounded-2xl border-2 flex items-center justify-center shadow-sm ${style.iconBg}`}>
            {style.icon}
          </div>
        </div>

        {/* Title */}
        <h3 className="text-lg sm:text-xl font-black text-slate-800 mb-2 leading-tight">
          {title}
        </h3>

        {/* Message */}
        <p className="text-xs sm:text-sm font-bold text-slate-500 leading-relaxed mb-6 whitespace-pre-line px-2">
          {message}
        </p>

        {/* Action Buttons */}
        <div className="flex items-center justify-center gap-3">
          {type === 'confirm' && (
            <button
              type="button"
              onClick={handleCancel}
              className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-4 py-2.5 rounded-xl text-xs sm:text-sm border border-slate-200 transition-all active:scale-95"
            >
              {cancelText}
            </button>
          )}
          
          <button
            type="button"
            onClick={handleConfirm}
            className={`flex-1 font-bold px-4 py-2.5 rounded-xl text-xs sm:text-sm shadow-md transition-all active:scale-95 ${style.btnBg}`}
          >
            {confirmText}
          </button>
        </div>

      </div>
    </div>
  );
}
