import os

task_view_path = r'd:\buildtrack\buildtrack-mvp-main\components\TaskProgressView.tsx'
defect_view_path = r'd:\buildtrack\buildtrack-mvp-main\components\DefectProgressView.tsx'

with open(task_view_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace TaskProgressView with DefectProgressView
content = content.replace('TaskProgressView', 'DefectProgressView')
content = content.replace('selectedTask', 'selectedDefect')
content = content.replace('task_template_id', 'defect_id')
content = content.replace('task_updates', 'defect_updates')
content = content.replace('task_name', 'description')
content = content.replace('taskReturnView', 'defectReturnView')

# Handle differences in columns for defect_updates
# task_updates has user_name and role
# defect_updates has created_by
# In TaskProgressView: update.role, update.user_name
content = content.replace('update.user_name', 'update.created_by')
content = content.replace('update.role === \'QC\'', 'update.created_by === \'QC\'')
content = content.replace('update.role === \'Site Engineer\'', 'update.created_by === \'Site Engineer\'')
content = content.replace('update.role', 'update.created_by')

# In TaskProgressView, it uses `insert([{ task_template_id: ..., plot_id: ..., role: ..., user_name: ... }])`
# We need to change that to `defect_id, created_by`
content = content.replace('task_template_id: selectedDefect.id,', 'defect_id: selectedDefect.id,')
# plot_id is not in defect_updates, so we should remove it from inserts. But we can just leave it if it errors, wait, no. Let's fix it properly.
content = content.replace('plot_id: selectedPlot.id,', '')
content = content.replace('role: currentUserRole,', '')
content = content.replace('user_name: loggedInUser?.name || currentUserRole,', 'created_by: loggedInUser?.name || currentUserRole,')

# In TaskProgressView, the delete function takes `taskId` and `plotId`.
# We need to replace `handleDeleteUpdate(update.id, selectedDefect.id, selectedPlot.id)`
# with `handleDeleteDefectUpdate(update.id, selectedDefect.id)`
content = content.replace('handleDeleteUpdate', 'handleDeleteDefectUpdate')

# Remove setDefectModal logic since we are already in DefectProgressView
# It has a "แจ้งซ่อม (Defect)" button. We can just hide it.
content = content.replace('{[\'QC\', \'Foreman\', \'Site Engineer\', \'Admin\', \'Owner\'].includes(currentUserRole) && (', '{false && (')

with open(defect_view_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Created DefectProgressView.tsx")
