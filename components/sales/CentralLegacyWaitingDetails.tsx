import React from 'react';
import { Calendar, CircleHelp, Clock, FileText, Gift, Home, Search } from 'lucide-react';
import type { buildExcelReport, ExcelSaleRow } from '@/lib/sales/excelReportMetrics';
import type { SaleStage } from '@/lib/sales/workflow';

interface Props { report: ReturnType<typeof buildExcelReport> }

const stages: Record<SaleStage, string> = {
  booked: 'จองแล้ว', contracted: 'ทำสัญญา', downpayment: 'ดาวน์', document_prep: 'เตรียมเอกสาร',
  loan_submitted: 'ยื่นกู้', loan_rejected: 'กู้ไม่ผ่าน', loan_approved: 'กู้อนุมัติ',
  transfer_pending: 'รอโอน', transferred: 'โอนแล้ว', handover: 'ส่งมอบ', cancelled: 'ยกเลิกจอง',
};
const foremanTasks = ['งานติดตั้งสุขภัณฑ์', 'งานติดตั้งถังเก็บน้ำ และ ปั้มน้ำ', 'งานปูหญ้า', 'งานทำทรายล้าง', 'งานทาสีเก็บรายละเอียด'];
const adminDocs = ['ใบอนุญาตก่อสร้าง', 'ทะเบียนบ้าน', 'มิเตอร์น้ำ', 'มิเตอร์ไฟฟ้า'];

/** The original handover-card layout, without the legacy construction reader or writer. */
function TransferCard({ row }: { row: ExcelSaleRow }) {
  const transferred = ['transferred', 'handover'].includes(row.sale.stage);
  return <article aria-label={`รายละเอียด ${row.sale.projectName} แปลง ${row.sale.plotName ?? 'ไม่ทราบ'}`}
    className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col md:flex-row">
    <div className="md:w-1/2 lg:w-2/5 relative bg-slate-100 min-h-[250px]">
      <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 absolute inset-0">
        <Home size={48} opacity={0.2} /><span className="text-xs mt-2">ยังไม่เชื่อมภาพบ้าน</span>
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 to-transparent" />
      <div className="absolute bottom-4 left-4 right-4 text-white">
        <div className={`text-sm font-bold px-2 py-1 rounded inline-block mb-2 text-white ${transferred ? 'bg-emerald-500/90' : 'bg-amber-500/90'}`}>
          {transferred ? 'โอนสำเร็จ' : 'รอโอน'}
        </div>
        <h4 className="font-black text-xl">ไม่ทราบแบบบ้าน</h4>
        <div className="flex items-center gap-1.5 text-slate-200 text-sm mt-1 mb-3">
          <Home size={14} /><span>โครงการ {row.sale.projectName} - แปลง {row.sale.plotName ?? 'ไม่ทราบ'}</span>
        </div>
        <div className="flex justify-between items-center mt-2 text-sm"><span>ความคืบหน้าก่อสร้าง:</span><span className="font-bold">ไม่ทราบ</span></div>
        <div className="w-full bg-slate-700 h-2 rounded-full mt-1 overflow-hidden" aria-label="ความคืบหน้าก่อสร้างยังไม่เชื่อมข้อมูล" />
      </div>
    </div>
    <div className="md:w-1/2 lg:w-3/5 p-6 flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
          <div className="text-xs text-slate-500 font-bold mb-1 flex items-center gap-1"><Calendar size={12} /> สถานะล่าสุด</div>
          <div className="text-sm font-bold text-slate-700 truncate">{stages[row.sale.stage]}</div>
          <div className="text-xs text-slate-500 mt-1">{row.sale.customerName}</div>
        </div>
        <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
          <div className="text-xs text-slate-500 font-bold mb-1 flex items-center gap-1"><Clock size={12} /> วันที่โอน</div>
          <div className="text-sm font-bold text-blue-600">
            <span className="text-[10px] text-slate-400 block mb-0.5">คาดการณ์: {row.expectedTransferDate ?? 'ไม่ทราบ'}</span>
            {transferred ? row.transferredDate ?? 'ไม่ทราบวันโอน' : 'รอดำเนินการ'}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-4 gap-2">
              <h5 className="text-xs font-black text-slate-400 uppercase tracking-wider">ตรวจสอบงานก่อสร้าง & นัดตรวจบ้าน</h5>
              <button type="button" disabled title="ยังไม่เชื่อมระบบนัดตรวจบ้านในรายงานนี้"
                className="text-[11px] font-extrabold text-purple-700 bg-purple-100 px-2.5 py-1 rounded-lg flex items-center gap-1 opacity-50 cursor-not-allowed">
                <Calendar size={13} /><span>+ ลงวันนัดตรวจ</span>
              </button>
            </div>
            <div className="grid grid-cols-2 gap-y-3 gap-x-2">
              {foremanTasks.map(task => <div key={task} className="flex items-center gap-2 text-xs text-slate-600 font-medium" title={`${task}: ยังไม่เชื่อมข้อมูล`}>
                <CircleHelp size={14} className="text-slate-300 shrink-0" /><span className="truncate">{task}</span>
              </div>)}
            </div>
            <p className="text-[10px] text-slate-400 mt-2">สถานะงานก่อสร้าง: ยังไม่เชื่อมข้อมูล</p>
            <div className="mt-3 pt-3 border-t border-slate-200/80 space-y-2">
              {['ตรวจครั้งที่ 1', 'ตรวจครั้งที่ 2 (เก็บงาน)'].map((label, index) => <div key={label} className="flex items-center justify-between text-xs bg-white p-2 rounded-xl border border-slate-200">
                <div className="flex items-center gap-2">
                  <Calendar size={14} className={`${index === 0 ? 'text-purple-600' : 'text-amber-600'} shrink-0`} />
                  <div><span className="font-extrabold text-slate-800 block">{label}</span><span className="text-[10px] text-slate-400 italic">ไม่ทราบวันนัดหมาย</span></div>
                </div>
                <span className="text-[10px] font-black px-2 py-0.5 rounded-lg border bg-slate-100 text-slate-500 border-slate-200">ยังไม่เชื่อม</span>
              </div>)}
            </div>
          </div>
          <button type="button" disabled title="ยังไม่เชื่อมแผนเก็บงานและงานซ่อมในรายงานนี้"
            className="w-full mt-3 bg-purple-50 text-purple-900 font-extrabold py-2.5 px-3 rounded-xl border border-purple-200 text-xs flex items-center justify-center gap-1.5 shadow-2xs opacity-50 cursor-not-allowed">
            <Search size={14} className="text-purple-600" /><span>ดูแผนเก็บงาน & ติดตามงานซ่อม (ยังไม่เชื่อม)</span>
          </button>
        </div>
        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
          <h5 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-4">สถานะเอกสาร & สาธารณูปโภค (ธุรการ)</h5>
          <div className="space-y-3">{adminDocs.map(doc => <div key={doc} className="flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2 text-slate-700 font-bold w-[120px] shrink-0"><FileText size={14} className="text-slate-400 shrink-0" /><span className="truncate text-xs">{doc}</span></div>
            <div className="text-xs px-2 py-1 bg-slate-100 text-slate-500 rounded-lg w-full text-center">ไม่ทราบ</div>
          </div>)}</div>
          <p className="text-[10px] text-slate-400 mt-3">ยังไม่เชื่อมข้อมูลธุรการในรายงานนี้</p>
        </div>
      </div>
      <div className="bg-[#fcfbfa] p-4 rounded-xl border border-amber-200/80 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-100 pb-2.5">
          <h5 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5"><Gift size={16} className="text-[#d4af37]" />สถานะของแถมโครงการ (Promotions)</h5>
          <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2.5 py-0.5 rounded-lg border border-slate-200 w-fit">ไม่ทราบ</span>
        </div>
        <p className="text-xs text-slate-400 font-bold italic py-0.5">ยังไม่เชื่อมข้อมูลรายการของแถมในรายงานนี้</p>
      </div>
    </div>
  </article>;
}

export default function CentralLegacyWaitingDetails({ report }: Props) {
  const currentRows = [...report.monthly.transferred, ...report.forecast];
  const sections = [
    { rows: currentRows, label: 'คาดโอนตามเป้าหมายเดือนนี้', color: 'blue', icon: Calendar },
    { rows: report.carriedOver, label: 'คาดโอนตกค้างจากเดือนก่อน', color: 'rose', icon: Clock },
  ] as const;
  return <div className="mt-8 mb-6">
    <div className="flex items-center gap-3 mb-8 border-b border-gray-100 pb-4">
      <Home className="text-amber-600 w-8 h-8 p-1.5 bg-amber-100 rounded-lg" />
      <div><h2 className="text-2xl font-bold text-gray-800">รายละเอียดบ้านที่รอโอน (Waiting for Transfer)</h2>
        <p className="text-sm text-gray-500">เป้าหมายทั้งหมด {currentRows.length + report.carriedOver.length} แปลง</p>
      </div>
    </div>
    {sections.map(({ rows, label, color, icon: Icon }) => rows.length > 0 && <div key={label} className="mb-10">
      <h3 className={`text-lg font-bold mb-4 flex items-center gap-2 ${color === 'blue' ? 'text-blue-600' : 'text-rose-600'}`}>
        <span className={`p-1.5 rounded-lg ${color === 'blue' ? 'bg-blue-100 text-blue-600' : 'bg-rose-100 text-rose-600'}`}><Icon size={16} /></span>
        {label} ({rows.length} แปลง)
      </h3>
      <div className="grid grid-cols-1 gap-6">{[...rows].sort((a, b) => (a.expectedTransferDate ?? '9999-99-99').localeCompare(b.expectedTransferDate ?? '9999-99-99'))
        .map(row => <TransferCard key={row.sale.saleId} row={row} />)}</div>
    </div>)}
    {currentRows.length + report.carriedOver.length === 0 && <p className="text-sm text-gray-400 p-6 bg-white rounded-2xl border border-gray-100">ไม่มีรายการโอนหรือคาดโอนที่ทราบวันที่ในช่วงนี้</p>}
    {report.unknownForecast > 0 && <p className="text-xs text-slate-500">ยังไม่ทราบวันที่คาดโอน {report.unknownForecast} รายการ — ไม่รวมในเป้าหมายเดือนหรือตกค้าง</p>}
  </div>;
}
