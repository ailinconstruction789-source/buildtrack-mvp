import os
import re

file_path = r'd:\buildtrack\buildtrack-mvp-main\components\DefectTaskSelectModal.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Add isSubmitting state
content = content.replace(
    'const [selectedTasks, setSelectedTasks] = useState<any[]>([]);',
    'const [selectedTasks, setSelectedTasks] = useState<any[]>([]);\n    const [isSubmitting, setIsSubmitting] = useState(false);'
)

# Update handleConfirm
old_handle_confirm = '''    const handleConfirm = () => {
        if (selectedTasks.length > 0) {
            onSelectTask(selectedTasks);
            setSelectedTasks([]);
        }
    };'''
new_handle_confirm = '''    const handleConfirm = async () => {
        if (selectedTasks.length > 0) {
            setIsSubmitting(true);
            try {
                await onSelectTask(selectedTasks);
                setSelectedTasks([]);
            } finally {
                setIsSubmitting(false);
            }
        }
    };'''
content = content.replace(old_handle_confirm, new_handle_confirm)

# Update button text and disabled state
old_button = '''<button 
                        onClick={handleConfirm}
                        disabled={selectedTasks.length === 0}
                        className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-sm"
                    >
                        <Plus size={18} /> เพิ่มรายการเข้าสู่รอบตรวจ
                    </button>'''
new_button = '''<button 
                        onClick={handleConfirm}
                        disabled={selectedTasks.length === 0 || isSubmitting}
                        className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-sm"
                    >
                        {isSubmitting ? <span className="flex items-center gap-2"><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> กำลังบันทึก...</span> : <span className="flex items-center gap-2"><Plus size={18} /> เพิ่มรายการเข้าสู่รอบตรวจ</span>}
                    </button>'''
content = content.replace(old_button, new_button)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Updated DefectTaskSelectModal.tsx')
