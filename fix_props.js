const fs = require('fs');

// 1. Fix HouseDetailView
let houseCode = fs.readFileSync('components/HouseDetailView.tsx', 'utf-8');
if (!houseCode.includes('import { supabase }')) {
    houseCode = houseCode.replace(
        "import React from 'react';",
        "import React from 'react';\nimport { supabase } from '@/lib/supabase';"
    );
}

const housePropsMissing = [
    'totalChartDays', 'taskDates', 'setUpdates', 'setProgressValue',
    'isAdmin', 'isProcurement', 'setScheduleInputs', 'timeMarkers',
    'todayTs', 'chartStart', 'chartEnd', 'getChartLeft', 'getChartWidth'
];

let destructureMatch = houseCode.match(/const \{([\s\S]*?)\} = props;/);
if (destructureMatch) {
    let destructure = destructureMatch[1];
    housePropsMissing.forEach(p => {
        if (!destructure.includes(p)) {
            destructure += ', ' + p;
        }
    });
    houseCode = houseCode.replace(destructureMatch[1], destructure);
}
fs.writeFileSync('components/HouseDetailView.tsx', houseCode);


// 2. Fix TaskProgressView
let taskCode = fs.readFileSync('components/TaskProgressView.tsx', 'utf-8');
if (!taskCode.includes(', X')) {
    taskCode = taskCode.replace('Trash2', 'Trash2, X');
}

const taskPropsMissing = [
    'isTaskCompleted', 'handleOpenExportModal', 'setDefectModal', 'defects',
    'loggedInUser', 'isLockedForForeman', 'isSiteEngineer', 'isPendingSE',
    'handleReviewAction', 'isQC', 'isPendingQC', 'isProcurement', 'isOwner',
    'handleSendPost'
];

let taskDestructureMatch = taskCode.match(/const \{([\s\S]*?)\} = props;/);
if (taskDestructureMatch) {
    let destructure = taskDestructureMatch[1];
    taskPropsMissing.forEach(p => {
        if (!destructure.includes(p)) {
            destructure += ', ' + p;
        }
    });
    taskCode = taskCode.replace(taskDestructureMatch[1], destructure);
}
fs.writeFileSync('components/TaskProgressView.tsx', taskCode);


// 3. Update page.tsx component calls
let pageCode = fs.readFileSync('app/page.tsx', 'utf-8');

// Update HouseDetailView props
let houseCallMatch = pageCode.match(/<HouseDetailView[\s\S]*?\/>/);
if (houseCallMatch) {
    let callStr = houseCallMatch[0];
    callStr = callStr.replace('/>', 
        housePropsMissing.map(p => \`\${p}={\${p}}\`).join(' ') + '\n                 />'
    );
    pageCode = pageCode.replace(houseCallMatch[0], callStr);
}

// Update TaskProgressView props
let taskCallMatch = pageCode.match(/<TaskProgressView[\s\S]*?\/>/);
if (taskCallMatch) {
    let callStr = taskCallMatch[0];
    callStr = callStr.replace('/>', 
        taskPropsMissing.map(p => \`\${p}={\${p}}\`).join(' ') + '\n                 />'
    );
    pageCode = pageCode.replace(taskCallMatch[0], callStr);
}

fs.writeFileSync('app/page.tsx', pageCode);
console.log("Props fixed.");
