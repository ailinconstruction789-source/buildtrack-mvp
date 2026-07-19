const fs = require('fs');
let code = fs.readFileSync('components/sales/SalesKanban.tsx', 'utf8');

// The activeTab map opening
const mapRegex = /\{\/\* MAP VIEW TAB \*\/\}\s*\{activeTab === 'map' && \(\s*<div className="h-full bg-white rounded-2xl shadow-\[0_4px_24px_rgba\(0,0,0,0\.02\)\] border border-gray-100 flex overflow-hidden relative">\s*<div className="flex-1 h-full relative min-w-0">\s*<SalesMap leads=\{leads\} projectName=\{project\?\.name \|\| 'äÍÅÔ¹6'\} onPlotClick=\{handlePlotClick\} \/>\s*<\/div>/;

code = code.replace(mapRegex, \
        {/* GLOBAL WRAPPER */}
        <div className="h-full bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.02)] border border-gray-100 flex overflow-hidden relative">
          <div className="flex-1 h-full relative min-w-0 flex flex-col">
            {/* MAP VIEW TAB */}
            {activeTab === 'map' && (
              <SalesMap leads={leads} projectName={project?.name || 'äÍÅÔ¹6'} onPlotClick={handlePlotClick} />
            )}
\);

// Find the end of Side Panel
// It ends with:
//               </div>
//             </div>
//           </div>
//         )}
//         {/* LIST VIEW TAB (CRM Table) */}
// We want to replace it with:
//               </div>
//             </div>
//           </div>
//         </div>
// But wait, the tabs are currently BELOW the side panel.
// Let's just extract all the other tabs and put them inside the flex-1 div!
// The other tabs start at {/* LIST VIEW TAB (CRM Table) */} and end before {/* ?? Full Screen Image Modal ?? */}

const tabsRegex = /\{\/\* LIST VIEW TAB \(CRM Table\) \*\/\}[\s\S]*?(?=\{\/\* ?? Full Screen Image Modal ?? \*\/\})/;
const tabsMatch = code.match(tabsRegex);

if (tabsMatch) {
  const tabsContent = tabsMatch[0];
  
  // Remove the old tabs from the bottom
  code = code.replace(tabsRegex, '');
  
  // Also remove the old map wrapper closing
  // 943:               </div>
  // 944:             </div>
  // 945:           </div>
  // 946:         )}
  const mapCloseRegex = /<\/div>\s*<\/div>\s*<\/div>\s*\)\}\s*(?=\{\/\* ?? Full Screen Image Modal ?? \*\/\}|$)/;
  // Actually, wait, it's easier to just find the marker we placed:
  // "            {/* OTHER TABS WILL BE MOVED HERE VIA JAVASCRIPT TO BE SAFE */}"
  // No, I didn't place a marker. I'll just put the tabs right after the activeTab === 'map' block.

  const insertPoint = code.indexOf('onPlotClick={handlePlotClick} />\n            )}');
  if (insertPoint !== -1) {
    const afterInsertPoint = insertPoint + 'onPlotClick={handlePlotClick} />\n            )}'.length;
    
    // We need to strip out the extraneous wrappers from the individual tabs so they fit nicely
    let cleanTabs = tabsContent;
    cleanTabs = cleanTabs.replace(/<div className="h-full bg-white rounded-2xl shadow-\[0_4px_24px_rgba\(0,0,0,0\.02\)\] border border-gray-100 flex flex-col overflow-hidden">/g, '<div className="h-full flex flex-col overflow-hidden">');
    cleanTabs = cleanTabs.replace(/<div className="h-full bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col animate-in fade-in slide-in-from-bottom-2">/g, '<div className="h-full flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-2">');

    // Insert tabs
    code = code.slice(0, afterInsertPoint) + '\n\n' + cleanTabs + '\n          </div> {/* End Tab Content */}\n' + code.slice(afterInsertPoint);
    
    // Now replace the old map wrapper closing. It is just before the Modal.
    // Wait, the old map wrapper closing was:
    //               </div>
    //             </div>
    //           </div>
    //         )}
    // Since we removed the ")}", we just need to replace the last ")} " with "</div>" for the global wrapper.
    // Let's just do a string replace for the specific block.
    const closingBlock = \              </div>
            </div>
          </div>
        )}\;
    const newClosingBlock = \              </div>
            </div>
        </div>\; // Close the Side panel and the Global Wrapper
    code = code.replace(closingBlock, newClosingBlock);

    fs.writeFileSync('components/sales/SalesKanban.tsx', code);
    console.log('Successfully moved tabs.');
  } else {
    console.log('Failed to find insert point.');
  }
} else {
  console.log('Failed to match tabs.');
}
