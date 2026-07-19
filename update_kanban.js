import fs from 'fs';

const filePath = 'c:/Users/HUAWEI/Desktop/buildtrack/components/sales/SalesKanban.tsx';
let code = fs.readFileSync(filePath, 'utf8');

const exportCode = `
  const handleExportData = () => {
    const exportRows = leads.map(l => {
      const transferDate = l.history.find((h: any) => h.status === 'Transferred')?.timestamp?.split('T')[0] || '';
      const cancelDate = l.history.find((h: any) => h.status === 'Cancelled')?.timestamp?.split('T')[0] || '';
      return {
        'Customer Name': l.name,
        'Phone': l.phone,
        'Occupation': l.occupation,
        'Interest': l.interest,
        'Status': l.status,
        'Plot': l.plot || '',
        'Sale Price': l.salePrice || '',
        'Land Price': l.landOfficePrice || '',
        'Sales Agent': l.agentName,
        'Visit Date': l.visitDate || '',
        'Booking Date': l.bookingDate || '',
        'Transfer Date': transferDate,
        'Cancel Date': cancelDate
      };
    });

    const ws = XLSX.utils.json_to_sheet(exportRows.length > 0 ? exportRows : [{
      'Customer Name': '', 'Phone': '', 'Occupation': '', 'Interest': '', 'Status': '', 'Plot': '', 'Sale Price': '', 'Land Price': '', 'Sales Agent': '', 'Visit Date': '', 'Booking Date': '', 'Transfer Date': '', 'Cancel Date': ''
    }]);
    
    const guideWs = XLSX.utils.json_to_sheet([
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Visit', 'ความหมาย': 'เยี่ยมชมโครงการ (ค่าเริ่มต้น)' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Negotiation', 'ความหมาย': 'กำลังเจรจา' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Reserved', 'ความหมาย': 'จองแล้ว' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Contracted', 'ความหมาย': 'ทำสัญญาแล้ว' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'DownPayment', 'ความหมาย': 'ผ่อนดาวน์' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'DocumentPrep', 'ความหมาย': 'เตรียมเอกสาร' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'LoanProcessing', 'ความหมาย': 'ยื่นกู้' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Approved', 'ความหมาย': 'อนุมัติแล้ว' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Transferred', 'ความหมาย': 'โอนกรรมสิทธิ์' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Handover', 'ความหมาย': 'รับมอบบ้าน' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Cancelled', 'ความหมาย': 'ยกเลิก' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': '---', 'ความหมาย': '---' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Sale Price', 'ความหมาย': 'ราคาขายสุทธิ (ตัวเลขเท่านั้น เช่น 3500000)' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Land Price', 'ความหมาย': 'ราคาประเมินที่ดิน/กรมที่ดิน (ตัวเลขเท่านั้น)' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Sales Agent', 'ความหมาย': 'ชื่อพนักงานขายที่ดูแลลูกค้า' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Visit Date', 'ความหมาย': 'วันที่เยี่ยมชม (ถ้าไม่ระบุ ระบบจะใช้วันที่ปัจจุบัน)' },
      { 'Status (ภาษาอังกฤษเท่านั้น)': 'Plot (แปลงบ้าน)', 'ความหมาย': projectPlots.length > 0 ? \`แปลงที่มีในโครงการ: \${projectPlots.join(', ')}\` : 'โปรดระบุชื่อแปลงให้ตรงกับในระบบ' },
    ]);
    
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    XLSX.utils.book_append_sheet(wb, guideWs, 'Guide');
    XLSX.writeFile(wb, \`Sales_Export_\${project?.name || 'Project'}_\${new Date().toISOString().split('T')[0]}.xlsx\`);
  };

  const handleConfirmImport = async () => {`;

code = code.replace(`  const handleConfirmImport = async () => {`, exportCode);

const importRegex = /const handleConfirmImport = async \(\) => \{[\s\S]*?setIsImporting\(false\);\s*\}\s*\};/m;

const newImportCode = `const handleConfirmImport = async () => {
    if (importData.length === 0) return;
    setIsImporting(true);
    const projName = project?.name || 'ไอลิน6';
    
    try {
      const validStatuses = ['Visit', 'Negotiation', 'Reserved', 'DownPayment', 'DocumentPrep', 'LoanProcessing', 'Approved', 'Contracted', 'Transferred', 'Handover', 'Cancelled'];
      
      let updatedCount = 0;
      let insertedCount = 0;

      for (const row of importData) {
        const rawStatus = row['Status']?.toString().trim();
        const status = validStatuses.includes(rawStatus) ? rawStatus : 'Visit';
        const visitDate = parseDateStr(row['Visit Date']) || new Date().toISOString();
        const customerName = row['Customer Name']?.toString().trim() || 'Unknown';
        const phone = row['Phone']?.toString().trim() || '';
        const plotId = row['Plot']?.toString().trim() || null;
        
        const parseMoney = (val: any) => {
          if (val == null || val === '') return null;
          const numStr = val.toString().replace(/[^0-9.-]+/g,"");
          const num = Number(numStr);
          return isNaN(num) ? null : num;
        };
        
        const salePrice = parseMoney(row['Sale Price']);
        const landPrice = parseMoney(row['Land Price']);
        const bookingDate = parseDateStr(row['Booking Date']);
        const transferDate = parseDateStr(row['Transfer Date']);
        const cancelDate = parseDateStr(row['Cancel Date']);
        
        // Find if this lead already exists
        const existingLead = leads.find(l => 
          (plotId && l.plot === plotId) || 
          (l.name.toLowerCase() === customerName.toLowerCase() && l.phone === phone)
        );

        if (existingLead) {
          // UPDATE EXISTING LEAD
          await supabase.from('leads').update({
            customer_name: customerName,
            phone: phone,
            occupation: row['Occupation']?.toString() || '',
            interest: row['Interest']?.toString() || 'Any',
            status: status,
            agent_name: row['Sales Agent']?.toString() || existingLead.agentName || user?.username || 'Unknown'
          }).eq('id', existingLead.id);

          if (['Reserved', 'Contracted', 'DownPayment', 'DocumentPrep', 'LoanProcessing', 'Approved', 'Transferred', 'Handover', 'Cancelled'].includes(status)) {
            const contractStatus = status === 'Transferred' || status === 'Handover' ? 'Transferred' : (status === 'Contracted' || status === 'DownPayment' || status === 'DocumentPrep' || status === 'LoanProcessing' || status === 'Approved' ? 'Contracted' : (status === 'Cancelled' ? 'Cancelled' : 'Reserved'));
            
            // Check if sale exists
            const { data: existingSale } = await supabase.from('sales').select('id').eq('lead_id', existingLead.id).maybeSingle();
            
            const salePayload = {
              plot_id: plotId,
              sale_price: salePrice,
              land_office_price: landPrice,
              contract_status: contractStatus,
              ...(transferDate ? { transferred_at: transferDate } : {})
            };
            
            if (existingSale) {
              await supabase.from('sales').update(salePayload).eq('id', existingSale.id);
            } else {
              await supabase.from('sales').insert([{
                lead_id: existingLead.id,
                ...salePayload,
                bank_status: 'Pending',
                created_at: bookingDate || existingLead.created_at
              }]);
            }
          }
          
          if (status !== existingLead.status) {
             await supabase.from('status_history').insert([{
               entity_type: 'lead',
               entity_id: existingLead.id,
               old_status: existingLead.status,
               new_status: status,
               changed_by: (user?.username || 'Unknown') + ' (System Import Update)',
               created_at: transferDate || cancelDate || bookingDate || new Date().toISOString()
             }]);
          }
          updatedCount++;
        } else {
          // INSERT NEW LEAD
          const { data: newLeadsData } = await supabase.from('leads').insert([{
            project_name: projName,
            customer_name: customerName,
            phone: phone,
            occupation: row['Occupation']?.toString() || '',
            interest: row['Interest']?.toString() || 'Any',
            status: status,
            agent_name: row['Sales Agent']?.toString() || user?.username || 'Unknown',
            created_at: visitDate
          }]).select();
          
          if (newLeadsData && newLeadsData.length > 0) {
            const newLead = newLeadsData[0];
            if (['Reserved', 'Contracted', 'DownPayment', 'DocumentPrep', 'LoanProcessing', 'Approved', 'Transferred', 'Handover', 'Cancelled'].includes(status)) {
              await supabase.from('sales').insert([{
                lead_id: newLead.id,
                plot_id: plotId,
                sale_price: salePrice,
                land_office_price: landPrice,
                contract_status: status === 'Transferred' || status === 'Handover' ? 'Transferred' : (status === 'Contracted' || status === 'DownPayment' || status === 'DocumentPrep' || status === 'LoanProcessing' || status === 'Approved' ? 'Contracted' : (status === 'Cancelled' ? 'Cancelled' : 'Reserved')),
                bank_status: 'Pending',
                created_at: bookingDate || newLead.created_at,
                transferred_at: transferDate || null
              }]);
            }
            insertedCount++;
          }
        }
      }

      await fetchData();
      setShowImportModal(false);
      setImportData([]);
      alert(\`นำเข้าข้อมูลสำเร็จ: อัปเดตข้อมูลเดิม \${updatedCount} รายการ, เพิ่มข้อมูลใหม่ \${insertedCount} รายการ\`);
    } catch (err) {
      console.error("Error importing data:", err);
      alert("เกิดข้อผิดพลาดในการนำเข้าข้อมูล โปรดลองอีกครั้ง");
    } finally {
      setIsImporting(false);
    }
  };`;

code = code.replace(importRegex, newImportCode);

// update onClick for Export button
code = code.replace(
  /<button className="bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-semibold shadow-sm hover:bg-gray-50 transition-colors">\s*<Download size={18} \/>\s*Export\s*<\/button>/,
  \`<button onClick={handleExportData} className="bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-semibold shadow-sm hover:bg-gray-50 transition-colors">
            <Download size={18} />
            Export
          </button>\`
);

fs.writeFileSync(filePath, code);
console.log("Updated SalesKanban.tsx successfully!");
