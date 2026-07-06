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
let target = { x: 0, y: 0, dx: 1, dy: 0.7, detected: false };
let chartOffset = 0;

// Log Messages queue
const logQueue = [];

// Initialize Canvas dimensions
function resizeCanvas() {
  radarCanvas.width = radarCanvas.parentElement.clientWidth;
  radarCanvas.height = radarCanvas.parentElement.clientHeight;
  chartCanvas.width = chartCanvas.parentElement.clientWidth;
  chartCanvas.height = chartCanvas.parentElement.clientHeight;
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

// Generate random movements for the mock wall target
function updateTarget() {
  const wallY = radarCanvas.height * 0.45; // Wall location
  
  // Target moves left and right behind the wall (upper half of screen)
  target.x += target.dx * 1.5;
  target.y += target.dy * 1.2;

  // Screen constraints (Upper half represents "Behind the Wall")
  if (target.x < 50 || target.x > radarCanvas.width - 50) target.dx *= -1;
  if (target.y < 30 || target.y > wallY - 30) target.dy *= -1;
}

// Math helpers for wave drawings
function drawRadarSweep() {
  ctx.clearRect(0, 0, radarCanvas.width, radarCanvas.height);
  
  const width = radarCanvas.width;
  const height = radarCanvas.height;
  const sourceX = width / 2;
  const sourceY = height - 20; // Bottom transmitter
  const wallY = height * 0.45;  // Wall partition

  // 1. Draw grid backdrop lines
  ctx.strokeStyle = 'rgba(57, 255, 20, 0.04)';
  ctx.lineWidth = 1;
  for (let i = 0; i < width; i += 40) {
    ctx.beginPath();
    ctx.moveTo(i, 0); ctx.lineTo(i, height);
    ctx.stroke();
  }
  for (let i = 0; i < height; i += 40) {
    ctx.beginPath();
    ctx.moveTo(0, i); ctx.lineTo(width, i);
    ctx.stroke();
  }

  // 2. Draw sweep sweep radial arcs
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
  sweepGlow.addColorStop(0, 'rgba(57, 255, 20, 0.15)');
  sweepGlow.addColorStop(1, 'rgba(57, 255, 20, 0)');
  ctx.fillStyle = sweepGlow;
  ctx.fill();
  ctx.restore();

  // 3. Draw Solid Physical Wall barrier
  ctx.fillStyle = 'rgba(20, 40, 32, 0.85)';
  ctx.fillRect(0, wallY - 15, width, 30);
  ctx.strokeStyle = '#142820';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, wallY - 15, width, 30);

  // Brick patterns in wall
  ctx.strokeStyle = 'rgba(57, 255, 20, 0.1)';
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 30) {
    ctx.beginPath();
    ctx.moveTo(x, wallY - 15);
    ctx.lineTo(x, wallY + 15);
    ctx.stroke();
  }

  // 4. Trace multipath WiFi bouncing waves
  if (scanning) {
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    // Straight signal path to target
    ctx.moveTo(sourceX, sourceY);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 5. Draw Target representation
  if (scanning) {
    const distToTarget = Math.hypot(target.x - sourceX, target.y - sourceY);
    
    // Simulate Doppler frequency and phase shift based on coordinates
    const freq = parseFloat(freqSelect.value);
    const wallType = wallMaterial.value;
    
    // Calculate simulated RSSI loss through materials
    let dbmLoss = 0;
    if (wallType === 'drywall') dbmLoss = 8;
    else if (wallType === 'brick') dbmLoss = 22;
    else if (wallType === 'concrete') dbmLoss = 38;

    const baseRssi = -40 - Math.round(distToTarget * 0.05);
    const finalRssi = baseRssi - dbmLoss;
    
    rssiVal.textContent = `${finalRssi} dBm`;
    
    const noiseTypes = { drywall: 'Low', brick: 'Medium', concrete: 'High' };
    noiseVal.textContent = noiseTypes[wallType];

    const dopHz = (Math.sin(Date.now() * 0.003) * target.dx * 0.4).toFixed(2);
    dopplerVal.textContent = `${Math.abs(dopHz)} Hz`;

    // Draw detected target halo ring
    ctx.beginPath();
    ctx.arc(target.x, target.y, 25, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(57, 255, 20, 0.6)';
    ctx.lineWidth = 2;
    ctx.fillStyle = 'rgba(57, 255, 20, 0.15)';
    ctx.fill();
    ctx.stroke();

    // Coordinates HUD label
    ctx.fillStyle = varColorText();
    ctx.font = '10px Fira Code';
    ctx.fillText(`Target (X:${Math.round(target.x)}, Y:${Math.round(target.y)})`, target.x + 32, target.y + 4);
    ctx.fillText(`CSI Phase shift: ${(Math.random() * 360).toFixed(1)}°`, target.x + 32, target.y + 16);
  }
}

// Draw Phase Amplitude waves in chart canvas (like hardware oscilloscope)
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

  const resolution = csiSubcarriers;
  const step = w / resolution;
  
  chartCtx.moveTo(0, h/2);
  
  for (let i = 0; i < resolution; i++) {
    // Generate sine waves matching current Doppler frequencies
    const amp = 30 + Math.sin(i * 0.1 + chartOffset) * 20;
    const noise = (Math.random() - 0.5) * (wallMaterial.value === 'concrete' ? 12 : 4);
    const yVal = h/2 + Math.sin(i * 0.4 + chartOffset) * amp + noise;

    chartCtx.lineTo(i * step, yVal);
  }
  chartCtx.stroke();

  if (scanning) {
    chartOffset += 0.08;
  }
}

// Variable HUD colors
function varColorText() {
  return '#39ff14';
}

// Add logs randomly to mock diagnostics operations
function setupSimulatedDiagnostics() {
  setInterval(() => {
    if (!scanning) return;
    const diagnostics = [
      `CSI Phase lock confirmed on channel 36 (${freqSelect.value} GHz)`,
      `Subcarrier SNR: 24.8 dB (Wall type: ${wallMaterial.value})`,
      `Centroid coordinate calculation running: (x:${Math.round(target.x)}, y:${Math.round(target.y)})`,
      `MIMO array frame synced. Subcarrier sub-carrier count: ${csiSubcarriers}`,
      `Doppler shift amplitude variation detected: ${dopplerVal.textContent}`
    ];
    const types = ['info', 'info', 'alert', 'info', 'alert'];
    const idx = Math.floor(Math.random() * diagnostics.length);
    addLog(diagnostics[idx], types[idx]);
  }, 4000);
}

// Setup Event Handlers
function setupEventListeners() {
  // Toggle scanning loop
  scanBtn.addEventListener('click', () => {
    scanning = !scanning;
    scanBtn.textContent = scanning ? 'Stop Sweep' : 'Start Sweep';
    scanBtn.className = scanning ? 'btn btn-primary' : 'btn btn-secondary';
    addLog(scanning ? 'CSI radar sweep resumed.' : 'CSI radar sweep halted.', scanning ? 'info' : 'error');
  });

  // Re-calibrate signal values
  resetBtn.addEventListener('click', () => {
    addLog('Recalibrating multipath noise filters...', 'alert');
    target.x = radarCanvas.width / 2;
    target.y = radarCanvas.height * 0.2;
    setTimeout(() => {
      addLog('Calibration completed. Subcarriers synced successfully.', 'alert');
    }, 1000);
  });

  // CSI subcarrier resolution slider
  csiResSlider.addEventListener('input', () => {
    csiSubcarriers = parseInt(csiResSlider.value);
    csiResVal.textContent = `${csiSubcarriers} subcarriers`;
  });

  // Trigger select logs
  freqSelect.addEventListener('change', () => {
    addLog(`Transmitter carrier shifted to ${freqSelect.value} GHz.`, 'alert');
  });

  wallMaterial.addEventListener('change', () => {
    addLog(`CSI parameters corrected for reinforced ${wallMaterial.value} obstacles.`, 'alert');
  });

  // MIMO config buttons
  document.querySelectorAll('.mimo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mimo-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      addLog(`Antenna layout switched: ${btn.textContent}`, 'info');
    });
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

// Start
window.addEventListener('load', () => {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  
  setupEventListeners();
  addLog('Initializing WiSight RF-CSI Receiver core...');
  addLog('Locking base transmitter frames at 5.0 GHz...', 'info');
  addLog('Calibration verified. Subcarriers ready.', 'info');
  
  setupSimulatedDiagnostics();
  animate();
});
