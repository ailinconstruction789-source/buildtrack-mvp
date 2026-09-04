import os

file_path = r'd:\buildtrack\buildtrack-mvp-main\components\HouseHandoverView.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('if (fetchAllData) fetchAllData();', 'if (fetchAllData) await fetchAllData();')

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Updated HouseHandoverView.tsx to await fetchAllData')
