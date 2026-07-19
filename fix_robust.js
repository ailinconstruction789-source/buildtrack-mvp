const fs = require('fs');
const path = require('path');
const file = path.join('app', 'page.tsx');
let content = fs.readFileSync(file, 'utf8');

const targetBlock = `        const plotUpdates = allPlotUpdates
          .filter((u: any) => new Date(u.created_at).getTime() >= sevenDaysAgo.getTime())
          .map((u: any) => {
            let assign = assignments.find((a: any) => a.plot_id === u.plot_id && a.task_template_id === u.task_template_id);
            if (!assign && u.action) {
              assign = assignments.find((a: any) => a.plot_id === u.plot_id && a.task_name && (u.action === a.task_name || u.action.includes(a.task_name) || a.task_name.includes(u.action)));
            }
            const task = taskTemplates.find((t: any) => t.id === u.task_template_id);
            
            const finalTaskName = assign?.task_name || task?.task_name;
            const finalTaskId = assign?.task_template_id || task?.id || u.task_template_id;

            return finalTaskName && finalTaskId ? { ...u, action: finalTaskName, task_template_id: finalTaskId } : null;
          })
          .filter(Boolean);`;

const newBlock = `        const plotUpdates = allPlotUpdates
          .filter((u: any) => new Date(u.created_at).getTime() >= sevenDaysAgo.getTime())
          .map((u: any) => {
            let assign = assignments.find((a: any) => a.plot_id === u.plot_id && a.task_template_id === u.task_template_id);
            if (!assign && u.action) {
              assign = assignments.find((a: any) => a.plot_id === u.plot_id && a.task_name && (u.action === a.task_name || u.action.includes(a.task_name) || a.task_name.includes(u.action)));
            }
            
            let task = taskTemplates.find((t: any) => t.id === u.task_template_id);
            if (!task && u.action) {
              task = taskTemplates.find((t: any) => t.task_name && (u.action === t.task_name || u.action.includes(t.task_name) || t.task_name.includes(u.action)));
            }
            
            const finalTaskName = assign?.task_name || task?.task_name || u.action;
            const finalTaskId = assign?.task_template_id || task?.id || u.task_template_id || \`temp-\${u.id || Math.random()}\`;

            const exactChatActions = ['Site Engineer อนุมัติ', 'QC อนุมัติ', 'QC อนุมัติผ่าน', 'ส่งงาน', 'อัปเดตงาน', 'อัปเดตสถานะงาน', 'อัพเดตงาน', 'อัพเดตสถานะงาน', 'อัปเดทงาน', 'เข้าตรวจสอบ'];
            if (finalTaskName && exactChatActions.includes(finalTaskName.trim())) {
               return null; 
            }

            return { ...u, action: finalTaskName, task_template_id: finalTaskId };
          })
          .filter(Boolean);`;

content = content.replace(targetBlock, newBlock);
fs.writeFileSync(file, content, 'utf8');
console.log('Fixed robust mapping');
