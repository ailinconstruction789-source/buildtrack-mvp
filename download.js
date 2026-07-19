const fs = require('fs');
const https = require('https');

const data = JSON.parse(fs.readFileSync('C:/Users/HUAWEI/.gemini/antigravity/brain/b6522a02-f6ef-4f7d-9f3c-c99d70db137e/.system_generated/steps/3285/output.txt', 'utf8'));

if (!fs.existsSync('stitch-screens')) fs.mkdirSync('stitch-screens');

data.screens.forEach(s => {
    if (s.htmlCode && s.htmlCode.downloadUrl) {
        https.get(s.htmlCode.downloadUrl, res => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                const filename = `stitch-screens/${s.title.replace(/[^a-zA-Z0-9]/g, '_')}.html`;
                fs.writeFileSync(filename, body);
                console.log('Downloaded:', filename);
            });
        });
    }
});
