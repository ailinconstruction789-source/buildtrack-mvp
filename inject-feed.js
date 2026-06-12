const fs = require('fs');

const pageFile = 'app/page.tsx';
let pageContent = fs.readFileSync(pageFile, 'utf8');
const lines = pageContent.split('\n');

const replacementStr = `              {/* 📜 🌟 View: Global Timeline Feed */}
              <GlobalTimelineFeed
                view={view}
                allUpdatesRecord={allUpdatesRecord}
                taskTemplates={taskTemplates}
                plots={plots}
                visibleFeedCount={visibleFeedCount}
                observerTargetRef={observerTargetRef}
                setFullImageUrl={setFullImageUrl}
              />`;

// Remove lines 1478 to 1592 (indices 1477 to 1591)
lines.splice(1477, 1592 - 1477 + 1, replacementStr);

const importStr = "import GlobalTimelineFeed from '@/components/GlobalTimelineFeed';";
if (!lines.includes(importStr)) {
  lines.splice(8, 0, importStr);
}

fs.writeFileSync(pageFile, lines.join('\n'), 'utf8');
console.log('Injected GlobalTimelineFeed into app/page.tsx');
