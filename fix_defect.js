const fs = require('fs');
const path = require('path');
const file = path.join('app', 'page.tsx');
let content = fs.readFileSync(file, 'utf8');

const badBlock = `              <div className="flex gap-4 sm:gap-8 text-right">
                <div>
                  <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">แผน (Plan)</p>
                  <div className="text-3xl sm:text-4xl font-black text-slate-400 tracking-tighter">{statusInfo.planned}%</div>
                </div>
                <div>
                  <p className="text-xs sm:text-sm font-bold text-slate-400 uppercase tracking-widest mb-1">ทำจริง (Actual)</p>
                  <div className="text-5xl sm:text-6xl font-black text-blue-600 tracking-tighter">{statusInfo.actual}%</div>
                </div>
              </div>`;

content = content.replace(badBlock, '');
fs.writeFileSync(file, content, 'utf8');
console.log("Fixed defect modal");
