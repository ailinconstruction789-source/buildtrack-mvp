const fs = require('fs');

const targetFile = 'app/page.tsx';
let content = fs.readFileSync(targetFile, 'utf8');

const startStr = "<div className={`${isMobilePreview ? 'w-[390px] h-[844px] bg-background border-[14px]";
const startIndex = content.indexOf(startStr);

const endStr = "{/* 📜 🌟 View: Global Timeline Feed";
let endIndex = content.indexOf(endStr);
if (endIndex === -1) {
    console.error("Could not find endIndex");
    process.exit(1);
}

// Find the <div className="w-full"> right before endStr to preserve it properly.
// In the original file:
//           <main className={`flex-1 overflow-y-auto custom-scrollbar ${isMobileLayout ? 'p-3 pb-24' : 'px-8 py-8 pb-12'} scroll-smooth relative bg-background`}>
//             <div className="w-full">
//               {/* 📜 🌟 View: Global Timeline Feed

const newShell = `      <div className={\`\${isMobilePreview ? 'w-[390px] h-[844px] bg-background border-[14px] border-outline rounded-[3rem] shadow-elevation-3 relative overflow-hidden flex flex-col' : 'flex h-screen w-full overflow-hidden'} print:hidden\`}>
        
        {/* SideNavBar (Desktop) */}
        {!isMobileLayout && (
          <aside className={\`\${isMobilePreview ? 'absolute' : 'fixed'} hidden md:flex flex-col bg-surface-container-low dark:bg-surface-container-low left-0 top-0 h-full w-64 z-40 border-r border-outline-variant pt-20 pb-md px-base transition-all duration-300\`}>
            <div className="px-sm mb-lg">
              <h2 className="text-headline-lg font-headline-lg font-bold text-primary cursor-pointer" onClick={() => setView('dashboard')}>ConstructMaster AI</h2>
            </div>
            
            <div className="px-sm mb-md flex items-center gap-sm">
              <div className="w-10 h-10 rounded-full bg-surface-variant flex items-center justify-center overflow-hidden shrink-0 text-on-surface font-black text-xl border border-outline-variant">
                {loggedInUser?.username?.charAt(0) || 'U'}
              </div>
              <div className="overflow-hidden">
                <h3 className="font-body-md text-body-md font-bold text-on-surface truncate">{loggedInUser?.username || 'User'}</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant truncate">
                  {isAdmin ? 'Admin' : isQC ? 'QC' : isSiteEngineer ? 'Site Engineer' : isProjectPlanner ? 'Planner' : isProcurement ? 'Procurement' : 'Foreman'}
                </p>
              </div>
            </div>

            <button onClick={() => alert('ฟีเจอร์นี้จะเปิดให้ใช้งานในอนาคต')} className="mx-sm mb-lg bg-secondary-container text-on-secondary-container hover:opacity-90 transition-opacity rounded-xl py-xs px-sm flex items-center justify-center gap-base font-body-sm text-body-sm font-bold shadow-sm">
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>add</span>
              Start Inspection
            </button>

            <nav className="flex-1 overflow-y-auto px-base space-y-base custom-scrollbar">
              <button onClick={() => setView('dashboard')} className={\`w-full flex items-center gap-sm px-sm py-xs font-bold rounded-xl transition-all duration-200 \${view === 'dashboard' ? 'bg-secondary-container text-on-secondary-container shadow-sm' : 'text-on-surface-variant hover:text-primary hover:bg-surface-variant/50'}\`}>
                <span className="material-symbols-outlined">dashboard</span>
                <span className="font-label-caps text-label-caps uppercase">Dashboard</span>
              </button>
              
              <button onClick={() => setView('reports')} className={\`w-full flex items-center gap-sm px-sm py-xs font-bold rounded-xl transition-all duration-200 \${view === 'reports' ? 'bg-secondary-container text-on-secondary-container shadow-sm' : 'text-on-surface-variant hover:text-primary hover:bg-surface-variant/50'}\`}>
                <span className="material-symbols-outlined">map</span>
                <span className="font-label-caps text-label-caps uppercase">Master Plan</span>
              </button>

              <button onClick={() => alert('ฟีเจอร์นี้จะเปิดให้ใช้งานในอนาคต')} className={\`w-full flex items-center gap-sm px-sm py-xs font-bold rounded-xl transition-all duration-200 text-on-surface-variant hover:text-primary hover:bg-surface-variant/50\`}>
                <span className="material-symbols-outlined">assignment</span>
                <span className="font-label-caps text-label-caps uppercase">Tasks</span>
              </button>

              <button onClick={() => setView('defects')} className={\`w-full flex items-center gap-sm px-sm py-xs font-bold rounded-xl transition-all duration-200 \${view === 'defects' ? 'bg-secondary-container text-on-secondary-container shadow-sm' : 'text-on-surface-variant hover:text-primary hover:bg-surface-variant/50'}\`}>
                <span className="material-symbols-outlined">fact_check</span>
                <span className="font-label-caps text-label-caps uppercase">Inspections</span>
              </button>

              {isAdmin && (
                <button onClick={() => setView('admin-project')} className={\`w-full flex items-center gap-sm px-sm py-xs font-bold rounded-xl transition-all duration-200 \${view.startsWith('admin') ? 'bg-error-container text-on-error-container shadow-sm' : 'text-on-surface-variant hover:text-primary hover:bg-surface-variant/50'}\`}>
                  <span className="material-symbols-outlined">event_note</span>
                  <span className="font-label-caps text-label-caps uppercase">Planning</span>
                </button>
              )}

              {(isAdmin || isProcurement) && (
                <button onClick={() => setView('procurement-contractors')} className={\`w-full flex items-center gap-sm px-sm py-xs font-bold rounded-xl transition-all duration-200 \${view === 'procurement-contractors' ? 'bg-tertiary-container text-on-tertiary-container shadow-sm' : 'text-on-surface-variant hover:text-primary hover:bg-surface-variant/50'}\`}>
                  <span className="material-symbols-outlined">engineering</span>
                  <span className="font-label-caps text-label-caps uppercase">Contractors</span>
                </button>
              )}
            </nav>

            <div className="mt-auto px-base space-y-base pt-sm border-t border-outline-variant">
              {isAdmin && (
                <button onClick={() => setIsMobilePreview(!isMobilePreview)} className="w-full flex items-center gap-sm px-sm py-xs text-on-surface-variant hover:text-primary hover:bg-surface-variant/50 transition-all duration-200 rounded-xl">
                  <span className="material-symbols-outlined">smartphone</span>
                  <span className="font-label-caps text-label-caps uppercase">Mobile Preview</span>
                </button>
              )}
              <button onClick={() => alert('ฟีเจอร์นี้จะเปิดให้ใช้งานในอนาคต')} className="w-full flex items-center gap-sm px-sm py-xs text-on-surface-variant hover:text-primary hover:bg-surface-variant/50 transition-all duration-200 rounded-xl">
                <span className="material-symbols-outlined">settings</span>
                <span className="font-label-caps text-label-caps uppercase">Settings</span>
              </button>
              <button onClick={() => alert('ฟีเจอร์นี้จะเปิดให้ใช้งานในอนาคต')} className="w-full flex items-center gap-sm px-sm py-xs text-on-surface-variant hover:text-primary hover:bg-surface-variant/50 transition-all duration-200 rounded-xl">
                <span className="material-symbols-outlined">contact_support</span>
                <span className="font-label-caps text-label-caps uppercase">Support</span>
              </button>
              <button onClick={handleLogout} className="w-full flex items-center gap-sm px-sm py-xs text-error hover:bg-error-container hover:text-error transition-all duration-200 rounded-xl">
                <span className="material-symbols-outlined">logout</span>
                <span className="font-label-caps text-label-caps uppercase">Logout</span>
              </button>
            </div>
          </aside>
        )}

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col md:ml-64 h-full relative">
          
          {/* TopAppBar */}
          <header className={\`bg-surface-container-lowest dark:bg-surface-container-lowest \${isMobilePreview ? 'absolute' : 'fixed'} top-0 w-full md:w-[calc(100%-16rem)] z-50 flex justify-between items-center px-gutter h-16 border-b border-outline-variant dark:border-outline-variant\`}>
            
            <div className="flex items-center gap-sm md:hidden">
              <span className="material-symbols-outlined text-primary cursor-pointer" onClick={() => alert('ฟีเจอร์นี้จะเปิดให้ใช้งานในอนาคต')}>menu</span>
              <h1 className="text-headline-lg-mobile font-headline-lg-mobile font-bold text-primary ml-2">ConstructMaster AI</h1>
            </div>

            <div className="hidden md:flex items-center gap-lg">
              <h1 className="text-headline-lg font-headline-lg font-bold text-primary capitalize">
                {view === 'dashboard' ? 'Overview' : view.replace('-', ' ')}
              </h1>
            </div>

            <div className="flex items-center gap-sm">
              <div className="hidden md:flex items-center bg-surface-container-low rounded-full px-sm py-xs border border-outline-variant focus-within:border-primary transition-colors">
                <span className="material-symbols-outlined text-on-surface-variant mr-xs">search</span>
                <input className="bg-transparent border-none focus:ring-0 text-body-sm font-body-sm w-48 text-on-surface placeholder-on-surface-variant outline-none" placeholder="Search projects, tasks..." type="text" />
              </div>
              
              <div className="relative">
                <button onClick={() => setShowNotifs(!showNotifs)} className="p-xs text-on-surface-variant hover:bg-surface-container-low rounded-full transition-colors duration-200 relative">
                  <span className="material-symbols-outlined">notifications</span>
                  {unreadNotifs.length > 0 && <span className="absolute top-1 right-1 w-2 h-2 bg-secondary-container rounded-full border border-surface-container-lowest"></span>}
                </button>
                
                {/* 🔽 Dropdown Notifications */}
                {showNotifs && (
                  <div className="absolute top-12 right-0 w-80 sm:w-96 bg-surface border-outline text-on-surface animate-in slide-in-from-top-2 rounded-xl shadow-elevation-3 overflow-hidden border">
                    <div className="p-4 bg-surface-container-low border-b border-outline-variant flex justify-between items-center">
                      <h3 className="font-black italic text-lg text-primary">Notifications</h3>
                      <span className="text-xs font-bold text-on-surface-variant">{unreadNotifs.length} Unread</span>
                    </div>
                    <div className="max-h-[60vh] overflow-y-auto custom-scrollbar">
                      {notifications.length === 0 ? (
                        <div className="p-8 text-center text-on-surface-variant text-sm font-bold flex flex-col items-center gap-2">
                          <span className="material-symbols-outlined text-4xl opacity-20">notifications_off</span> 
                          ไม่มีการแจ้งเตือน
                        </div>
                      ) : (
                        notifications.map(n => (
                          <div key={n.id} onClick={() => handleNotifClick(n)} className={\`p-4 border-b border-outline-variant cursor-pointer hover:bg-surface-container transition-colors \${n.is_read ? 'opacity-60 bg-surface-container-lowest' : 'bg-error-container/20'}\`}>
                            <div className="flex justify-between items-start mb-1 gap-2">
                              <span className="text-[10px] font-black uppercase text-error tracking-widest bg-error-container px-2 py-0.5 rounded shrink-0">{n.plot_id}</span>
                              <span className="text-[10px] text-on-surface-variant font-bold whitespace-nowrap">
                                {new Date(n.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} • {new Date(n.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <p className="text-sm font-bold text-on-surface leading-snug mt-2">{n.message}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              <button onClick={() => alert('ฟีเจอร์นี้จะเปิดให้ใช้งานในอนาคต')} className="p-xs text-on-surface-variant hover:bg-surface-container-low rounded-full transition-colors duration-200">
                <span className="material-symbols-outlined">help</span>
              </button>
              
              <button onClick={() => alert('ฟีเจอร์นี้จะเปิดให้ใช้งานในอนาคต')} className="p-xs text-on-surface-variant hover:bg-surface-container-low rounded-full transition-colors duration-200">
                <span className="material-symbols-outlined">account_circle</span>
              </button>
            </div>
          </header>

          {/* Scrollable Content */}
          <main className="flex-1 overflow-y-auto pt-20 pb-lg px-margin-mobile md:px-margin-desktop bg-background custom-scrollbar">
            <div className="w-full mx-auto max-w-[1600px] space-y-md pb-12">
              `;

const beforeStr = content.substring(0, startIndex);
const afterStr = content.substring(endIndex);

const result = beforeStr + newShell + afterStr;

fs.writeFileSync(targetFile, result);
console.log("Shell replaced successfully.");
