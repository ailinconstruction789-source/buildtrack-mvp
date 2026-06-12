const fs = require('fs');

const file = 'app/page.tsx';
let content = fs.readFileSync(file, 'utf8');

// Replace standard alerts we added with the modal
content = content.replace(/alert\('ฟีเจอร์นี้เปิดใช้งานอนาคต'\)/g, 'setFutureFeatureModalOpen(true)');
content = content.replace(/alert\('ฟีเจอร์สำหรับอนาคต'\)/g, 'setFutureFeatureModalOpen(true)');

fs.writeFileSync(file, content, 'utf8');
console.log('Replaced alerts successfully');
