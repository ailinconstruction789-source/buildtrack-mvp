const fs = require('fs');
const pagePath = 'C:\\Users\\HUAWEI\\Desktop\\buildtrack\\app\\page.tsx';
let pageContent = fs.readFileSync(pagePath, 'utf8');

if (!pageContent.includes('handleTogglePlotCustomer={handleTogglePlotCustomer}')) {
    pageContent = pageContent.replace(
        /setCurrentSlideIndex=\{setCurrentSlideIndex\}\s*\/>/g,
        'setCurrentSlideIndex={setCurrentSlideIndex}\n                  handleTogglePlotCustomer={handleTogglePlotCustomer}\n                  handleTogglePlotCompleted={handleTogglePlotCompleted}\n                />'
    );
    fs.writeFileSync(pagePath, pageContent);
    console.log('Updated app/page.tsx successfully!');
} else {
    console.log('app/page.tsx already has the props.');
}
