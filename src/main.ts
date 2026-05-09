import './style.css';

declare const cv: any;
declare const jspdf: any;

// ═══════════════════════════════════════
// State
// ═══════════════════════════════════════
let stream: MediaStream | null = null;
let capturedImageData: ImageData | null = null;
let capturedWidth = 0;
let capturedHeight = 0;
let corners: [number, number][] = [];
let draggingCorner = -1;
let cvReady = false;
let liveCorners: [number, number][] | null = null;
let detectionTimer: ReturnType<typeof setInterval> | null = null;
let cleanupCornerEvents: (() => void) | null = null;

// ═══════════════════════════════════════
// DOM
// ═══════════════════════════════════════
const video       = el<HTMLVideoElement>('video');
const overlay     = el<HTMLCanvasElement>('overlay');
const previewCanvas = el<HTMLCanvasElement>('preview-canvas');
const cornerCanvas  = el<HTMLCanvasElement>('corner-canvas');
const resultCanvas  = el<HTMLCanvasElement>('result-canvas');
const magnifierDiv  = el<HTMLDivElement>('magnifier');
const loadingOverlay = el<HTMLDivElement>('loading-overlay');
const loadingText    = el<HTMLParagraphElement>('loading-text');
const detectBadge    = el<HTMLDivElement>('detect-badge');
const scanGuide      = el<HTMLDivElement>('scan-guide');
const exportModal    = el<HTMLDivElement>('export-modal');
const camHint        = el<HTMLDivElement>('cam-hint');

const startScanBtn    = el<HTMLButtonElement>('start-scan-btn');
const closeCameraBtn  = el<HTMLButtonElement>('close-camera-btn');
const captureBtn      = el<HTMLButtonElement>('capture-btn');
const retakeBtn       = el<HTMLButtonElement>('retake-btn');
const confirmBtn      = el<HTMLButtonElement>('confirm-btn');
const autoFixBtn      = el<HTMLButtonElement>('auto-fix-btn');
const scanAgainBtn    = el<HTMLButtonElement>('scan-again-btn');
const saveImageBtn    = el<HTMLButtonElement>('save-image-btn');
const exportPdfBtn    = el<HTMLButtonElement>('export-pdf-btn');
const shareBtn        = el<HTMLButtonElement>('share-btn');
const clearRecentsBtn = el<HTMLButtonElement>('clear-recents-btn');
const modalCancel     = el<HTMLButtonElement>('modal-cancel');
const modalExport     = el<HTMLButtonElement>('modal-export');
const recentsGrid     = el<HTMLDivElement>('recents-grid');

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

// ═══════════════════════════════════════
// Screen management
// ═══════════════════════════════════════
function showScreen(id: string) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}

function showLoading(text = 'Processing…') {
  loadingText.textContent = text;
  loadingOverlay.classList.add('active');
}
function hideLoading() {
  loadingOverlay.classList.remove('active');
}

function showError(msg: string) {
  const div = document.createElement('div');
  div.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.92);display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:20px;z-index:300;padding:32px;text-align:center;
  `;
  div.innerHTML = `
    <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#ff5555" stroke-width="1.8">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
    <p style="color:#fff;font-size:15px;line-height:1.6;max-width:280px;">${msg}</p>
    <button onclick="location.reload()" style="background:#00C896;color:#000;border:none;
      padding:14px 32px;border-radius:24px;font-size:14px;font-weight:600;cursor:pointer;">Reload</button>
  `;
  document.body.appendChild(div);
}

// ═══════════════════════════════════════
// Camera
// ═══════════════════════════════════════
async function startCamera() {
  showLoading('Starting camera…');
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    video.srcObject = stream;
    await new Promise<void>(res => { video.onloadedmetadata = () => res(); });
    await video.play();
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
    hideLoading();
    showScreen('camera-view');
    startDetectionLoop();
  } catch (err) {
    hideLoading();
    showScreen('home-view');
    showError('Camera access denied. Please allow camera access and reload the page.');
  }
}

function stopCamera() {
  stopDetectionLoop();
  clearOverlay();
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
  liveCorners = null;
  detectBadge.classList.remove('visible');
  scanGuide.classList.remove('detected');
}

// ═══════════════════════════════════════
// Real-time Detection Loop
// ═══════════════════════════════════════
const DETECT_INTERVAL_MS = 250;
const DETECT_MAX_DIM = 640;
const detectCanvas = document.createElement('canvas');

function startDetectionLoop() {
  if (detectionTimer !== null) return;
  detectionTimer = setInterval(runDetection, DETECT_INTERVAL_MS);
}

function stopDetectionLoop() {
  if (detectionTimer !== null) { clearInterval(detectionTimer); detectionTimer = null; }
}

function runDetection() {
  if (!cvReady || !video.videoWidth || !video.videoHeight) return;
  if (!document.getElementById('camera-view')?.classList.contains('active')) return;

  const scale = Math.min(1, DETECT_MAX_DIM / Math.max(video.videoWidth, video.videoHeight));
  const dw = Math.round(video.videoWidth * scale);
  const dh = Math.round(video.videoHeight * scale);
  detectCanvas.width = dw;
  detectCanvas.height = dh;
  detectCanvas.getContext('2d')!.drawImage(video, 0, 0, dw, dh);

  const found = detectDocumentCorners(detectCanvas);
  if (found) {
    liveCorners = found.map(([x, y]) => [x / scale, y / scale] as [number, number]);
    drawOverlay(liveCorners);
    detectBadge.classList.add('visible');
    scanGuide.classList.add('detected');
    camHint.textContent = 'Document detected — tap to capture';
  } else {
    liveCorners = null;
    clearOverlay();
    detectBadge.classList.remove('visible');
    scanGuide.classList.remove('detected');
    camHint.textContent = 'Align document within frame';
  }
}

function drawOverlay(pts: [number, number][]) {
  const ctx = overlay.getContext('2d')!;
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.fillRect(0, 0, overlay.width, overlay.height);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  pts.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  pts.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.closePath();
  ctx.strokeStyle = '#00C896';
  ctx.lineWidth = Math.max(3, overlay.width * 0.004);
  ctx.shadowColor = 'rgba(0,200,150,0.6)';
  ctx.shadowBlur = 10;
  ctx.stroke();
  ctx.shadowBlur = 0;

  const r = Math.max(8, overlay.width * 0.012);
  pts.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#00C896';
    ctx.shadowColor = 'rgba(0,200,150,0.7)';
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function clearOverlay() {
  overlay.getContext('2d')!.clearRect(0, 0, overlay.width, overlay.height);
}

// ═══════════════════════════════════════
// OpenCV: detect 4-corner document
// ═══════════════════════════════════════
function detectDocumentCorners(canvas: HTMLCanvasElement): [number, number][] | null {
  let src: any, gray: any, blurred: any, edges: any, dilated: any, kernel: any,
    contours: any, hierarchy: any;
  try {
    src = cv.imread(canvas);
    gray = new cv.Mat(); blurred = new cv.Mat(); edges = new cv.Mat();
    dilated = new cv.Mat();
    kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    contours = new cv.MatVector(); hierarchy = new cv.Mat();

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 50, 150);
    cv.dilate(edges, dilated, kernel);
    cv.findContours(dilated, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const imgArea = canvas.width * canvas.height;
    let bestApprox: any = null;
    let bestArea = 0;

    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const area = cv.contourArea(c);
      c.delete();
      if (area < imgArea * 0.05 || area > imgArea * 0.98) continue;

      const cont = contours.get(i);
      const peri = cv.arcLength(cont, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(cont, approx, 0.02 * peri, true);
      cont.delete();

      if (approx.rows === 4 && area > bestArea) {
        bestApprox?.delete(); bestArea = area; bestApprox = approx;
      } else { approx.delete(); }
    }

    let result: [number, number][] | null = null;
    if (bestApprox && bestArea > imgArea * 0.05) {
      const pts: [number, number][] = [];
      for (let i = 0; i < 4; i++) pts.push([bestApprox.data32S[i * 2], bestApprox.data32S[i * 2 + 1]]);
      result = orderCorners(pts);
      bestApprox.delete();
    } else { bestApprox?.delete(); }

    return result;
  } catch (e) {
    console.warn('Edge detection error:', e);
    return null;
  } finally {
    src?.delete(); gray?.delete(); blurred?.delete(); edges?.delete();
    dilated?.delete(); kernel?.delete(); contours?.delete(); hierarchy?.delete();
  }
}

function orderCorners(pts: [number, number][]): [number, number][] {
  const sorted = [...pts].sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
  const tl = sorted[0], br = sorted[3];
  const mid = [sorted[1], sorted[2]];
  const tr = mid[0][0] >= mid[1][0] ? mid[0] : mid[1];
  const bl = mid[0][0] >= mid[1][0] ? mid[1] : mid[0];
  return [tl, tr, br, bl];
}

// ═══════════════════════════════════════
// Capture
// ═══════════════════════════════════════
function captureFrame() {
  if (!video.videoWidth) return;
  stopDetectionLoop();
  clearOverlay();

  capturedWidth = video.videoWidth;
  capturedHeight = video.videoHeight;

  const tmp = document.createElement('canvas');
  tmp.width = capturedWidth; tmp.height = capturedHeight;
  tmp.getContext('2d')!.drawImage(video, 0, 0, capturedWidth, capturedHeight);
  capturedImageData = tmp.getContext('2d')!.getImageData(0, 0, capturedWidth, capturedHeight);

  previewCanvas.width = capturedWidth;
  previewCanvas.height = capturedHeight;
  previewCanvas.getContext('2d')!.putImageData(capturedImageData, 0, 0);

  corners = liveCorners ?? (cvReady ? detectDocumentCorners(tmp) : null) ?? defaultCorners(capturedWidth, capturedHeight);

  setupCornerCanvas();
  showScreen('preview-view');
}

function defaultCorners(w: number, h: number): [number, number][] {
  const mx = w * 0.08, my = h * 0.08;
  return [[mx, my], [w - mx, my], [w - mx, h - my], [mx, h - my]];
}

// ═══════════════════════════════════════
// Corner Canvas — manual adjustment
// ═══════════════════════════════════════
function setupCornerCanvas() {
  cornerCanvas.width = capturedWidth;
  cornerCanvas.height = capturedHeight;
  drawCorners();
  cleanupCornerEvents?.();

  const onTouchStart = (e: TouchEvent) => {
    e.preventDefault();
    const t = e.touches[0];
    draggingCorner = nearestCorner(...canvasCoords(cornerCanvas, t.clientX, t.clientY));
  };
  const onTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    if (draggingCorner < 0) return;
    const t = e.touches[0];
    const [x, y] = canvasCoords(cornerCanvas, t.clientX, t.clientY);
    moveCorner(draggingCorner, x, y);
    drawMagnifier(x, y, t.clientX, t.clientY);
  };
  const onTouchEnd = () => { draggingCorner = -1; hideMagnifier(); };
  const onMouseDown = (e: MouseEvent) => {
    draggingCorner = nearestCorner(...canvasCoords(cornerCanvas, e.clientX, e.clientY));
  };
  const onMouseMove = (e: MouseEvent) => {
    if (draggingCorner < 0) return;
    const [x, y] = canvasCoords(cornerCanvas, e.clientX, e.clientY);
    moveCorner(draggingCorner, x, y);
  };
  const onMouseUp = () => { draggingCorner = -1; hideMagnifier(); };

  cornerCanvas.addEventListener('touchstart', onTouchStart, { passive: false });
  cornerCanvas.addEventListener('touchmove',  onTouchMove,  { passive: false });
  cornerCanvas.addEventListener('touchend',   onTouchEnd);
  cornerCanvas.addEventListener('mousedown',  onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup',   onMouseUp);

  cleanupCornerEvents = () => {
    cornerCanvas.removeEventListener('touchstart', onTouchStart);
    cornerCanvas.removeEventListener('touchmove',  onTouchMove);
    cornerCanvas.removeEventListener('touchend',   onTouchEnd);
    cornerCanvas.removeEventListener('mousedown',  onMouseDown);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup',   onMouseUp);
  };
}

function canvasCoords(canvas: HTMLCanvasElement, cx: number, cy: number): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [(cx - r.left) * (canvas.width / r.width), (cy - r.top) * (canvas.height / r.height)];
}

function nearestCorner(x: number, y: number): number {
  const threshold = Math.min(capturedWidth, capturedHeight) * 0.1;
  let best = -1, bestDist = Infinity;
  for (let i = 0; i < corners.length; i++) {
    const d = dist(corners[i], [x, y]);
    if (d < threshold && d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

function moveCorner(idx: number, x: number, y: number) {
  corners[idx] = [Math.max(0, Math.min(capturedWidth, x)), Math.max(0, Math.min(capturedHeight, y))];
  drawCorners();
}

function drawCorners() {
  const ctx = cornerCanvas.getContext('2d')!;
  ctx.clearRect(0, 0, cornerCanvas.width, cornerCanvas.height);

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.fillRect(0, 0, cornerCanvas.width, cornerCanvas.height);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.moveTo(corners[0][0], corners[0][1]);
  corners.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(corners[0][0], corners[0][1]);
  corners.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.closePath();
  ctx.strokeStyle = '#00C896';
  ctx.lineWidth = Math.max(3, capturedWidth * 0.004);
  ctx.stroke();

  const r = Math.max(18, Math.min(capturedWidth, capturedHeight) * 0.035);
  corners.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#00C896';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.38, y); ctx.lineTo(x + r * 0.38, y);
    ctx.moveTo(x, y - r * 0.38); ctx.lineTo(x, y + r * 0.38);
    ctx.stroke();
  });
}

// Magnifier
function drawMagnifier(canvasX: number, canvasY: number, clientX: number, clientY: number) {
  const SIZE = 80;
  const ZOOM = 2.5;
  const container = document.getElementById('preview-container')!;
  const cr = container.getBoundingClientRect();
  const offX = clientX - cr.left;
  const offY = clientY - cr.top;

  // Position magnifier above and slightly offset from finger
  let mx = offX - SIZE / 2;
  let my = offY - SIZE - 20;
  if (my < 4) my = offY + 24;
  mx = Math.max(4, Math.min(cr.width - SIZE - 4, mx));

  magnifierDiv.style.display = 'block';
  magnifierDiv.style.left = `${mx}px`;
  magnifierDiv.style.top = `${my}px`;

  const mCtx = document.createElement('canvas');
  mCtx.width = SIZE;
  mCtx.height = SIZE;
  const ctx = mCtx.getContext('2d')!;

  const srcX = canvasX - (SIZE / 2) / ZOOM;
  const srcY = canvasY - (SIZE / 2) / ZOOM;
  const srcW = SIZE / ZOOM;
  const srcH = SIZE / ZOOM;

  ctx.drawImage(previewCanvas,
    srcX, srcY, srcW, srcH,
    0, 0, SIZE, SIZE);

  // Crosshair
  ctx.strokeStyle = 'rgba(0,200,150,0.9)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(SIZE / 2, 0); ctx.lineTo(SIZE / 2, SIZE);
  ctx.moveTo(0, SIZE / 2); ctx.lineTo(SIZE, SIZE / 2);
  ctx.stroke();

  magnifierDiv.innerHTML = '';
  magnifierDiv.appendChild(mCtx);
}

function hideMagnifier() {
  magnifierDiv.style.display = 'none';
}

// ═══════════════════════════════════════
// Auto Fix
// ═══════════════════════════════════════
function autoFix() {
  if (!capturedImageData) return;
  const tmp = document.createElement('canvas');
  tmp.width = capturedWidth; tmp.height = capturedHeight;
  tmp.getContext('2d')!.putImageData(capturedImageData, 0, 0);
  const detected = cvReady ? detectDocumentCorners(tmp) : null;
  if (detected) {
    corners = detected;
    drawCorners();
  } else {
    const hint = document.createElement('div');
    hint.textContent = 'No document edges found — adjust manually';
    hint.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
      background:rgba(255,80,80,0.9);color:#fff;padding:10px 18px;border-radius:20px;
      font-size:13px;z-index:100;`;
    document.body.appendChild(hint);
    setTimeout(() => hint.remove(), 2400);
  }
}

// ═══════════════════════════════════════
// Process Document (keep color, no B&W)
// ═══════════════════════════════════════
function processDocument() {
  if (!capturedImageData) return;
  if (!cvReady) { alert('OpenCV is still loading, please wait a moment.'); return; }

  showLoading('Cropping & enhancing…');

  setTimeout(() => {
    let src: any, srcPts: any, dstPts: any, M: any, warped: any,
      brightened: any, kernel: any, sharpened: any;
    try {
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = capturedWidth; srcCanvas.height = capturedHeight;
      srcCanvas.getContext('2d')!.putImageData(capturedImageData!, 0, 0);
      src = cv.imread(srcCanvas);

      // Inset corners — top gets a larger nudge
      const ixSide   = capturedWidth  * 0.018;
      const iyTop    = capturedHeight * 0.028;
      const iyBottom = capturedHeight * 0.018;
      const [tl, tr, br, bl] = corners;
      const ic: [number, number][] = [
        [tl[0] + ixSide, tl[1] + iyTop],
        [tr[0] - ixSide, tr[1] + iyTop],
        [br[0] - ixSide, br[1] - iyBottom],
        [bl[0] + ixSide, bl[1] - iyBottom],
      ];

      const W = Math.round(Math.max(dist(ic[1], ic[0]), dist(ic[2], ic[3])));
      const H = Math.round(Math.max(dist(ic[0], ic[3]), dist(ic[1], ic[2])));
      if (W < 10 || H < 10) throw new Error('Selection area too small');

      srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
        ic[0][0], ic[0][1], ic[1][0], ic[1][1],
        ic[2][0], ic[2][1], ic[3][0], ic[3][1],
      ]);
      dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [0,0, W-1,0, W-1,H-1, 0,H-1]);

      M = cv.getPerspectiveTransform(srcPts, dstPts);
      warped = new cv.Mat();
      cv.warpPerspective(src, warped, M, new cv.Size(W, H), cv.INTER_CUBIC, cv.BORDER_REPLICATE);

      // Brightness + contrast lift (full color)
      brightened = new cv.Mat();
      warped.convertTo(brightened, -1, 1.12, 18);

      // Single mild sharpen
      kernel = cv.matFromArray(3, 3, cv.CV_32F, [0,-0.4,0, -0.4,2.6,-0.4, 0,-0.4,0]);
      sharpened = new cv.Mat();
      cv.filter2D(brightened, sharpened, -1, kernel);

      resultCanvas.width = W;
      resultCanvas.height = H;
      cv.imshow(resultCanvas, sharpened);

      saveRecentScan();
      hideLoading();
      showScreen('result-view');
    } catch (e) {
      hideLoading();
      console.error('Processing error:', e);
      alert('Could not process the image. Try adjusting the corners and confirming again.');
    } finally {
      src?.delete(); srcPts?.delete(); dstPts?.delete(); M?.delete();
      warped?.delete(); brightened?.delete(); kernel?.delete(); sharpened?.delete();
    }
  }, 60);
}

function dist(a: [number, number], b: [number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
}

// ═══════════════════════════════════════
// Recent Scans
// ═══════════════════════════════════════
const RECENT_KEY = 'scanner_recents';
const RECENT_MAX = 4;
const THUMB_SIZE = 200;

function saveRecentScan() {
  try {
    const thumb = document.createElement('canvas');
    const ratio = resultCanvas.width / resultCanvas.height;
    if (ratio >= 1) { thumb.width = THUMB_SIZE; thumb.height = Math.round(THUMB_SIZE / ratio); }
    else            { thumb.height = THUMB_SIZE; thumb.width = Math.round(THUMB_SIZE * ratio); }
    thumb.getContext('2d')!.drawImage(resultCanvas, 0, 0, thumb.width, thumb.height);
    const dataUrl = thumb.toDataURL('image/jpeg', 0.7);
    const stored: string[] = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    stored.unshift(dataUrl);
    if (stored.length > RECENT_MAX) stored.length = RECENT_MAX;
    localStorage.setItem(RECENT_KEY, JSON.stringify(stored));
    renderRecents();
  } catch { /* storage may be unavailable */ }
}

function renderRecents() {
  try {
    const stored: string[] = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    if (!stored.length) {
      recentsGrid.innerHTML = `
        <div class="no-recents">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.3">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <span>No recent scans yet</span>
        </div>`;
      return;
    }
    recentsGrid.innerHTML = stored.map((url, i) =>
      `<div class="recent-thumb" data-idx="${i}"><img src="${url}" alt="Scan ${i+1}" loading="lazy"></div>`
    ).join('');
  } catch {}
}

// ═══════════════════════════════════════
// Export — PDF
// ═══════════════════════════════════════
let selectedFormat = 'auto';
let selectedQuality = 'high';

function openExportModal() {
  exportModal.classList.add('open');
}
function closeExportModal() {
  exportModal.classList.remove('open');
}

function exportPDF() {
  if (!resultCanvas.width) return;
  closeExportModal();
  showLoading('Generating PDF…');

  setTimeout(() => {
    try {
      const { jsPDF } = jspdf;
      const quality = selectedQuality === 'ultra' ? 1.0 : selectedQuality === 'high' ? 0.95 : 0.85;
      const imgData = resultCanvas.toDataURL('image/jpeg', quality);

      const cW = resultCanvas.width;
      const cH = resultCanvas.height;
      const isLandscape = cW > cH;

      // Paper dimensions in mm
      const paperSizes: Record<string, [number, number]> = {
        a4:     [210, 297],
        a3:     [297, 420],
        letter: [215.9, 279.4],
      };

      let pdf: any;
      if (selectedFormat === 'auto') {
        const pxPerMm = 96 / 25.4;
        const wMm = cW / pxPerMm;
        const hMm = cH / pxPerMm;
        const orient = isLandscape ? 'landscape' : 'portrait';
        pdf = new jsPDF({ orientation: orient, unit: 'mm', format: [wMm, hMm] });
        pdf.addImage(imgData, 'JPEG', 0, 0, wMm, hMm, '', 'FAST');
      } else {
        let [pw, ph] = paperSizes[selectedFormat];
        if (isLandscape) [pw, ph] = [ph, pw];
        const orient: 'landscape' | 'portrait' = isLandscape ? 'landscape' : 'portrait';
        pdf = new jsPDF({ orientation: orient, unit: 'mm', format: selectedFormat === 'a3' ? 'a3' : selectedFormat === 'a4' ? 'a4' : [pw, ph] });

        // Scale to fit with 8mm margin
        const margin = 8;
        const maxW = pw - margin * 2;
        const maxH = ph - margin * 2;
        const imgRatio = cW / cH;
        const pageRatio = maxW / maxH;
        let drawW: number, drawH: number;
        if (imgRatio > pageRatio) { drawW = maxW; drawH = maxW / imgRatio; }
        else                      { drawH = maxH; drawW = maxH * imgRatio; }

        const x = margin + (maxW - drawW) / 2;
        const y = margin + (maxH - drawH) / 2;
        pdf.addImage(imgData, 'JPEG', x, y, drawW, drawH, '', 'FAST');
      }

      const date = new Date().toISOString().slice(0, 10);
      pdf.save(`scan-${date}.pdf`);
      hideLoading();
    } catch (e) {
      hideLoading();
      console.error('PDF export error:', e);
      alert('PDF export failed. Please try again.');
    }
  }, 80);
}

// ═══════════════════════════════════════
// Save Image
// ═══════════════════════════════════════
function saveImage() {
  resultCanvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scan_${Date.now()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}

// ═══════════════════════════════════════
// Share
// ═══════════════════════════════════════
async function shareImage() {
  if (!('share' in navigator)) { saveImage(); return; }
  try {
    resultCanvas.toBlob(async blob => {
      if (!blob) return;
      const file = new File([blob], `scan_${Date.now()}.png`, { type: 'image/png' });
      await navigator.share({ files: [file], title: 'Scanned Document' });
    }, 'image/png');
  } catch (e) {
    console.warn('Share failed:', e);
    saveImage();
  }
}

// ═══════════════════════════════════════
// Segmented controls
// ═══════════════════════════════════════
function setupSegment(containerId: string, onChange: (val: string) => void) {
  const container = document.getElementById(containerId)!;
  container.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.seg-btn') as HTMLButtonElement | null;
    if (!btn) return;
    container.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    onChange(btn.dataset.val!);
  });
}

// ═══════════════════════════════════════
// Events
// ═══════════════════════════════════════
startScanBtn.addEventListener('click', startCamera);

closeCameraBtn.addEventListener('click', () => {
  stopCamera();
  showScreen('home-view');
});

captureBtn.addEventListener('click', captureFrame);

retakeBtn.addEventListener('click', () => {
  cleanupCornerEvents?.();
  capturedImageData = null;
  corners = [];
  liveCorners = null;
  showScreen('camera-view');
  startDetectionLoop();
});

confirmBtn.addEventListener('click', processDocument);

autoFixBtn.addEventListener('click', autoFix);

scanAgainBtn.addEventListener('click', () => {
  capturedImageData = null;
  corners = [];
  liveCorners = null;
  showScreen('home-view');
  stopCamera();
});

saveImageBtn.addEventListener('click', saveImage);
exportPdfBtn.addEventListener('click', openExportModal);
shareBtn.addEventListener('click', shareImage);

clearRecentsBtn.addEventListener('click', () => {
  localStorage.removeItem(RECENT_KEY);
  renderRecents();
});

// Export modal
modalCancel.addEventListener('click', closeExportModal);
modalExport.addEventListener('click', exportPDF);
exportModal.addEventListener('click', (e) => {
  if (e.target === exportModal) closeExportModal();
});

setupSegment('format-seg', (val) => { selectedFormat = val; });
setupSegment('quality-seg', (val) => { selectedQuality = val; });

// ═══════════════════════════════════════
// Init
// ═══════════════════════════════════════
function waitForCv(cb: () => void) {
  const check = () => {
    try { if (typeof cv !== 'undefined' && cv.Mat) { cvReady = true; cb(); } else setTimeout(check, 200); }
    catch { setTimeout(check, 200); }
  };
  if ((window as any).cvReady) check();
  else {
    document.addEventListener('opencv-ready', () => setTimeout(check, 100));
    setTimeout(() => { if (!cvReady) check(); }, 8000);
  }
}

renderRecents();
waitForCv(() => console.log('OpenCV ready'));
