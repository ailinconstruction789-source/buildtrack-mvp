const fs = require('fs');
const mapVisPath = 'C:\\Users\\HUAWEI\\Desktop\\buildtrack\\components\\MapVisualizer.tsx';
let mapVisContent = fs.readFileSync(mapVisPath, 'utf8');

if (!mapVisContent.includes('handleTogglePlotCustomer,')) {
    mapVisContent = mapVisContent.replace(
        /setCurrentSlideIndex\s*\}\s*=\s*props;/g,
        'setCurrentSlideIndex,\n    handleTogglePlotCustomer,\n    handleTogglePlotCompleted\n  } = props;'
    );
    fs.writeFileSync(mapVisPath, mapVisContent);
    console.log('Fixed MapVisualizer.tsx destructuring!');
} else {
    console.log('Already destructured.');
}
