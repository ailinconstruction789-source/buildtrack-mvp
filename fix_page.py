import os

file_path = r"d:\buildtrack\buildtrack-mvp-main\app\page.tsx"
with open(file_path, "r", encoding="utf-8") as f:
    lines = f.readlines()

new_lines = []
for line in lines:
    new_lines.append(line)
    if "<HouseDetailView" in line:
        new_lines.append(line[:line.find("<")] + "  contractors={contractors}\n")

with open(file_path, "w", encoding="utf-8") as f:
    f.writelines(new_lines)
print("Updated page.tsx with contractors")
