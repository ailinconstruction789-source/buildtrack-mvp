const fs = require('fs');

let content = fs.readFileSync('app/page.tsx', 'utf-8');
content = content.replace(/\r\n/g, '\n');

// 1. Add hook import
if (!content.includes('import { useBuildTrackData }')) {
  content = content.replace(
    "import { supabase } from '@/lib/supabase';",
    "import { supabase } from '@/lib/supabase';\nimport { useBuildTrackData } from '@/hooks/useBuildTrackData';"
  );
}

// 2. Remove old state declarations
const statesToRemove = [
  "const [allUsers, setAllUsers] = useState<any[]>([]);",
  "const [projects, setProjects] = useState<any[]>([]);",
  "const [plots, setPlots] = useState<any[]>([]);",
  "const [houseTypes, setHouseTypes] = useState<any[]>([]);",
  "const [taskTemplates, setTaskTemplates] = useState<any[]>([]);",
  "const [loading, setLoading] = useState(false);",
  "const [allUpdatesRecord, setAllUpdatesRecord] = useState<any[]>([]);",
  "const [latestUpdatesMap, setLatestUpdatesMap] = useState({});",
  "const [taskDates, setTaskDates] = useState({});",
  "const [assignments, setAssignments] = useState<any[]>([]);",
  "const [schedules, setSchedules] = useState({});",
  "const [notifications, setNotifications] = useState<any[]>([]);",
  "const [contractors, setContractors] = useState<any[]>([]);",
  "const [defects, setDefects] = useState<any[]>([]);"
];

for (const state of statesToRemove) {
  content = content.replace(state, `// Extracted: ${state.split(' ')[1]}`);
}

// 3. Add hook call right after states
const hookCall = `  const {
    loading, setLoading,
    projects, setProjects,
    houseTypes, setHouseTypes,
    taskTemplates, setTaskTemplates,
    plots, setPlots,
    contractors, setContractors,
    allUsers, setAllUsers,
    assignments, setAssignments,
    schedules, setSchedules,
    defects, setDefects,
    notifications, setNotifications,
    latestUpdatesMap, setLatestUpdatesMap,
    taskDates, setTaskDates,
    allUpdatesRecord, setAllUpdatesRecord,
    fetchAllData
  } = useBuildTrackData(loggedInUser);
`;

if (!content.includes('useBuildTrackData(loggedInUser)')) {
  content = content.replace(
    "const [loginData, setLoginData] = useState({ username: '', pin: '' });",
    "const [loginData, setLoginData] = useState({ username: '', pin: '' });\n\n" + hookCall
  );
}

// 4. Remove fetchAllData function
const fetchAllStart = content.indexOf('const fetchAllData = async () => {');
const fetchAllEnd = content.indexOf('// 🌟 ฟังก์ชันพิเศษ "ทะลุลิมิต 1000 แถว" ของ Supabase 🌟', fetchAllStart);
// Wait, fetchAllData ends with `setLoading(false); }`
const fetchAllEndMarker = "    } catch (error) { console.error('Error fetching data:', error); } finally { setLoading(false); }\n  };";
const fetchEndIndex = content.indexOf(fetchAllEndMarker, fetchAllStart);

if (fetchAllStart !== -1 && fetchEndIndex !== -1) {
  content = content.substring(0, fetchAllStart) + "// fetchAllData extracted to hook\n" + content.substring(fetchEndIndex + fetchAllEndMarker.length);
}

// 5. Remove useEffects
content = content.replace("useEffect(() => { const fetchUsers = async () => { try { const { data } = await supabase.from('users').select('*').order('role', { ascending: true }).order('username', { ascending: true }); setAllUsers(data || []); } catch (err) { console.error(err); } }; fetchUsers(); }, []);", "// fetchUsers extracted to hook");
content = content.replace("useEffect(() => { if (loggedInUser) fetchAllData(); }, [loggedInUser]);", "// loggedInUser fetchAllData extracted");

fs.writeFileSync('app/page.tsx', content);
console.log("Hook integration complete.");
