import os

file_path = r'd:\buildtrack\buildtrack-mvp-main\app\page.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if '<HouseDetailView updateInspectionRound={updateInspectionRound} resetHandoverCycle={resetHandoverCycle}' in line:
        # Check if the next few lines have fetchAllData
        # Actually just insert it here
        lines[i] = line.replace('<HouseDetailView updateInspectionRound={updateInspectionRound} resetHandoverCycle={resetHandoverCycle}', '<HouseDetailView updateInspectionRound={updateInspectionRound} resetHandoverCycle={resetHandoverCycle} fetchAllData={fetchAllData}')

with open(file_path, 'w', encoding='utf-8') as f:
    f.writelines(lines)
print('fetchAllData injected to HouseDetailView in page.tsx')
