import os

file_path = r"d:\buildtrack\buildtrack-mvp-main\components\HouseDetailView.tsx"
with open(file_path, "r", encoding="utf-8") as f:
    lines = f.readlines()

new_lines = []
found_interface = False
for line in lines:
    if "interface HouseDetailViewProps {" in line:
        found_interface = True
    if found_interface and "}" in line:
        new_lines.append("  contractors?: any[];\n")
        found_interface = False
    new_lines.append(line)

with open(file_path, "w", encoding="utf-8") as f:
    f.writelines(new_lines)
print("Added contractors to HouseDetailViewProps")
