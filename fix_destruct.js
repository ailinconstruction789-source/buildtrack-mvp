const fs = require('fs');
let content = fs.readFileSync('app/page.tsx', 'utf8');

const regex = /inspectionQueueView \} = useBuildTrackData/;
if (regex.test(content)) {
    content = content.replace(regex, "inspectionQueueView, plotStatuses } = useBuildTrackData");
    fs.writeFileSync('app/page.tsx', content, 'utf8');
    console.log("Fixed page.tsx destructuring.");
} else {
    console.log("Failed to find.");
}
