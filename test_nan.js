const defects = [
  { planned_start: null, planned_end: null },
  { planned_start: "", planned_end: "" },
  { planned_start: " ", planned_end: " " },
  { planned_start: "null", planned_end: "null" },
  { planned_start: "Invalid Date", planned_end: "Invalid Date" },
];

let minStart = Infinity;
let maxEnd = -Infinity;
let hasDates = false;

defects.forEach((d) => {
  if (d.planned_start) {
    const ts = new Date(d.planned_start).getTime();
    console.log(`planned_start: '${d.planned_start}', ts: ${ts}, ts < minStart: ${ts < minStart}`);
    if (ts < minStart) minStart = ts;
    hasDates = true;
  }
  if (d.planned_end) {
    const ts = new Date(d.planned_end).getTime();
    if (ts > maxEnd) maxEnd = ts;
    hasDates = true;
  }
});

const today = new Date();
today.setHours(0,0,0,0);
const todayTs = today.getTime();

let chartStart = todayTs - (5 * 86400000);
let chartEnd = todayTs + (25 * 86400000);

console.log(`hasDates: ${hasDates}, minStart: ${minStart}, maxEnd: ${maxEnd}`);

if (hasDates) {
  if (minStart !== Infinity) chartStart = minStart - (5 * 86400000);
  if (maxEnd !== -Infinity) chartEnd = maxEnd + (5 * 86400000);
  if (chartEnd <= chartStart) chartEnd = chartStart + (30 * 86400000);
}

const totalChartDays = Math.round((chartEnd - chartStart) / 86400000) + 1;
console.log(`chartStart: ${chartStart}, chartEnd: ${chartEnd}, totalChartDays: ${totalChartDays}`);
