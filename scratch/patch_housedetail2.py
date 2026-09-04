import os

file_path = r"app\page.tsx"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

old = """                  <HouseDetailView
                    loading={loading}"""

new = """                  <HouseDetailView
                    setSelectedDefect={setSelectedDefect} setDefectReturnView={setDefectReturnView}
                    loading={loading}"""

if old in content:
    content = content.replace(old, new)
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)
    print("Patched successfully")
else:
    print("Not found")
