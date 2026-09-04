import os

page_path = r'd:\buildtrack\buildtrack-mvp-main\app\page.tsx'

with open(page_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

in_house_detail = False
for i, line in enumerate(lines):
    if '<HouseDetailView' in line:
        in_house_detail = True
    
    if in_house_detail and 'setSelectedTask={setSelectedTask}' in line:
        lines[i] = line.replace('setSelectedTask={setSelectedTask}', 'setSelectedTask={setSelectedTask} setSelectedDefect={setSelectedDefect} setDefectReturnView={setDefectReturnView}')
        in_house_detail = False # We patched it, so stop

with open(page_path, 'w', encoding='utf-8') as f:
    f.writelines(lines)
    
print("Patched page.tsx successfully")
