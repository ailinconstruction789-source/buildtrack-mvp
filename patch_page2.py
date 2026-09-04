import os
import re

page_path = r'd:\buildtrack\buildtrack-mvp-main\app\page.tsx'

with open(page_path, 'r', encoding='utf-8') as f:
    page_content = f.read()

# Remove the incorrectly added props globally
page_content = page_content.replace(
    'setSelectedTask={setSelectedTask} setSelectedDefect={setSelectedDefect} setDefectReturnView={setDefectReturnView}',
    'setSelectedTask={setSelectedTask}'
)

# Now, selectively add it ONLY to HouseDetailView where it belongs.
# We can find `<HouseDetailView` and inject the props.
# Let's find the exact usage:
page_content = page_content.replace(
    '<HouseDetailView\n                    view={view}',
    '<HouseDetailView\n                    view={view}\n                    setSelectedDefect={setSelectedDefect}\n                    setDefectReturnView={setDefectReturnView}'
)

with open(page_path, 'w', encoding='utf-8') as f:
    f.write(page_content)
print("Patched page.tsx")
