// Reports only numeric memory counters for owned test processes; never dumps environment or heap data.
let peak = process.memoryUsage().rss;
const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 500);
timer.unref();
process.on('exit', () => { console.log(`[voices-memory] pid=${process.pid} peakRssMiB=${Math.ceil(peak / 1048576)}`); });
