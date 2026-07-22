const fs = require('fs');

let code = fs.readFileSync('app/page.tsx', 'utf8');

// 1. Initial State for houseTypeForm
code = code.replace(/setHouseTypeForm\(\{ id: '', type_name: '', memo: '' \}\)/g, "setHouseTypeForm({ id: '', type_name: '', memo: '', is_infrastructure: false })");

// 2. Insert and Update Payload
code = code.replace(/type_name: houseTypeForm.type_name.trim\(\), memo: houseTypeForm.memo \}/g, "type_name: houseTypeForm.type_name.trim(), memo: houseTypeForm.memo, is_infrastructure: houseTypeForm.is_infrastructure }");

// 3. Edit Existing Type mapping
code = code.replace(/setHouseTypeForm\(\{ id: t.id, type_name: t.type_name, memo: t.memo \|\| '' \}\);/g, "setHouseTypeForm({ id: t.id, type_name: t.type_name, memo: t.memo || '', is_infrastructure: t.is_infrastructure || false });");

// 4. Pass houseTypes to MapVisualizer
code = code.replace(/isSubmitting=\{isSubmitting\} taskTemplates=\{taskTemplates\}/, "isSubmitting={isSubmitting} houseTypes={houseTypes} taskTemplates={taskTemplates}");

fs.writeFileSync('app/page.tsx', code);
console.log('updated page.tsx');
