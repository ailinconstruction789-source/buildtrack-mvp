const fs = require('fs');
let content = fs.readFileSync('hooks/useBuildTrackData.ts', 'utf8');

const targetStr = "supabase.from('vw_inspection_queue').select('*')";
const replaceStr = "supabase.from('vw_inspection_queue').select('*'),\n        supabase.from('vw_plot_status_dashboard').select('*')";

if (content.includes(targetStr) && !content.includes("supabase.from('vw_plot_status_dashboard').select('*')")) {
    content = content.replace(targetStr, replaceStr);
    fs.writeFileSync('hooks/useBuildTrackData.ts', content, 'utf8');
    console.log("Successfully updated Promise.all in useBuildTrackData.");
} else {
    console.log("vw_plot_status_dashboard already present or target string not found.");
}
