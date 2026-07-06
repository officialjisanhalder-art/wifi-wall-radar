/*
  WiSight - Through-Wall Radar Client
  Author: Jisan Halder
  Simulates WiFi Channel State Information (CSI) multipath attenuation and phase shifts
*/

// DOM Elements
const radarCanvas = document.getElementById('radarCanvas');
const chartCanvas = document.getElementById('chartCanvas');
const scanBtn     = document.getElementById('scanBtn');
const resetBtn    = document.getElementById('resetBtn');
const csiResSlider = document.getElementById('csiRes');
const csiResVal   = document.getElementById('csiResVal');
const freqSelect  = document.getElementById('freqSelect');
const wallMaterial = document.getElementById('wallMaterial');
const logsContainer = document.getElementById('logsContainer');

// Drawing Tool Elements
const drawWallBtn   = document.getElementById('drawWallBtn');
const drawPillarBtn = document.getElementById('drawPillarBtn');
const clearRoomBtn  = document.getElementById('clearRoomBtn');

// Telemetry Labels
const rssiVal     = document.getElementById('rssiVal');
const phaseVal    = document.getElementById('phaseVal');
const noiseVal    = document.getElementById('noiseVal');
const dopplerVal  = document.getElementById('dopplerVal');

// Canvas Contexts
const ctx = radarCanvas.getContext('2d');
const chartCtx = chartCanvas.getContext('2d');

// State Variables
let scanning = true;
let sweepAngle = 0;
let csiSubcarriers = 56;
let target = { x: 0, y: 0, dx: 1.2, dy: 0.8, detected: true };
let chartOffset = 0;

// Room Obstacles Data
let obstacles = [];
let activeTool = 'wall'; // 'wall' or 'pillar'
let isDrawing = false;
let startX = 0, startY = 0;
let currentX = 0, currentY = 0;

// Initialize Canvas dimensions
function resizeCanvas() {
  const oldWidth = radarCanvas.width;
  const oldHeight = radarCanvas.height;

  radarCanvas.width = radarCanvas.parentElement.clientWidth;
  radarCanvas.height = radarCanvas.parentElement.clientHeight;
  chartCanvas.width = chartCanvas.parentElement.clientWidth;
  chartCanvas.height = chartCanvas.parentElement.clientHeight;

  // Scale target to new canvas sizes if resized
  if (oldWidth > 0 && oldHeight > 0) {
    target.x = (target.x / oldWidth) * radarCanvas.width;
    target.y = (target.y / oldHeight) * radarCanvas.height;
  } else {
    // Initial target positions
    target.x = radarCanvas.width / 2;
    target.y = radarCanvas.height * 0.2;
  }
}

// Log message helper
function addLog(msg, type = 'info') {
  const time = new Date().toLocaleTimeString([], { hour12: false });
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${time}] ${msg}`;
  logsContainer.appendChild(entry);
  
  // Keep logs at max 30 entries
  while (logsContainer.children.length > 30) {
    logsContainer.removeChild(logsContainer.firstChild);
  }
  logsContainer.scrollTop = logsContainer.scrollHeight;
}

// Generate random movements for the target
function updateTarget() {
  // Target moves around upper half of the screen
  target.x += target.dx * 1.5;
  target.y += target.dy * 1.2;

  // Screen constraints
  if (target.x < 50 || target.x > radarCanvas.width - 50) target.dx *= -1;
  if (target.y < 30 || target.y > radarCanvas.height * 0.7) target.dy *= -1;
}

// Check intersection of signal beam with obstacles
function checkSignalIntersections(sourceX, sourceY, targetX, targetY) {
  let attenuation = 0;
  let blocked = false;

  obstacles.forEach(obs => {
    if (obs.type === 'wall') {
      // Line intersection calculation
      const intersects = checkLineIntersection(
        sourceX, sourceY, targetX, targetY,
        obs.x1, obs.y1, obs.x2, obs.y2
      );
      if (intersects) {
        attenuation += 20; // 20 dB loss per custom wall
      }
    } else if (obs.type === 'pillar') {
      // Ray-circle intersection
      const intersects = checkRayCircleIntersection(
        sourceX, sourceY, targetX, targetY,
        obs.x, obs.y, obs.r
      );
      if (intersects) {
        attenuation += 35; // 35 dB loss for thick concrete pillar
      }
    }
  });

  return { attenuation, blocked };
}

// Math line segments intersection
function checkLineIntersection(a1x, a1y, a2x, a2y, b1x, b1y, b2x, b2y) {
  const det = (a2x - a1x) * (b2y - b1y) - (b2x - b1x) * (a2y - a1y);
  if (det === 0) return null; // Parallel

  const lambda = ((b2y - b1y) * (b2x - a1x) + (b1x - b2x) * (b2y - a1y)) / det;
  const gamma = ((a1y - a2y) * (b2x - a1x) + (a2x - a1x) * (b2y - a1y)) / det;

  return (0 < lambda && lambda < 1) && (0 < gamma && gamma < 1);
}

// Ray to circle collision
function checkRayCircleIntersection(sx, sy, tx, ty, cx, cy, r) {
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.hypot(dx, dy);
  
  if (len === 0) return false;

  const uX = dx / len;
  const uY = dy / len;

  // Vector from source to circle center
  const vX = cx - sx;
  const vY = cy - sy;

  // Project center onto ray
  const proj = vX * uX + vY * uY;

  if (proj < 0 || proj > len) return false;

  // Find closest point on segment to center
  const cpX = sx + proj * uX;
  const cpY = sy + proj * uY;

  const dist = Math.hypot(cx - cpX, cy - cpY);
  return dist <= r;
}

// Draw radar sweeps and custom objects
function drawRadarSweep() {
  ctx.clearRect(0, 0, radarCanvas.width, radarCanvas.height);
  
  const width = radarCanvas.width;
  const height = radarCanvas.height;
  const sourceX = width / 2;
  const sourceY = height - 20;

  // 1. Draw grids
  ctx.strokeStyle = 'rgba(57, 255, 20, 0.04)';
  ctx.lineWidth = 1;
  for (let i = 0; i < width; i += 40) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, height); ctx.stroke();
  }
  for (let i = 0; i < height; i += 40) {
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(width, i); ctx.stroke();
  }

  // 2. Draw sweep beam
  if (scanning) {
    sweepAngle = (sweepAngle + 0.015) % (Math.PI * 2);
  }
  const radius = Math.max(width, height);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(sourceX, sourceY);
  ctx.arc(sourceX, sourceY, radius, -Math.PI / 6 - Math.sin(sweepAngle)*0.5, -Math.PI / 6 - Math.sin(sweepAngle)*0.5 - 0.15, true);
  ctx.lineTo(sourceX, sourceY);
  const sweepGlow = ctx.createRadialGradient(sourceX, sourceY, 10, sourceX, sourceY, radius);
  sweepGlow.addColorStop(0, 'rgba(57, 255, 20, 0.12)');
  sweepGlow.addColorStop(1, 'rgba(57, 255, 20, 0)');
  ctx.fillStyle = sweepGlow;
  ctx.fill();
  ctx.restore();

  // 3. Draw Default Wall boundary line
  ctx.strokeStyle = 'rgba(57, 255, 20, 0.15)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(0, height * 0.45);
  ctx.lineTo(width, height * 0.45);
  ctx.stroke();
  ctx.setLineDash([]);

  // 4. Draw Custom Created Room Obstacles
  obstacles.forEach(obs => {
    ctx.strokeStyle = 'var(--neon-green)';
    ctx.fillStyle = 'rgba(57, 255, 20, 0.15)';
    ctx.lineWidth = 3;

    if (obs.type === 'wall') {
      ctx.beginPath();
      ctx.moveTo(obs.x1, obs.y1);
      ctx.lineTo(obs.x2, obs.y2);
      ctx.stroke();
      
      // Draw wall endpoints dots
      ctx.fillStyle = 'var(--neon-green)';
      ctx.beginPath();
      ctx.arc(obs.x1, obs.y1, 4, 0, Math.PI * 2);
      ctx.arc(obs.x2, obs.y2, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (obs.type === 'pillar') {
      ctx.beginPath();
      ctx.arc(obs.x, obs.y, obs.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  });

  // 5. Draw active drawing path placeholder
  if (isDrawing) {
    ctx.strokeStyle = 'var(--neon-blue)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([4, 4]);
    if (activeTool === 'wall') {
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(currentX, currentY);
      ctx.stroke();
    } else if (activeTool === 'pillar') {
      const radiusDist = Math.hypot(currentX - startX, currentY - startY);
      ctx.beginPath();
      ctx.arc(startX, startY, Math.max(10, radiusDist), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // 6. Draw Multipath Bounce lines & calculate attenuation
  if (scanning) {
    const check = checkSignalIntersections(sourceX, sourceY, target.x, target.y);
    
    ctx.beginPath();
    ctx.strokeStyle = check.attenuation > 0 ? 'rgba(255, 71, 87, 0.5)' : 'rgba(0, 242, 254, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.moveTo(sourceX, sourceY);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Stats calculations
    const freq = parseFloat(freqSelect.value);
    const wallType = wallMaterial.value;
    let baseLoss = wallType === 'concrete' ? 35 : (wallType === 'brick' ? 20 : 8);
    
    // Add custom drawing attenuation
    const totalAttenuation = baseLoss + check.attenuation;
    const rssiValDb = -45 - Math.round(totalAttenuation);

    rssiVal.textContent = `${rssiValDb} dBm`;
    phaseVal.textContent = `${Math.max(20, 100 - (totalAttenuation * 0.75)).toFixed(1)}%`;
    dopplerVal.textContent = `${Math.abs(Math.sin(Date.now()*0.002)*target.dx*0.5).toFixed(2)} Hz`;

    // Draw detected target HUD
    ctx.beginPath();
    ctx.arc(target.x, target.y, 22, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(57, 255, 20, 0.6)';
    ctx.lineWidth = 2;
    ctx.fillStyle = 'rgba(57, 255, 20, 0.15)';
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'var(--neon-green)';
    ctx.font = '10px Fira Code';
    ctx.fillText(`Target (X:${Math.round(target.x)}, Y:${Math.round(target.y)})`, target.x + 30, target.y + 4);
  }
}

// Draw Oscilloscope waves chart
function drawCSIChart() {
  chartCtx.clearRect(0, 0, chartCanvas.width, chartCanvas.height);
  
  const w = chartCanvas.width;
  const h = chartCanvas.height;

  // Chart Backdrop grid
  chartCtx.strokeStyle = 'rgba(57, 255, 20, 0.05)';
  chartCtx.lineWidth = 1;
  for (let i = 0; i < w; i += 30) {
    chartCtx.beginPath(); chartCtx.moveTo(i, 0); chartCtx.lineTo(i, h); chartCtx.stroke();
  }
  for (let i = 0; i < h; i += 30) {
    chartCtx.beginPath(); chartCtx.moveTo(0, i); chartCtx.lineTo(w, i); chartCtx.stroke();
  }

  // Draw subcarrier state lines
  chartCtx.beginPath();
  chartCtx.strokeStyle = 'var(--neon-green)';
  chartCtx.lineWidth = 2;

  const step = w / csiSubcarriers;
  chartCtx.moveTo(0, h/2);
  
  for (let i = 0; i < csiSubcarriers; i++) {
    // Generate sine wave models representing subcarriers
    const amp = 30 + Math.sin(i * 0.15 + chartOffset) * 20;
    const noise = (Math.random() - 0.5) * (wallMaterial.value === 'concrete' ? 14 : 5);
    const yVal = h/2 + Math.sin(i * 0.35 + chartOffset) * amp + noise;

    chartCtx.lineTo(i * step, yVal);
  }
  chartCtx.stroke();

  if (scanning) {
    chartOffset += 0.08;
  }
}

// simulated terminal operations
function setupSimulatedDiagnostics() {
  setInterval(() => {
    if (!scanning) return;
    const diagnostics = [
      `CSI Phase lock verified on channel 36 (${freqSelect.value} GHz)`,
      `Centroid coordinate calculation running: (x:${Math.round(target.x)}, y:${Math.round(target.y)})`,
      `MIMO array frame synced. Subcarrier count: ${csiSubcarriers}`,
      `Doppler shift amplitude variation detected: ${dopplerVal.textContent}`,
      `Evaluating multipath reflections on ${obstacles.length} custom wall nodes`
    ];
    const types = ['info', 'alert', 'info', 'alert', 'info'];
    const idx = Math.floor(Math.random() * diagnostics.length);
    addLog(diagnostics[idx], types[idx]);
  }, 4000);
}

// SETUP CUSTOM OBSTACLE DRAWING MOUSE EVENTS
function setupDrawingEvents() {
  radarCanvas.addEventListener('mousedown', (e) => {
    const rect = radarCanvas.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    isDrawing = true;
    currentX = startX;
    currentY = startY;
  });

  radarCanvas.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    const rect = radarCanvas.getBoundingClientRect();
    currentX = e.clientX - rect.left;
    currentY = e.clientY - rect.top;
  });

  radarCanvas.addEventListener('mouseup', () => {
    if (!isDrawing) return;
    isDrawing = false;

    if (activeTool === 'wall') {
      // Only add walls that are at least 15px long to avoid accidental clicks
      if (Math.hypot(currentX - startX, currentY - startY) > 15) {
        obstacles.push({
          type: 'wall',
          x1: startX,
          y1: startY,
          x2: currentX,
          y2: currentY
        });
        addLog(`Custom wall placed. Coordinates: (${Math.round(startX)}, ${Math.round(startY)}) to (${Math.round(currentX)}, ${Math.round(currentY)})`, 'alert');
      }
    } else if (activeTool === 'pillar') {
      const radiusDist = Math.max(10, Math.hypot(currentX - startX, currentY - startY));
      obstacles.push({
        type: 'pillar',
        x: startX,
        y: startY,
        r: radiusDist
      });
      addLog(`Custom concrete pillar placed at coordinate (${Math.round(startX)}, ${Math.round(startY)}) with radius ${Math.round(radiusDist)}px`, 'alert');
    }
  });
}

// SETUP CONTROLS EVENT HANDLERS
function setupEventListeners() {
  scanBtn.addEventListener('click', () => {
    scanning = !scanning;
    scanBtn.textContent = scanning ? 'Stop Sweep' : 'Start Sweep';
    scanBtn.className = scanning ? 'btn btn-primary' : 'btn btn-secondary';
    addLog(scanning ? 'CSI radar sweep resumed.' : 'CSI radar sweep halted.', scanning ? 'info' : 'error');
  });

  resetBtn.addEventListener('click', () => {
    addLog('Recalibrating multipath noise filters...', 'alert');
    target.x = radarCanvas.width / 2;
    target.y = radarCanvas.height * 0.2;
    setTimeout(() => {
      addLog('Calibration completed. Subcarriers synced successfully.', 'alert');
    }, 1000);
  });

  csiResSlider.addEventListener('input', () => {
    csiSubcarriers = parseInt(csiResSlider.value);
    csiResVal.textContent = `${csiSubcarriers} subcarriers`;
  });

  freqSelect.addEventListener('change', () => {
    addLog(`Transmitter carrier frequency shifted to ${freqSelect.value} GHz.`, 'alert');
  });

  wallMaterial.addEventListener('change', () => {
    addLog(`CSI parameters corrected for reinforced ${wallMaterial.value} obstacles.`, 'alert');
  });

  document.querySelectorAll('.mimo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mimo-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      addLog(`Antenna layout switched: ${btn.textContent}`, 'info');
    });
  });

  // Room Editor Tool Handlers
  drawWallBtn.addEventListener('click', () => {
    activeTool = 'wall';
    drawWallBtn.classList.add('active');
    drawPillarBtn.classList.remove('active');
  });

  drawPillarBtn.addEventListener('click', () => {
    activeTool = 'pillar';
    drawPillarBtn.classList.add('active');
    drawWallBtn.classList.remove('active');
  });

  clearRoomBtn.addEventListener('click', () => {
    obstacles = [];
    addLog('Custom room map obstacles cleared.', 'error');
  });
}

// MAIN ANIMATION LOOP
function animate() {
  if (scanning) {
    updateTarget();
  }
  drawRadarSweep();
  drawCSIChart();
  requestAnimationFrame(animate);
}

// START APP ON LOAD
window.addEventListener('load', () => {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  
  setupEventListeners();
  setupDrawingEvents();
  
  addLog('Initializing WiSight RF-CSI Receiver core...');
  addLog('Locking base transmitter frames at 5.0 GHz...', 'info');
  addLog('Calibration verified. Subcarriers ready.', 'info');
  
  setupSimulatedDiagnostics();
  animate();
});
