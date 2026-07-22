const fs = require('fs');

let code = fs.readFileSync('app/page.tsx', 'utf8');

const checkboxHTML = `
                        <label className="flex items-center gap-2 cursor-pointer mt-2 bg-blue-50 p-3 rounded-xl border border-blue-100 hover:bg-blue-100 transition-colors">
                          <input 
                            type="checkbox" 
                            checked={houseTypeForm.is_infrastructure || false} 
                            onChange={(e) => setHouseTypeForm({ ...houseTypeForm, is_infrastructure: e.target.checked })}
                            className="w-4 h-4 text-rose-600 rounded focus:ring-rose-500"
                          />
                          <span className="text-xs font-bold text-slate-700">เป็นงานส่วนกลาง/สาธารณูปโภค (Infrastructure)</span>
                        </label>
`;

code = code.replace(/<textarea placeholder="คำอธิบายเพิ่มเติม..." value=\{houseTypeForm\.memo\}(.*?)\/>\s*<\/div>\s*<div className="flex gap-2 pt-2">/s, '<textarea placeholder="คำอธิบายเพิ่มเติม..." value={houseTypeForm.memo}$1/>\n                        </div>\n' + checkboxHTML + '                        <div className="flex gap-2 pt-2">');

fs.writeFileSync('app/page.tsx', code);
console.log('UI updated');
