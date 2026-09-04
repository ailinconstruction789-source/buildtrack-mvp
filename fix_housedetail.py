import os

file_path = r"d:\buildtrack\buildtrack-mvp-main\components\HouseDetailView.tsx"
with open(file_path, "r", encoding="utf-8") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "export interface HouseDetailViewProps {" in line:
        # Find where the interface ends and add contractors?: any[];
        for j in range(i, i+50):
            if "}" in lines[j]:
                lines.insert(j, "  contractors?: any[];\n")
                break
        break

for i, line in enumerate(lines):
    if "isUploadingLayer, simulatedStatus, editingHouseType" in line:
        # This is where props are extracted. Let's add contractors.
        lines[i] = line.replace("isUploadingLayer,", "isUploadingLayer, contractors,")
        break

with open(file_path, "w", encoding="utf-8") as f:
    f.writelines(lines)
print("Updated HouseDetailView.tsx props")
