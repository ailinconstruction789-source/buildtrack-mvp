import fs from 'fs';

const filePath = 'c:/Users/HUAWEI/Desktop/buildtrack/components/sales/SalesKanban.tsx';
let code = fs.readFileSync(filePath, 'utf8');

// 1. Pipeline (list) table
code = code.replace(
  /<th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Last Update<\/th>/,
  \`<th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Last Update</th>
                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Prices (Sale/Land)</th>\`
);

code = code.replace(
  /<td className="px-6 py-4">\s*<button onClick=\{\(\) => handleEditLeadClick\(lead\)\}/,
  \`<td className="px-6 py-4">
                              <div className="flex flex-col gap-1">
                                {lead.salePrice ? <div className="text-xs font-bold text-emerald-600">ขาย: ฿{Number(lead.salePrice).toLocaleString()}</div> : <div className="text-xs text-gray-400">ขาย: -</div>}
                                {lead.landOfficePrice ? <div className="text-xs font-bold text-blue-600">ท.ด.: ฿{Number(lead.landOfficePrice).toLocaleString()}</div> : <div className="text-xs text-gray-400">ท.ด.: -</div>}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <button onClick={() => handleEditLeadClick(lead)}\`
);

code = code.replace(
  /<td colSpan=\{5\} className="px-6 py-12 text-center text-gray-500">\s*No customers found matching your search\./,
  \`<td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                            No customers found matching your search.\`
);

// 2. Booked table
code = code.replace(
  /<th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">ธนาคาร \(Bank\)<\/th>/,
  \`<th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">ธนาคาร (Bank)</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">ราคา (Prices)</th>\`
);

code = code.replace(
  /<\/td>\s*<td className="px-6 py-4" onClick=\{\(e\) => e.stopPropagation\(\)\}>/,
  \`</td>
                            <td className="px-6 py-4">
                              <div className="flex flex-col gap-1">
                                {lead.salePrice ? <div className="text-xs font-bold text-emerald-600">ขาย: ฿{Number(lead.salePrice).toLocaleString()}</div> : <div className="text-xs text-gray-400">ขาย: -</div>}
                                {lead.landOfficePrice ? <div className="text-xs font-bold text-blue-600">ท.ด.: ฿{Number(lead.landOfficePrice).toLocaleString()}</div> : <div className="text-xs text-gray-400">ท.ด.: -</div>}
                              </div>
                            </td>
                            <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>\`
);

code = code.replace(
  /<td colSpan=\{5\} className="px-6 py-12 text-center text-gray-500">\s*ไม่พบข้อมูลลูกค้าที่มีการจอง/,
  \`<td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                            ไม่พบข้อมูลลูกค้าที่มีการจอง\`
);

// 3. Transferred table
code = code.replace(
  /<th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">ธนาคาร \(Bank\)<\/th>(?![\s\S]*<th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">ธนาคาร \(Bank\)<\/th>)/, // Match the second one (Transferred) which is now the last match before writing this... wait, I already replaced the first one. So it matches the second one.
  \`<th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">ธนาคาร (Bank)</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">ราคา (Prices)</th>\`
);

code = code.replace(
  /<td className="px-6 py-4">\s*<span className="text-sm font-semibold text-slate-700">\{transferredDate\}<\/span>\s*<\/td>/,
  \`<td className="px-6 py-4">
                              <div className="flex flex-col gap-1">
                                {lead.salePrice ? <div className="text-xs font-bold text-emerald-600">ขาย: ฿{Number(lead.salePrice).toLocaleString()}</div> : <div className="text-xs text-gray-400">ขาย: -</div>}
                                {lead.landOfficePrice ? <div className="text-xs font-bold text-blue-600">ท.ด.: ฿{Number(lead.landOfficePrice).toLocaleString()}</div> : <div className="text-xs text-gray-400">ท.ด.: -</div>}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className="text-sm font-semibold text-slate-700">{transferredDate}</span>
                            </td>\`
);

code = code.replace(
  /<td colSpan=\{5\} className="px-6 py-12 text-center text-gray-500">\s*ไม่พบข้อมูลลูกค้าที่โอนกรรมสิทธิ์แล้ว/,
  \`<td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                            ไม่พบข้อมูลลูกค้าที่โอนกรรมสิทธิ์แล้ว\`
);


fs.writeFileSync(filePath, code);
console.log("Updated tables in SalesKanban.tsx!");
