import os

file_path = r'd:\buildtrack\buildtrack-mvp-main\app\page.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if '<HouseDetailView updateInspectionRound={updateInspectionRound} resetHandoverCycle={resetHandoverCycle} fetchAllData={fetchAllData}' in line:
        lines[i] = line.replace(
            '<HouseDetailView updateInspectionRound={updateInspectionRound} resetHandoverCycle={resetHandoverCycle} fetchAllData={fetchAllData}',
            '<HouseDetailView updateInspectionRound={updateInspectionRound} resetHandoverCycle={resetHandoverCycle} fetchAllData={fetchAllData} defects={defects} setDefects={setDefects}'
        )

with open(file_path, 'w', encoding='utf-8') as f:
    f.writelines(lines)
print('Injected defects into HouseDetailView in page.tsx')
