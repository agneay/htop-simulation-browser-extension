// hTab - Main Extension Script

// --- CONFIGURATION & LOCAL STORAGE ---
const CONFIG = {
  theme: localStorage.getItem('htab-theme') || 'classic',
  crtEnabled: localStorage.getItem('htab-crt') !== 'false',
  crtFlicker: localStorage.getItem('htab-flicker') !== 'false',
  crtScanlines: localStorage.getItem('htab-scanlines') !== 'false',
};

// Apply initial configuration styles to body
function applyConfig() {
  document.body.className = `theme-${CONFIG.theme}`;
  if (CONFIG.crtEnabled) document.body.classList.add('crt-enabled');
  if (CONFIG.crtFlicker) document.body.classList.add('crt-flicker-enabled');
  if (CONFIG.crtScanlines) document.body.classList.add('crt-scanlines-enabled');
}
applyConfig();

// --- STATE MANAGEMENT ---
const STATE = {
  tabs: [],
  systemProcesses: [],
  processes: [],       // Combined tabs + system
  flatList: [],        // Flattened processes list after filter, search, sort, or tree building
  selectedIndex: 0,
  taggedPids: new Set(),
  sortColumn: 'cpu',   // default sort
  sortOrder: 'desc',   // 'desc' or 'asc'
  viewMode: 'flat',    // 'flat' or 'tree'
  promptActive: null,  // 'search' or 'filter' or null
  promptValue: '',
  uptimeStart: parseInt(localStorage.getItem('htab-uptime-start')) || 0,
  cores: navigator.hardwareConcurrency || 4,
  cpuUsage: [],        // Current CPU usage per core
  memUsed: 0,          // Current simulated memory used in GB
  memTotal: navigator.deviceMemory || 16, // Total RAM in GB
  systemStatsTimer: null,
  renderTimer: null,
  isFirefox: navigator.userAgent.includes('Firefox'),
  niceOffsets: {},     // pid -> nice offset (-20 to 19)
};

// Initialize Uptime Boot Time (simulate system uptime)
if (!STATE.uptimeStart) {
  // Set boot time to a random time between 1 and 24 hours ago
  const hoursAgo = 1 + Math.floor(Math.random() * 23);
  const minsAgo = Math.floor(Math.random() * 60);
  STATE.uptimeStart = Date.now() - (hoursAgo * 3600000 + minsAgo * 60000);
  localStorage.setItem('htab-uptime-start', STATE.uptimeStart);
}

// --- SIMULATED PROCESS DATA GENERATOR ---
const mockDomains = [
  'github.com', 'google.com', 'youtube.com', 'wikipedia.org', 
  'reddit.com', 'news.ycombinator.com', 'stackoverflow.com', 
  'netflix.com', 'twitter.com', 'amazon.com'
];

const mockTitles = {
  'github.com': 'GitHub - Where software is built',
  'google.com': 'Google',
  'youtube.com': 'YouTube - Watch videos',
  'wikipedia.org': 'Wikipedia, the free encyclopedia',
  'reddit.com': 'reddit: the front page of the internet',
  'news.ycombinator.com': 'Hacker News',
  'stackoverflow.com': 'Stack Overflow - Developer Q&A',
  'netflix.com': 'Netflix - Watch TV Shows Online',
  'twitter.com': 'X. It\'s what\'s happening',
  'amazon.com': 'Amazon.com: Online Shopping'
};

// Get nice wrapper for chrome extension APIs (with Firefox fallback)
const extAPI = typeof browser !== 'undefined' ? browser : chrome;

// Initialize mock tabs if run outside of extension environment
function getMockTabs() {
  const count = 5 + Math.floor(Math.random() * 8);
  const mockTabs = [];
  for (let i = 0; i < count; i++) {
    const domain = mockDomains[i % mockDomains.length];
    mockTabs.push({
      id: i + 1,
      windowId: 1,
      active: i === 0,
      title: mockTitles[domain],
      url: `https://${domain}/`
    });
  }
  return mockTabs;
}

// Create static simulated system processes (similar to Linux OS/Browser subsystems)
function initSystemProcesses() {
  STATE.systemProcesses = [
    { pid: 1, name: 'systemd', ppid: 0, user: 'root', pri: 20, ni: 0, virt: '168M', res: '12M', shr: '8M', state: 'S', cpu: 0.0, mem: 0.1, time: '0:01.42', cmd: '/sbin/init splash', isSystem: true },
    { pid: 2, name: 'kthreadd', ppid: 0, user: 'root', pri: 20, ni: 0, virt: '0', res: '0', shr: '0', state: 'S', cpu: 0.0, mem: 0.0, time: '0:00.00', cmd: 'kthreadd', isSystem: true },
    { pid: 120, name: 'windowserver', ppid: 1, user: 'root', pri: 20, ni: 0, virt: '2.4G', res: '180M', shr: '64M', state: 'S', cpu: 1.5, mem: 1.1, time: '3:42.11', cmd: '/usr/lib/xorg/Xorg -core :0 -seat seat0 -auth /var/run/lightdm/root/:0', isSystem: true },
    { pid: 145, name: 'gpu-process', ppid: 500, user: 'user', pri: 20, ni: 0, virt: '4.8G', res: '320M', shr: '120M', state: 'S', cpu: 3.2, mem: 2.0, time: '14:20.05', cmd: '/usr/lib/browser/browser --type=gpu-process --enable-features=Vulkan', isSystem: true },
    { pid: 210, name: 'extension-host', ppid: 500, user: 'user', pri: 20, ni: 0, virt: '1.2G', res: '88M', shr: '32M', state: 'S', cpu: 0.5, mem: 0.5, time: '1:12.87', cmd: '/usr/lib/browser/browser --type=utility --utility-sub-type=extension.mojom.Service', isSystem: true },
    { pid: 240, name: 'network-service', ppid: 500, user: 'user', pri: 20, ni: 0, virt: '980M', res: '52M', shr: '24M', state: 'S', cpu: 0.2, mem: 0.3, time: '0:45.30', cmd: '/usr/lib/browser/browser --type=utility --utility-sub-type=network.mojom.NetworkService', isSystem: true },
    { pid: 265, name: 'audio-service', ppid: 500, user: 'user', pri: 20, ni: 0, virt: '840M', res: '40M', shr: '16M', state: 'S', cpu: 0.1, mem: 0.2, time: '0:18.11', cmd: '/usr/lib/browser/browser --type=utility --utility-sub-type=audio.mojom.AudioService', isSystem: true }
  ];
}

// Generate runtime processes from real or mock tabs
function syncProcesses() {
  const browserType = STATE.isFirefox ? 'firefox' : 'chrome';
  const tabProcesses = STATE.tabs.map(tab => {
    const pid = 1000 + tab.id;
    
    // Parse domain name for nice display in tree view
    let domain = 'blank';
    try {
      if (tab.url) {
        const urlObj = new URL(tab.url);
        domain = urlObj.hostname.replace('www.', '');
      }
    } catch(e) {}

    // Dynamic virtual and resident memory based on active state or URL type
    let resMB = 90 + (tab.id % 7) * 25; // 90MB to 265MB base
    if (tab.active) resMB += 150;        // Active tab gets more memory
    if (tab.url && (tab.url.includes('youtube') || tab.url.includes('video') || tab.url.includes('netflix'))) {
      resMB += 250;                      // Media tabs use more
    }
    const virtGB = (resMB * 8.5 / 1024).toFixed(1) + 'G';
    const resStr = resMB + 'M';
    const shrStr = Math.round(resMB * 0.35) + 'M';
    
    // Nice offset
    const ni = STATE.niceOffsets[pid] || 0;
    const pri = 20 + ni;

    // Estimate time elapsed since creation
    const runSecs = Math.floor((Date.now() - STATE.uptimeStart) / 10000) * (tab.id % 5 + 1);
    const hrs = Math.floor(runSecs / 3600);
    const mins = Math.floor((runSecs % 3600) / 60);
    const secs = runSecs % 60;
    const centis = Math.floor(Math.random() * 100);
    const timeStr = `${hrs > 0 ? hrs + ':' : ''}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${centis.toString().padStart(2, '0')}`;

    // realistic cpu simulation baseline
    let baseCpu = 0.0;
    if (tab.active) baseCpu = 1.8;
    if (tab.url && (tab.url.includes('youtube') || tab.url.includes('netflix') || tab.url.includes('stream'))) {
      baseCpu += 6.5;
    }
    // Random fluctuation
    baseCpu += Math.random() * 0.8;
    // Adjust by nice offset (higher nice = less CPU share)
    if (ni > 0) baseCpu = Math.max(0.0, baseCpu * (1 - ni / 20));
    if (ni < 0) baseCpu = baseCpu * (1 + Math.abs(ni) / 20);

    const memPct = parseFloat(((resMB / 1024) / STATE.memTotal * 100).toFixed(1));

    // Construct cmd command line string matching htop style
    const cmdStr = `/usr/lib/${browserType}/${browserType} --type=renderer --tab-id=${tab.id} --window-id=${tab.windowId} --url="${tab.url || 'about:newtab'}" --title="${tab.title || 'New Tab'}"`;

    return {
      pid,
      ppid: 500, // Parent process: Browser main process
      name: domain,
      user: 'user',
      pri,
      ni,
      virt: virtGB,
      res: resStr,
      shr: shrStr,
      state: tab.active ? 'R' : 'S',
      cpu: parseFloat(baseCpu.toFixed(1)),
      mem: memPct,
      time: timeStr,
      cmd: cmdStr,
      isSystem: false,
      tabId: tab.id,
      windowId: tab.windowId,
      title: tab.title || 'New Tab',
      url: tab.url || ''
    };
  });

  // Browser Main process
  const browserPid = 500;
  const browserNi = STATE.niceOffsets[browserPid] || 0;
  const browserRes = 400 + tabProcesses.length * 60; // Base 400MB + 60MB per tab
  const browserVirt = (browserRes * 6.2 / 1024).toFixed(1) + 'G';
  const browserCpu = parseFloat((1.2 + Math.random() * 0.8).toFixed(1));
  const browserMem = parseFloat(((browserRes / 1024) / STATE.memTotal * 100).toFixed(1));
  const browserProc = {
    pid: browserPid,
    ppid: 1,
    name: browserType,
    user: 'user',
    pri: 20 + browserNi,
    ni: browserNi,
    virt: browserVirt,
    res: browserRes + 'M',
    shr: '96M',
    state: 'R',
    cpu: browserCpu,
    mem: browserMem,
    time: '2:15.80',
    cmd: `/usr/lib/${browserType}/${browserType} --no-sandbox --enable-gpu-rasterization --restore-last-session`,
    isSystem: true
  };

  // Combine systems + browser main + tabs
  // Merge nice offset updates into simulated system processes
  STATE.systemProcesses.forEach(sp => {
    const ni = STATE.niceOffsets[sp.pid] || 0;
    sp.ni = ni;
    sp.pri = 20 + ni;
  });

  STATE.processes = [browserProc, ...STATE.systemProcesses, ...tabProcesses];
}

// Update list of actual tabs from chrome extension API
async function updateTabsList() {
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
    try {
      const extensionTabs = await new Promise((resolve) => {
        chrome.tabs.query({}, (result) => resolve(result || []));
      });
      STATE.tabs = extensionTabs;
    } catch (e) {
      console.warn("Failed to query tabs via Chrome API, using mocks", e);
      STATE.tabs = getMockTabs();
    }
  } else {
    if (STATE.tabs.length === 0) {
      STATE.tabs = getMockTabs();
    }
  }
  syncProcesses();
  applyFiltersAndSorting();
}

// Fluctuates CPU/Memory metrics dynamically at intervals
function updateSystemMetrics() {
  // CPU Usage calculation: Cores
  STATE.cpuUsage = [];
  let totalCpu = 0;
  for (let i = 0; i < STATE.cores; i++) {
    // Generate usage per core. Base fluctuation: 5% to 25% average, unless busy.
    // Active tabs increase overall load.
    const activeTabLoad = STATE.tabs.filter(t => t.active).length * 8;
    const baseUsage = 2 + Math.random() * 12 + activeTabLoad;
    const coreUsage = Math.min(100, Math.max(0.1, baseUsage));
    STATE.cpuUsage.push(coreUsage);
    totalCpu += coreUsage;
  }
  
  // Total Mem usage: sum of all processes
  let memSumGB = 0;
  STATE.processes.forEach(p => {
    let resMB = parseFloat(p.res);
    if (p.res.includes('G')) resMB = parseFloat(p.res) * 1024;
    memSumGB += (resMB / 1024);
  });
  STATE.memUsed = parseFloat(Math.min(STATE.memTotal - 0.5, memSumGB + 1.2).toFixed(2)); // add 1.2GB static OS cache overhead

  // Fluctuate cpu/mem of individual active processes slightly
  STATE.processes.forEach(p => {
    if (p.pid > 2) { // don't fluctuate kernel task or init
      // CPU fluctuations
      let delta = (Math.random() - 0.5) * 1.5;
      p.cpu = parseFloat(Math.max(0, p.cpu + delta).toFixed(1));
      
      // Memory fluctuations (very small)
      if (Math.random() > 0.8) {
        let memDelta = Math.round((Math.random() - 0.5) * 4); // +/- 2MB
        let currRes = parseInt(p.res);
        if (p.res.includes('M') && currRes > 10) {
          p.res = (currRes + memDelta) + 'M';
        }
      }
    }
  });

  applyFiltersAndSorting();
  renderMeters();
}

// --- SEARCH & FILTER & SORT & TREE BUILDERS ---
function applyFiltersAndSorting() {
  let list = [...STATE.processes];

  // 1. Apply active Search highlighting or Filtering
  if (STATE.promptActive === 'filter' && STATE.promptValue) {
    const q = STATE.promptValue.toLowerCase();
    list = list.filter(p => p.cmd.toLowerCase().includes(q) || (p.name && p.name.toLowerCase().includes(q)));
  }

  // 2. Sorting (Flat mode only. Tree mode has its own nesting sort order)
  if (STATE.viewMode === 'flat') {
    list.sort((a, b) => {
      let valA = getSortValue(a, STATE.sortColumn);
      let valB = getSortValue(b, STATE.sortColumn);

      if (typeof valA === 'string') {
        return STATE.sortOrder === 'asc' 
          ? valA.localeCompare(valB) 
          : valB.localeCompare(valA);
      } else {
        return STATE.sortOrder === 'asc' 
          ? valA - valB 
          : valB - valA;
      }
    });
  } else {
    // Tree mode sorting: Group processes hierarchically
    list = buildProcessTree(list);
  }

  STATE.flatList = list;

  // Clamp selection index within valid bounds
  if (STATE.selectedIndex >= STATE.flatList.length) {
    STATE.selectedIndex = Math.max(0, STATE.flatList.length - 1);
  }

  renderProcesses();
}

function getSortValue(proc, column) {
  switch (column) {
    case 'pid': return proc.pid;
    case 'user': return proc.user;
    case 'pri': return proc.pri;
    case 'ni': return proc.ni;
    case 'virt': return parseMemStr(proc.virt);
    case 'res': return parseMemStr(proc.res);
    case 'shr': return parseMemStr(proc.shr);
    case 'state': return proc.state;
    case 'cpu': return proc.cpu;
    case 'mem': return proc.mem;
    case 'time': return proc.time;
    case 'cmd': return proc.cmd;
    default: return proc.cpu;
  }
}

function parseMemStr(str) {
  if (str.endsWith('G')) return parseFloat(str) * 1024 * 1024;
  if (str.endsWith('M')) return parseFloat(str) * 1024;
  return parseFloat(str) || 0;
}

// Tree view building: Grouping processes hierarchically
function buildProcessTree(allProcesses) {
  const treeNodes = {};
  const roots = [];

  // Create node lookup
  allProcesses.forEach(p => {
    treeNodes[p.pid] = {
      process: p,
      children: []
    };
  });

  // Assign child-parent links
  allProcesses.forEach(p => {
    const node = treeNodes[p.pid];
    const parentNode = treeNodes[p.ppid];
    if (p.ppid > 0 && parentNode) {
      parentNode.children.push(node);
    } else {
      roots.push(node);
    }
  });

  // Sort child lists inside the tree (e.g. by CPU percentage or PID)
  const sortChildren = (node) => {
    node.children.sort((a, b) => b.process.cpu - a.process.cpu);
    node.children.forEach(sortChildren);
  };
  roots.sort((a, b) => b.process.cpu - a.process.cpu);
  roots.forEach(sortChildren);

  // Flatten the tree into list with indentations
  const flatTree = [];
  
  function traverse(node, depth = 0, isLastArray = []) {
    const p = { ...node.process };
    p.depth = depth;
    p.isLastArray = isLastArray;
    
    flatTree.push(p);

    const childrenCount = node.children.length;
    node.children.forEach((child, index) => {
      const isLastChild = index === childrenCount - 1;
      traverse(child, depth + 1, [...isLastArray, isLastChild]);
    });
  }

  roots.forEach((root, idx) => {
    const isLastRoot = idx === roots.length - 1;
    traverse(root, 0, [isLastRoot]);
  });

  return flatTree;
}

// --- RENDER LAYOUT FUNCTIONS ---

// 1. Render Left top meters (CPU cores, RAM progress bars)
function renderMeters() {
  const container = document.getElementById('meters-container');
  container.innerHTML = '';

  const totalTicks = 50; // Total segments inside [  ]

  // Render Cores
  for (let i = 0; i < STATE.cores; i++) {
    const usage = STATE.cpuUsage[i] || 0.0;
    const ticksCount = Math.round((usage / 100) * totalTicks);
    
    // Draw segmented color bar (CPU uses green for low, yellow for medium, red for high in htop)
    let fillHtml = '';
    for (let t = 0; t < ticksCount; t++) {
      const tickRatio = t / totalTicks;
      let tickClass = 'user'; // green
      if (tickRatio > 0.8) {
        tickClass = 'sys';  // red
      } else if (tickRatio > 0.5) {
        tickClass = 'nice'; // blue/yellow
      }
      fillHtml += `<span class="bar-fill ${tickClass}">|</span>`;
    }
    
    const emptyCount = Math.max(0, totalTicks - ticksCount);
    const emptyHtml = `<span class="bar-empty">${' '.repeat(emptyCount)}</span>`;

    const row = document.createElement('div');
    row.className = 'meter-row';
    row.innerHTML = `
      <span class="meter-label">${i + 1} </span>
      <span class="meter-bracket">[</span>
      <div class="meter-bar-content">${fillHtml}${emptyHtml}</div>
      <span class="meter-bracket">]</span>
      <span class="meter-value">${usage.toFixed(1).padStart(5)}%</span>
    `;
    container.appendChild(row);
  }

  // Render Memory
  const memUsedVal = STATE.memUsed;
  const memTotalVal = STATE.memTotal;
  const memTicks = Math.round((memUsedVal / memTotalVal) * totalTicks);
  
  // Mem breakdown segments (Used: blue, Buffer: cyan, Cache: yellow)
  const usedTicks = Math.round(memTicks * 0.65);
  const cacheTicks = Math.round(memTicks * 0.25);
  const bufferTicks = Math.max(0, memTicks - usedTicks - cacheTicks);

  let memFillHtml = '';
  memFillHtml += `<span class="bar-fill mem-used">${'|'.repeat(usedTicks)}</span>`;
  memFillHtml += `<span class="bar-fill mem-cache">${'|'.repeat(cacheTicks)}</span>`;
  memFillHtml += `<span class="bar-fill mem-buf">${'|'.repeat(bufferTicks)}</span>`;
  
  const memEmptyCount = Math.max(0, totalTicks - memTicks);
  const memEmptyHtml = `<span class="bar-empty">${' '.repeat(memEmptyCount)}</span>`;

  const memRow = document.createElement('div');
  memRow.className = 'meter-row';
  memRow.innerHTML = `
    <span class="meter-label">Mem</span>
    <span class="meter-bracket">[</span>
    <div class="meter-bar-content">${memFillHtml}${memEmptyHtml}</div>
    <span class="meter-bracket">]</span>
    <span class="meter-value">${memUsedVal.toFixed(2)}G/${memTotalVal.toFixed(0)}G</span>
  `;
  container.appendChild(memRow);

  // Render Swap (simulated)
  const swpUsed = 0.12; // 120MB
  const swpTotal = 4.0; // 4.0GB
  const swpTicks = Math.round((swpUsed / swpTotal) * totalTicks);
  const swpFillHtml = `<span class="bar-fill mem-used">${'|'.repeat(swpTicks)}</span>`;
  const swpEmptyHtml = `<span class="bar-empty">${' '.repeat(totalTicks - swpTicks)}</span>`;

  const swpRow = document.createElement('div');
  swpRow.className = 'meter-row';
  swpRow.innerHTML = `
    <span class="meter-label">Swp</span>
    <span class="meter-bracket">[</span>
    <div class="meter-bar-content">${swpFillHtml}${swpEmptyHtml}</div>
    <span class="meter-bracket">]</span>
    <span class="meter-value">${Math.round(swpUsed * 1024)}M/${swpTotal.toFixed(1)}G</span>
  `;
  container.appendChild(swpRow);
}

// 2. Render Right top summaries (Tasks count, Load average, Uptime)
function renderSummary() {
  const container = document.getElementById('summary-container');
  container.innerHTML = '';

  const totalTasks = STATE.processes.length;
  const runningTasks = STATE.processes.filter(p => p.state === 'R').length;
  const taggedCount = STATE.taggedPids.size;

  // Calculate load averages based on simulated CPU averages
  const avgCpu = STATE.cpuUsage.reduce((a, b) => a + b, 0) / STATE.cores / 100;
  const load1 = (avgCpu * STATE.cores * 0.95 + Math.random()*0.1).toFixed(2);
  const load5 = (avgCpu * STATE.cores * 0.88).toFixed(2);
  const load15 = (avgCpu * STATE.cores * 0.80).toFixed(2);

  // Uptime formatting
  const uptimeMs = Date.now() - STATE.uptimeStart;
  const totalSecs = Math.floor(uptimeMs / 1000);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  const uptimeStr = `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

  // Get user agent details
  let browserInfo = "Chrome Extension";
  if (STATE.isFirefox) browserInfo = "Firefox Add-on";
  
  const items = [
    { label: 'Tasks', value: `${totalTasks}, 4 thr; ${runningTasks} running` + (taggedCount > 0 ? `; ${taggedCount} tagged` : '') },
    { label: 'Load average', value: `${load1} ${load5} ${load15}` },
    { label: 'Uptime', value: uptimeStr },
    { label: 'Environment', value: `${browserInfo} MV3` }
  ];

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'summary-row';
    row.innerHTML = `
      <span class="summary-label">${item.label}:</span>
      <span class="summary-value">${item.value}</span>
    `;
    container.appendChild(row);
  });
}

// 3. Render Process Column Headers
const COLUMNS = [
  { id: 'pid', label: 'PID', width: '80px' },
  { id: 'user', label: 'USER', width: '100px' },
  { id: 'pri', label: 'PRI', width: '45px' },
  { id: 'ni', label: 'NI', width: '45px' },
  { id: 'virt', label: 'VIRT', width: '80px' },
  { id: 'res', label: 'RES', width: '80px' },
  { id: 'shr', label: 'SHR', width: '80px' },
  { id: 'state', label: 'S', width: '30px' },
  { id: 'cpu', label: 'CPU%', width: '65px' },
  { id: 'mem', label: 'MEM%', width: '65px' },
  { id: 'time', label: 'TIME+', width: '95px' },
  { id: 'cmd', label: 'Command', width: '1fr' }
];

function renderColumnHeaders() {
  const header = document.getElementById('process-header');
  header.innerHTML = '';

  COLUMNS.forEach(col => {
    const span = document.createElement('span');
    span.className = 'col-header';
    span.textContent = col.label;
    span.dataset.col = col.id;

    if (STATE.viewMode === 'flat' && STATE.sortColumn === col.id) {
      span.classList.add('sorted-active');
      if (STATE.sortOrder === 'asc') {
        span.classList.add('sort-asc');
      }
    }

    span.addEventListener('click', () => {
      if (STATE.viewMode === 'flat') {
        if (STATE.sortColumn === col.id) {
          STATE.sortOrder = STATE.sortOrder === 'desc' ? 'asc' : 'desc';
        } else {
          STATE.sortColumn = col.id;
          STATE.sortOrder = 'desc';
        }
        applyFiltersAndSorting();
        renderColumnHeaders();
      }
    });

    header.appendChild(span);
  });
}

// 4. Render main scrollable processes list
function renderProcesses() {
  const listContainer = document.getElementById('process-list');
  listContainer.innerHTML = '';

  if (STATE.flatList.length === 0) {
    const emptyRow = document.createElement('div');
    emptyRow.style.padding = '12px';
    emptyRow.style.color = 'var(--text-dim)';
    emptyRow.textContent = 'No matching processes found.';
    listContainer.appendChild(emptyRow);
    return;
  }

  STATE.flatList.forEach((proc, index) => {
    const row = document.createElement('div');
    row.className = 'process-row';
    row.id = `proc-row-${proc.pid}`;
    
    if (index === STATE.selectedIndex) {
      row.classList.add('selected');
    }
    if (STATE.taggedPids.has(proc.pid)) {
      row.classList.add('tagged');
    }

    // Format fields
    const cpuStr = proc.cpu.toFixed(1).padStart(5);
    const memStr = proc.mem.toFixed(1).padStart(5);
    const priStr = proc.pri === 20 ? '20' : (proc.pri < 20 ? (proc.pri - 20).toString() : (proc.pri - 20).toString());

    // Command Formatting
    let cmdHtml = '';
    if (STATE.viewMode === 'tree') {
      // Build tree character branch styling
      let branchPrefix = '';
      if (proc.depth > 0) {
        for (let d = 0; d < proc.depth - 1; d++) {
          branchPrefix += proc.isLastArray[d] ? '   ' : '│  ';
        }
        branchPrefix += proc.isLastArray[proc.depth - 1] ? '└─ ' : '├─ ';
      }
      cmdHtml += `<span class="tree-branch">${branchPrefix}</span>`;
    }

    // Command command details highlighting: path, flags, url, title
    if (!proc.isSystem) {
      const browserType = STATE.isFirefox ? 'firefox' : 'chrome';
      const cmdPath = `/usr/lib/${browserType}/${browserType}`;
      const flags = ` --type=renderer --tab-id=${proc.tabId}`;
      const urlText = ` --url="${proc.url ? proc.url.substring(0, 45) + (proc.url.length > 45 ? '...' : '') : 'about:newtab'}"`;
      const titleText = ` --title="${proc.title}"`;
      
      cmdHtml += `<span class="cmd-path">${cmdPath}</span><span class="cmd-flag">${flags}</span><span class="cmd-url">${urlText}</span><span class="cmd-title">${titleText}</span>`;
    } else {
      // system process cmd formatting
      cmdHtml += `<span class="cmd-path">${proc.cmd}</span>`;
    }

    row.innerHTML = `
      <span class="col-pid">${proc.pid.toString().padStart(6)}</span>
      <span class="col-user">${proc.user.padEnd(9)}</span>
      <span class="col-pri">${priStr.padStart(3)}</span>
      <span class="col-ni">${proc.ni.toString().padStart(3)}</span>
      <span class="col-virt">${proc.virt.padStart(6)}</span>
      <span class="col-res">${proc.res.padStart(6)}</span>
      <span class="col-shr">${proc.shr.padStart(6)}</span>
      <span class="col-state">${proc.state.padStart(2)}</span>
      <span class="col-cpu">${cpuStr}</span>
      <span class="col-mem">${memStr}</span>
      <span class="col-time">${proc.time.padStart(9)}</span>
      <div class="col-cmd">${cmdHtml}</div>
    `;

    // Click handler to select process
    row.addEventListener('click', (e) => {
      STATE.selectedIndex = index;
      selectRow(index);
      
      // If double click: switch to tab
      if (e.detail === 2 && !proc.isSystem) {
        focusTab(proc.tabId, proc.windowId);
      }
    });

    listContainer.appendChild(row);
  });

  // Ensure selected row is scrolled into view
  const selectedRow = document.getElementById(`proc-row-${STATE.flatList[STATE.selectedIndex].pid}`);
  if (selectedRow) {
    selectedRow.scrollIntoView({ block: 'nearest' });
  }
}

function selectRow(index) {
  const rows = document.querySelectorAll('.process-row');
  rows.forEach((r, idx) => {
    if (idx === index) {
      r.classList.add('selected');
    } else {
      r.classList.remove('selected');
    }
  });
}

// Focuses and opens a real browser tab
function focusTab(tabId, windowId) {
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.update) {
    chrome.tabs.update(tabId, { active: true }, () => {
      chrome.windows.update(windowId, { focused: true });
    });
  } else {
    alert(`Mock navigation: Switch to Tab ${tabId} inside Window ${windowId}`);
  }
}

// Kill Selected process (closes tab if it is a tab, or drops simulated task)
function killSelectedProcess() {
  const current = STATE.flatList[STATE.selectedIndex];
  if (!current) return;

  // Compile list of PIDs to kill (either tagged PIDs or just the single selected one)
  const pidsToKill = STATE.taggedPids.size > 0 ? Array.from(STATE.taggedPids) : [current.pid];
  const systemPids = pidsToKill.filter(pid => pid < 1000);
  const tabPids = pidsToKill.filter(pid => pid >= 1000);

  if (systemPids.length > 0) {
    // Cannot kill core system tasks
    if (systemPids.includes(1) || systemPids.includes(2)) {
      alert("Error: Cannot kill core kernel tasks (systemd, kthreadd). Action denied.");
      return;
    }
    // Remove simulated system process from runtime list
    STATE.systemProcesses = STATE.systemProcesses.filter(p => !systemPids.includes(p.pid));
  }

  if (tabPids.length > 0) {
    tabPids.forEach(pid => {
      const tabId = pid - 1000;
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.remove) {
        chrome.tabs.remove(tabId);
      } else {
        // Mock remove
        STATE.tabs = STATE.tabs.filter(t => t.id !== tabId);
      }
    });
  }

  // Clear tags and sync list
  STATE.taggedPids.clear();
  setTimeout(() => {
    updateTabsList();
  }, 100);
}

// --- INTERACTIVE PROMPTS & DIALOGS ---

function togglePrompt(mode, active) {
  const bar = document.getElementById('prompt-bar');
  const label = document.getElementById('prompt-label');
  const input = document.getElementById('prompt-input');

  if (active) {
    STATE.promptActive = mode;
    STATE.promptValue = '';
    label.textContent = mode === 'search' ? 'Search: ' : 'Filter: ';
    input.value = '';
    bar.classList.remove('hidden');
    input.focus();
  } else {
    STATE.promptActive = null;
    bar.classList.add('hidden');
    document.getElementById('process-list').focus();
    applyFiltersAndSorting();
  }
}

function toggleHelp(show) {
  const modal = document.getElementById('help-modal');
  if (show) {
    modal.classList.remove('hidden');
  } else {
    modal.classList.add('hidden');
    document.getElementById('process-list').focus();
  }
}

function toggleSetup(show) {
  const modal = document.getElementById('setup-modal');
  if (show) {
    modal.classList.remove('hidden');
    renderSetupMenu();
  } else {
    modal.classList.add('hidden');
    document.getElementById('process-list').focus();
  }
}

// --- SETUP MODAL CONTROLS ---
function renderSetupMenu() {
  // Theme highlights
  const themeItems = document.querySelectorAll('#theme-list li');
  themeItems.forEach(item => {
    if (item.dataset.theme === CONFIG.theme) {
      item.className = 'selected';
    } else {
      item.className = '';
    }
  });

  // Display toggles representation
  const crtToggle = document.getElementById('crt-toggle');
  const flickerToggle = document.getElementById('flicker-toggle');
  const scanlineToggle = document.getElementById('scanline-toggle');

  if (crtToggle) crtToggle.className = CONFIG.crtEnabled ? 'selected-checkbox' : 'selected-checkbox off';
  if (flickerToggle) flickerToggle.className = CONFIG.crtFlicker ? 'selected-checkbox' : 'selected-checkbox off';
  if (scanlineToggle) scanlineToggle.className = CONFIG.crtScanlines ? 'selected-checkbox' : 'selected-checkbox off';
}

function registerSetupEventHandlers() {
  // Setup tabs switcher
  const tabs = document.querySelectorAll('.setup-tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.setup-tab-content').forEach(c => c.classList.remove('active'));
      
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });

  // Theme selection list click
  const themeItems = document.querySelectorAll('#theme-list li');
  themeItems.forEach(item => {
    item.addEventListener('click', () => {
      CONFIG.theme = item.dataset.theme;
      localStorage.setItem('htab-theme', CONFIG.theme);
      applyConfig();
      renderSetupMenu();
    });
  });

  // Setup options checkboxes click
  const displayItems = document.querySelectorAll('#tab-display li');
  displayItems.forEach(item => {
    item.addEventListener('click', () => {
      const toggleId = item.getAttribute('id-toggle');
      if (toggleId === 'crt-toggle') {
        CONFIG.crtEnabled = !CONFIG.crtEnabled;
        localStorage.setItem('htab-crt', CONFIG.crtEnabled);
      } else if (toggleId === 'flicker-toggle') {
        CONFIG.crtFlicker = !CONFIG.crtFlicker;
        localStorage.setItem('htab-flicker', CONFIG.crtFlicker);
      } else if (toggleId === 'scanline-toggle') {
        CONFIG.crtScanlines = !CONFIG.crtScanlines;
        localStorage.setItem('htab-scanlines', CONFIG.crtScanlines);
      }
      applyConfig();
      renderSetupMenu();
    });
  });
}

// --- KEYBOARD EVENT HANDLERS ---
function setupKeyboardBindings() {
  // Search / Filter Input Events
  const promptInput = document.getElementById('prompt-input');
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      STATE.promptValue = promptInput.value;
      togglePrompt(STATE.promptActive, false);
      e.stopPropagation();
    } else if (e.key === 'Escape') {
      togglePrompt(STATE.promptActive, false);
      e.stopPropagation();
    }
  });

  promptInput.addEventListener('input', () => {
    STATE.promptValue = promptInput.value;
    if (STATE.promptActive === 'filter') {
      applyFiltersAndSorting();
    } else if (STATE.promptActive === 'search') {
      // Highlight matching row dynamically in search
      const query = STATE.promptValue.toLowerCase();
      if (query) {
        const matchIdx = STATE.flatList.findIndex(p => p.cmd.toLowerCase().includes(query) || (p.name && p.name.toLowerCase().includes(query)));
        if (matchIdx !== -1) {
          STATE.selectedIndex = matchIdx;
          renderProcesses();
        }
      }
    }
  });

  // Main Terminal Global Key events
  window.addEventListener('keydown', (e) => {
    // If prompt input is focused, ignore global bindings
    if (document.activeElement === promptInput) return;

    // Check modal visibility
    const helpOpen = !document.getElementById('help-modal').classList.contains('hidden');
    const setupOpen = !document.getElementById('setup-modal').classList.contains('hidden');

    if (helpOpen) {
      if (e.key === 'Escape' || e.key === 'F1' || e.key === '1' || e.key === 'h') {
        toggleHelp(false);
        e.preventDefault();
      }
      return;
    }

    if (setupOpen) {
      if (e.key === 'Escape' || e.key === 'F2' || e.key === '2' || e.key === 's') {
        toggleSetup(false);
        e.preventDefault();
      }
      return;
    }

    // Global Key Bindings
    switch (e.key) {
      // Navigation
      case 'ArrowUp':
        if (STATE.selectedIndex > 0) {
          STATE.selectedIndex--;
          renderProcesses();
        }
        e.preventDefault();
        break;

      case 'ArrowDown':
        if (STATE.selectedIndex < STATE.flatList.length - 1) {
          STATE.selectedIndex++;
          renderProcesses();
        }
        e.preventDefault();
        break;

      case 'PageUp':
        STATE.selectedIndex = Math.max(0, STATE.selectedIndex - 15);
        renderProcesses();
        e.preventDefault();
        break;

      case 'PageDown':
        STATE.selectedIndex = Math.min(STATE.flatList.length - 1, STATE.selectedIndex + 15);
        renderProcesses();
        e.preventDefault();
        break;

      case 'Home':
        STATE.selectedIndex = 0;
        renderProcesses();
        e.preventDefault();
        break;

      case 'End':
        STATE.selectedIndex = STATE.flatList.length - 1;
        renderProcesses();
        e.preventDefault();
        break;

      case ' ': // Space: Tag / Untag
        const current = STATE.flatList[STATE.selectedIndex];
        if (current) {
          if (STATE.taggedPids.has(current.pid)) {
            STATE.taggedPids.delete(current.pid);
          } else {
            STATE.taggedPids.add(current.pid);
          }
          renderProcesses();
        }
        e.preventDefault();
        break;

      case 'Enter': // Focus tab
        const selProc = STATE.flatList[STATE.selectedIndex];
        if (selProc && !selProc.isSystem) {
          focusTab(selProc.tabId, selProc.windowId);
        }
        break;

      // Functional Key Helpers
      case 'F1':
      case '1':
      case 'h':
        toggleHelp(true);
        e.preventDefault();
        break;

      case 'F2':
      case '2':
      case 's':
        toggleSetup(true);
        e.preventDefault();
        break;

      case 'F3':
      case '3':
      case '/':
        togglePrompt('search', true);
        e.preventDefault();
        break;

      case 'F4':
      case '4':
      case '\\':
        togglePrompt('filter', true);
        e.preventDefault();
        break;

      case 'F5':
      case '5':
      case 't':
        STATE.viewMode = STATE.viewMode === 'flat' ? 'tree' : 'flat';
        applyFiltersAndSorting();
        renderColumnHeaders();
        e.preventDefault();
        break;

      case 'F6':
      case '6':
      case 'o':
        // Simple direct cycle of sorting options in htop
        const sortCycles = ['cpu', 'mem', 'pid', 'user', 'res', 'time'];
        const currentIdx = sortCycles.indexOf(STATE.sortColumn);
        STATE.sortColumn = sortCycles[(currentIdx + 1) % sortCycles.length];
        applyFiltersAndSorting();
        renderColumnHeaders();
        e.preventDefault();
        break;

      case 'F7':
      case '7':
      case '[': // Decrement nice offset (Increase priority)
        const decProc = STATE.flatList[STATE.selectedIndex];
        if (decProc) {
          const currentNi = STATE.niceOffsets[decProc.pid] || 0;
          STATE.niceOffsets[decProc.pid] = Math.max(-20, currentNi - 1);
          syncProcesses();
          applyFiltersAndSorting();
        }
        e.preventDefault();
        break;

      case 'F8':
      case '8':
      case ']': // Increment nice offset (Decrease priority)
        const incProc = STATE.flatList[STATE.selectedIndex];
        if (incProc) {
          const currentNi = STATE.niceOffsets[incProc.pid] || 0;
          STATE.niceOffsets[incProc.pid] = Math.min(19, currentNi + 1);
          syncProcesses();
          applyFiltersAndSorting();
        }
        e.preventDefault();
        break;

      case 'F9':
      case '9':
      case 'k':
      case 'Delete':
        if (confirm("Send SIGKILL to selected process(es)? This will close the associated browser tabs.")) {
          killSelectedProcess();
        }
        e.preventDefault();
        break;

      case 'F10':
      case '0':
      case 'q':
        // Quit simulation: Close tab or redirect to Google
        if (confirm("Quit hTab system monitor?")) {
          if (typeof chrome !== 'undefined' && chrome.tabs) {
            chrome.tabs.getCurrent(tab => chrome.tabs.remove(tab.id));
          } else {
            window.location.href = "https://www.google.com";
          }
        }
        e.preventDefault();
        break;
    }
  });

  // Setup click handlers for F-keys in footer
  const footerButtons = document.querySelectorAll('.footer-btn');
  footerButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      // Trigger corresponding key function
      window.dispatchEvent(new KeyboardEvent('keydown', { key }));
    });
  });
}

// --- INITIALIZATION ---
async function init() {
  initSystemProcesses();
  await updateTabsList();
  
  renderMeters();
  renderSummary();
  renderColumnHeaders();
  renderProcesses();
  
  registerSetupEventHandlers();
  setupKeyboardBindings();
  
  // Refresh CPU load averages and memories every 1.5 seconds
  STATE.systemStatsTimer = setInterval(() => {
    updateSystemMetrics();
    renderSummary();
  }, 1500);

  // Keep list focused
  document.getElementById('process-list').focus();
}

window.addEventListener('DOMContentLoaded', init);
