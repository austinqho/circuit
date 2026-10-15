const elements = {
  product: document.querySelector('#productSim'),
  cursor: document.querySelector('#demoCursor'),
  resume: document.querySelector('#resumeDemo'),
  workflowTrigger: document.querySelector('#workflowTrigger'),
  workflowMenu: document.querySelector('#workflowMenu'),
  traceState: document.querySelector('#traceState'),
  traceBadge: document.querySelector('#traceBadge'),
  traceHeadline: document.querySelector('#traceHeadline'),
  feed: document.querySelector('#traceFeed'),
  evidence: document.querySelector('#evidenceNote'),
};

let tracerPreviewSwipeStart = null;
window.addEventListener('wheel', (event) => {
  if (Math.abs(event.deltaX) < 18 || Math.abs(event.deltaX) < Math.abs(event.deltaY)) return;
  event.preventDefault();
  window.parent.postMessage({ source: 'tracer-preview-carousel', direction: event.deltaX > 0 ? 'next' : 'previous' }, '*');
}, { passive: false });
window.addEventListener('pointerdown', (event) => {
  tracerPreviewSwipeStart = { x: event.clientX, y: event.clientY };
}, { passive: true });
window.addEventListener('pointerup', (event) => {
  if (!tracerPreviewSwipeStart) return;
  const deltaX = event.clientX - tracerPreviewSwipeStart.x;
  const deltaY = event.clientY - tracerPreviewSwipeStart.y;
  tracerPreviewSwipeStart = null;
  if (Math.abs(deltaX) > 55 && Math.abs(deltaX) > Math.abs(deltaY)) {
    window.parent.postMessage({ source: 'tracer-preview-carousel', direction: deltaX < 0 ? 'next' : 'previous' }, '*');
  }
}, { passive: true });

const browserEvidence = 'Browser adapter behavior · UI structure derived from Palmier Pro source eece943';
const palmierAssetBase = '/test/browser/palmier-sample';
const palmierAssetById = {
  '55EA6BFB-E5AE-433F-82BB-53882FD17B49': { src: `${palmierAssetBase}/web/ai-video.mp4`, poster: `${palmierAssetBase}/web/ai-video.jpg` },
  'F7E65274-78C4-4267-8E14-95CBB160F3DE': { src: `${palmierAssetBase}/media/gen-F7E65274.png`, poster: `${palmierAssetBase}/media/gen-F7E65274.png` },
  '7EA0B2A4-3715-4116-988B-612C2D0BEB1F': { src: `${palmierAssetBase}/media/pasted-2200F311.png`, poster: `${palmierAssetBase}/media/pasted-2200F311.png` },
  '95C0FC80-61F3-45E5-8A2D-AE55D375CF5E': { src: `${palmierAssetBase}/media/clip-B0CA25A7.mp4`, poster: `${palmierAssetBase}/web/ai-cover.jpg` },
  '14EB3F30-8099-4E0B-BD71-8FD216CA48A1': { src: `${palmierAssetBase}/media/gen-14EB3F30.m4a`, poster: `${palmierAssetBase}/web/ai-cover.jpg` },
  'E1790DBD-EC57-4013-827F-8383AF1EF690': { src: `${palmierAssetBase}/web/interview-cam02.mp4`, poster: `${palmierAssetBase}/web/cam02.jpg` },
  'A713A3A2-3AED-4B2C-A976-6CFAB939AEC9': { src: `${palmierAssetBase}/web/interview-cam01.mp4`, poster: `${palmierAssetBase}/web/cam01.jpg` },
};
const palmierTimelineAssets = {
  'AI Video': { src: `${palmierAssetBase}/media/clip-B0CA25A7.mp4`, poster: `${palmierAssetBase}/web/ai-cover.jpg`, duration: 12, start: 0 },
  'Real Footage': { src: `${palmierAssetBase}/web/interview-cam01.mp4`, poster: `${palmierAssetBase}/web/cam01.jpg`, duration: 23.208, start: 2.875 },
  'Real Footage Vertical': { src: `${palmierAssetBase}/web/interview-cam01.mp4`, poster: `${palmierAssetBase}/web/cam01.jpg`, duration: 23.208, start: 2.875 },
};
let palmierProject;
let palmierMedia;
let palmierDataPromise;
let activePalmierPreview = { kind: 'timeline', name: 'AI Video' };
const palmierWorkflows = [
  {
    id: 'edit-title', title: 'Edit a title clip', description: 'Select a title, inspect it, then split it at the playhead.',
    steps: [
      { target: '[data-action="select-clip"]', sentence: 'Selected “try it now!” on the timeline', effect: 'Changed the active timeline selection', chain: 'Timeline clip → browser editor selection → clip inspector', evidence: browserEvidence },
      { target: '[data-action="split-clip"]', sentence: 'Split the selected title clip at the playhead', effect: 'Changed the timeline locally', chain: 'Split control → browser timeline mutation → two clip segments', evidence: browserEvidence },
    ],
  },
  {
    id: 'browse-media', title: 'Browse project media', description: 'Open the real-footage folder, inspect the edited timeline, then preview a camera original.',
    steps: [
      { target: '[data-action="open-folder"][data-folder-id="2C206752-7273-4DC5-AB03-BE7327F8D1A7"]', sentence: 'Opened the Real Footage Example folder', effect: 'Loaded four real sample items', chain: 'Library folder → media.json roster → media grid', evidence: 'Palmier Sample media.json · Real Footage Example' },
      { target: '[data-action="open-timeline-media"][data-timeline="Real Footage"]', sentence: 'Opened the Real Footage edit', effect: 'Loaded the real interview footage into the preview', chain: 'Timeline media item → project.json timeline → source media', evidence: 'Palmier Sample project.json · Real Footage timeline' },
      { target: '[data-action="open-media"][data-media-id="E1790DBD-EC57-4013-827F-8383AF1EF690"]', sentence: 'Previewed the second interview camera', effect: 'Loaded the original 33-second video and audio', chain: 'Media item → media.json id → import-E1790DBD.mov', evidence: 'Palmier Sample media.json · E1790DBD-EC57-4013-827F-8383AF1EF690' },
    ],
  },
  {
    id: 'compare-timelines', title: 'Compare three timelines', description: 'Switch between AI, landscape, and vertical edits.',
    steps: [
      { target: '[data-action="timeline-tab"][data-timeline="Real Footage"]', sentence: 'Switched to the Real Footage timeline', effect: 'Changed the active timeline', chain: 'Timeline tab → active sequence → preview', evidence: browserEvidence },
      { target: '[data-action="timeline-tab"][data-timeline="Real Footage Vertical"]', sentence: 'Switched to the vertical edit', effect: 'Changed the active timeline and preview shape', chain: 'Vertical timeline tab → active sequence → portrait preview', evidence: browserEvidence },
      { target: '[data-action="timeline-tab"][data-timeline="AI Video"]', sentence: 'Returned to the AI Video timeline', effect: 'Changed the active timeline', chain: 'AI Video tab → active sequence → preview', evidence: browserEvidence },
    ],
  },
  {
    id: 'preview-cut', title: 'Preview the current cut', description: 'Start playback, watch the preview, then pause.',
    steps: [
      { target: '[data-action="toggle-play"]', sentence: 'Started preview playback', effect: 'Changed local playback state', chain: 'Play control → preview playback', evidence: browserEvidence },
      { target: '[data-action="toggle-play"]', sentence: 'Paused preview playback', effect: 'Changed local playback state', chain: 'Pause control → preview playback', evidence: browserEvidence },
    ],
  },
  {
    id: 'prepare-export', title: 'Prepare an export', description: 'Open the export sheet, inspect output settings, and close it safely.',
    steps: [
      { target: '[data-action="export-project"]', sentence: 'Opened the export settings', effect: 'Changed the visible interface', chain: 'Export control → export options sheet', evidence: 'Browser adapter behavior · no file is exported from this demo' },
      { target: '[data-action="close-export"]', sentence: 'Closed the export settings without exporting', effect: 'Changed the visible interface', chain: 'Done control → export sheet dismissed', evidence: 'Browser adapter behavior · no file was written' },
    ],
  },
];
let activeWorkflowIndex = 0;
let palmierSteps = palmierWorkflows[activeWorkflowIndex].steps;

const slides = [
  {
    id: 'palmier',
    name: 'Palmier Pro',
    kind: 'Browser adapter',
    mode: 'Interactive browser build',
    badge: 'Browser build',
    headline: 'Watching the timeline',
    evidence: 'Palmier Pro UI adapted from open-source SwiftUI/AppKit at eece943 · demo effects stay local',
    steps: palmierSteps,
  },
  {
    id: 'librechat',
    name: 'LibreChat',
    kind: 'Live target',
    mode: 'Real application',
    badge: 'Live',
    headline: 'Waiting for an interaction',
    evidence: 'Real interactions are captioned from the current ProductTrace artifacts',
    description: 'Use the real LibreChat deployment and watch its source-grounded trace arrive.',
    actionLabel: 'Open the full live demo ↗',
    actionHref: '/live-demo',
    steps: [],
  },
  {
    id: 'add',
    name: 'Your product',
    kind: 'Coming next',
    mode: 'Repository intake',
    badge: 'Next',
    headline: 'Bring your own repository',
    evidence: 'No analysis starts from this preview form',
    description: 'The third position is reserved for pasting a repository and generating its map.',
    actionLabel: 'Repository intake coming soon',
    actionHref: '',
    steps: [],
  },
];

let slideIndex = 0;
let stepIndex = 0;
let paused = false;
let playbackTimer;
let liveTarget;
let liveStream;

function palmierIcon(name, className = '') {
  return `<img class="pp-icon${className ? ` ${className}` : ''}" src="/test/browser/palmier-icons/${name}.png" data-sf-symbol="${name}" alt="" aria-hidden="true">`;
}

const palmierMarkup = () => `
  <div class="palmier-shell" data-browser-app="palmier-pro">
    <header class="pp-titlebar">
      <div class="pp-panel-toggles">
        <button type="button" aria-label="Agent Panel">${palmierIcon('bubble.left.fill')}</button>
        <button type="button" aria-label="Media Panel" data-action="toggle-media">${palmierIcon('sidebar.left')}</button>
        <button type="button" aria-label="Inspector Panel" data-action="toggle-inspector">${palmierIcon('sidebar.right')}</button>
      </div>
      <strong>Palmier Sample <span>${palmierIcon('chevron.down')}</span></strong>
      <div class="pp-title-actions">
        <button class="pp-export" type="button" data-action="export-project">${palmierIcon('square.and.arrow.up')} Export</button>
        <button class="pp-user-avatar" type="button" aria-label="Demo Editor, demo.editor@gmail.com" title="demo.editor@gmail.com">D</button>
      </div>
    </header>

    <div class="pp-workspace">
      <aside class="pp-media-panel">
        <nav class="pp-tabs" aria-label="Media sections">
          <button class="active" type="button" data-action="media-tab" data-tab="media">${palmierIcon('folder')}<span>Media</span></button>
          <button type="button" data-action="media-tab" data-tab="index">${palmierIcon('list.bullet.rectangle')}<span>Index</span></button>
          <button type="button" data-action="media-tab" data-tab="captions">${palmierIcon('captions.bubble')}<span>Captions</span></button>
          <button type="button" data-action="media-tab" data-tab="audio">${palmierIcon('waveform')}<span>Audio</span></button>
        </nav>
        <div class="pp-media-body" data-media-body>
          <div class="pp-media-tools">
            <button type="button">Import</button><button class="primary" type="button">Generate</button><span>${palmierIcon('ellipsis')}</span>
            <span class="pp-smart-search">${palmierIcon('magnifyingglass')} Smart search</span>
          </div>
          <div class="pp-library-title"><strong>Library</strong><span>2 items</span></div>
          <div class="pp-folder-grid">
            <button type="button" data-action="open-folder" data-folder-id="5158E8B0-0973-4078-AA27-1E1ABC335775"><i>${palmierIcon('folder.fill')}</i><b>AI Video Example</b><small>6</small></button>
            <button type="button" data-action="open-folder" data-folder-id="2C206752-7273-4DC5-AB03-BE7327F8D1A7"><i>${palmierIcon('folder.fill')}</i><b>Real Footage Example</b><small>4</small></button>
          </div>
        </div>
      </aside>

      <section class="pp-preview-panel">
        <header><button type="button" aria-label="Back">${palmierIcon('chevron.left')}</button><button type="button" aria-label="Forward">${palmierIcon('chevron.right')}</button><strong data-preview-name>AI Video</strong><span>${palmierIcon('ellipsis')}</span></header>
        <div class="pp-preview-canvas">
          <div class="pp-film-frame" data-film-frame>
            <video data-preview-video playsinline preload="metadata" poster="${palmierAssetBase}/web/ai-cover.jpg">
              <source src="${palmierAssetBase}/media/clip-B0CA25A7.mp4" type="video/mp4">
            </video>
            <img data-preview-image alt="" hidden>
            <div class="pp-audio-preview" data-preview-audio-shell hidden><span>Sonilo Music</span><audio data-preview-audio preload="metadata"></audio></div>
            <div class="pp-preview-title" data-preview-title><em>try it now!</em></div>
            <p data-preview-caption hidden></p>
          </div>
        </div>
        <footer class="pp-transport">
          <time data-current-time>00:00:01:08</time><span>/ 00:00:12:00</span>
          <button type="button" aria-label="Go to beginning">${palmierIcon('backward.end.fill')}</button><button type="button" aria-label="Previous frame">${palmierIcon('backward.frame.fill')}</button>
          <button class="pp-play" type="button" data-action="toggle-play" aria-label="Play preview">${palmierIcon('play.fill')}</button>
          <button type="button" aria-label="Next frame">${palmierIcon('forward.frame.fill')}</button><button type="button" aria-label="Go to end">${palmierIcon('forward.end.fill')}</button>
          <span class="pp-fit">${palmierIcon('magnifyingglass')} Fit</span>
        </footer>
      </section>

      <aside class="pp-inspector-panel" data-inspector>
        <header>${palmierIcon('movieclapper')} <strong data-inspector-title>Project Settings</strong><span>0:12</span></header>
        <div class="pp-inspector-body" data-inspector-body>
          <h3>${palmierIcon('chevron.down')} Canvas</h3>
          <label><span>Resolution</span><button type="button">736 × 400 ${palmierIcon('chevron.down')}</button></label>
          <label><span>Frame Rate</span><button type="button">24 fps ${palmierIcon('chevron.down')}</button></label>
          <label><span>Aspect Ratio</span><button type="button">46:25 ${palmierIcon('chevron.down')}</button></label>
        </div>
      </aside>

      <section class="pp-timeline-panel">
        <nav class="pp-sequences" aria-label="Timelines">
          <button type="button" aria-label="Timeline menu">${palmierIcon('ellipsis')}</button>
          <button class="active" type="button" data-action="timeline-tab" data-timeline="AI Video">AI Video</button>
          <button type="button" data-action="timeline-tab" data-timeline="Real Footage">Real Footage</button>
          <button type="button" data-action="timeline-tab" data-timeline="Real Footage Vertical">Real Footage Vertical</button>
          <button type="button" aria-label="New timeline">${palmierIcon('plus')}</button>
        </nav>
        <div class="pp-timeline-tools">
          <button class="active" type="button" aria-label="Toggle timeline tabs">${palmierIcon('film.stack.fill')}</button><i></i>
          <button type="button" aria-label="Undo">${palmierIcon('arrow.uturn.backward')}</button><button type="button" aria-label="Redo">${palmierIcon('arrow.uturn.forward')}</button><i></i><button class="active" type="button" aria-label="Pointer">${palmierIcon('cursorarrow')}</button>
          <button type="button" data-action="split-clip" aria-label="Split selected clip">${palmierIcon('scissors')}</button>
          <button type="button" aria-label="Trim">${palmierIcon('arrow.left.and.right')}</button><i></i><button type="button" aria-label="Split at playhead">${palmierIcon('square.split.2x1')}</button><button type="button" aria-label="Set range start">[</button><button type="button" aria-label="Set range end">]</button><i></i><button type="button" aria-label="Add text">T</button><button type="button" aria-label="Add marker"><span class="pp-marker-icon" data-source-shape="TimelineMarkerShape"></span></button><button type="button" aria-label="Marker options">${palmierIcon('chevron.down')}</button>
          <span></span><button type="button" aria-label="Zoom out">${palmierIcon('minus.magnifyingglass')}</button><input type="range" min="0" max="100" value="55"><button type="button" aria-label="Zoom in">${palmierIcon('plus.magnifyingglass')}</button>
        </div>
        <div class="pp-ruler"><span>00:00:00</span><span>00:00:02</span><span>00:00:04</span><span>00:00:06</span><span>00:00:08</span><span>00:00:10</span></div>
        <div class="pp-playhead"></div>
        <div class="pp-tracks">
          ${['V4', 'V3', 'V2'].map((track, index) => `<div class="pp-track"><div class="pp-track-head">${palmierIcon('line.3.horizontal')}<b>${track}</b><span></span><button type="button" aria-label="Keyframes">${palmierIcon('diamond')}</button><button type="button" aria-label="Link track">${palmierIcon('link')}</button><button type="button" aria-label="Show track">${palmierIcon('eye')}</button></div><div class="pp-track-lane"><button class="pp-clip ${index < 2 ? 'title' : 'video'}${index === 1 ? ' wide' : ''}" type="button"${index === 0 ? ' data-action="select-clip"' : ''}>${['try it now!', 'PRO', 'AI Video Example'][index]}</button></div></div>`).join('')}
        </div>
      </section>
    </div>
    <div class="pp-export-sheet" data-export-sheet hidden>
      <div>
        <header><strong>Export</strong><button type="button" data-action="close-export" aria-label="Close export">${palmierIcon('xmark')}</button></header>
        <label>Format <button type="button">MP4 Video ${palmierIcon('chevron.down')}</button></label>
        <label>Resolution <button type="button">Match Timeline ${palmierIcon('chevron.down')}</button></label>
        <p>This browser demo does not write a file.</p>
        <button class="pp-export-confirm" type="button" data-action="close-export">Done</button>
      </div>
    </div>
  </div>
`;

const addMarkup = () => `
  <div class="add-product">
    <form class="add-card" id="repositoryPreview">
      <span class="add-kicker">03 / Your product</span>
      <h2>Map another product.</h2>
      <p>Eventually, this is where you’ll paste a repository. ProductTrace will build its surface and return a live, explorable trace.</p>
      <div class="repo-field">
        <input aria-label="GitHub repository URL" type="url" placeholder="https://github.com/you/product">
        <button type="submit">Add repository</button>
      </div>
      <span class="add-note">Preview only—the intake pipeline is not connected from this page yet.</span>
    </form>
  </div>
`;

function renderSlide(index) {
  window.clearTimeout(playbackTimer);
  slideIndex = (index + slides.length) % slides.length;
  stepIndex = 0;
  const slide = slides[slideIndex];

  elements.traceBadge.textContent = slide.badge;
  elements.traceHeadline.textContent = slide.headline;
  elements.evidence.textContent = slide.evidence;
  elements.traceState.textContent = slide.id === 'librechat' ? 'Listening' : paused ? 'Your turn' : 'Playing';
  elements.feed.replaceChildren();
  elements.product.replaceChildren();
  document.querySelectorAll('[data-slide-index]').forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.slideIndex) === slideIndex);
  });
  elements.cursor.hidden = slide.id !== 'palmier';
  elements.resume.hidden = slide.id !== 'palmier';
  elements.resume.textContent = paused ? 'Resume demo' : 'Pause demo';
  elements.workflowTrigger.hidden = slide.id !== 'palmier';
  elements.workflowMenu.hidden = true;

  if (slide.id === 'palmier') {
    elements.product.innerHTML = palmierMarkup();
    activePalmierPreview = { kind: 'timeline', name: 'AI Video' };
    bindPalmierActions();
    loadPalmierSampleData().catch(() => {
      elements.traceState.textContent = 'Media unavailable';
    });
    renderWorkflowMenu();
    seedPalmierTrace();
    if (!paused) playbackTimer = window.setTimeout(() => runPalmierStep(0), 550);
  } else if (slide.id === 'librechat') {
    renderLibreChat();
  } else {
    elements.product.innerHTML = addMarkup();
    elements.feed.innerHTML = '<p class="trace-empty">This slot is intentionally honest: the repository intake is not connected yet.</p>';
    document.querySelector('#repositoryPreview').addEventListener('submit', (event) => {
      event.preventDefault();
      addTrace({
        sentence: 'Repository intake is not available yet',
        effect: 'No analysis was started',
        chain: 'Preview form → no connected authoring action',
        evidence: 'Coming-soon surface · no product claim admitted',
      });
    });
  }
}

function takeControl() {
  if (slideIndex !== 0) return;
  paused = true;
  window.clearTimeout(playbackTimer);
  elements.cursor.hidden = true;
  elements.resume.textContent = 'Resume demo';
  elements.traceState.textContent = 'Paused — your turn';
}

function resumePlayback() {
  if (slideIndex !== 0) return;
  paused = false;
  elements.cursor.hidden = false;
  elements.resume.textContent = 'Pause demo';
  elements.traceState.textContent = 'Playing';
  window.clearTimeout(playbackTimer);
  playbackTimer = window.setTimeout(() => runPalmierStep(stepIndex), 300);
}

function seedPalmierTrace() {
  elements.feed.innerHTML = '<p class="trace-empty">Logs will appear here as you click around.</p>';
}

function escapePalmierText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[character]);
}

function loadPalmierSampleData() {
  if (!palmierDataPromise) {
    palmierDataPromise = Promise.all([
      fetch(`${palmierAssetBase}/project.json`).then((response) => {
        if (!response.ok) throw new Error('Palmier project metadata unavailable');
        return response.json();
      }),
      fetch(`${palmierAssetBase}/media.json`).then((response) => {
        if (!response.ok) throw new Error('Palmier media metadata unavailable');
        return response.json();
      }),
    ]).then(([project, media]) => {
      palmierProject = project;
      palmierMedia = media;
      return { project, media };
    });
  }
  return palmierDataPromise;
}

function palmierLibraryMarkup() {
  return `<div class="pp-media-tools"><button type="button">Import</button><button class="primary" type="button">Generate</button><span>${palmierIcon('ellipsis')}</span><span class="pp-smart-search">${palmierIcon('magnifyingglass')} Smart search</span></div><div class="pp-library-title"><strong>Library</strong><span>2 items</span></div><div class="pp-folder-grid"><button type="button" data-action="open-folder" data-folder-id="5158E8B0-0973-4078-AA27-1E1ABC335775"><i>${palmierIcon('folder.fill')}</i><b>AI Video Example</b><small>6</small></button><button type="button" data-action="open-folder" data-folder-id="2C206752-7273-4DC5-AB03-BE7327F8D1A7"><i>${palmierIcon('folder.fill')}</i><b>Real Footage Example</b><small>4</small></button></div>`;
}

function formatPalmierDuration(duration) {
  if (!Number.isFinite(duration)) return '';
  return `${Math.round(duration)}s`;
}

function palmierMediaCard({ name, poster, duration, mediaId, timeline, type }) {
  const attributes = timeline
    ? `data-action="open-timeline-media" data-timeline="${escapePalmierText(timeline)}"`
    : `data-action="open-media" data-media-id="${escapePalmierText(mediaId)}"`;
  const thumbnail = type === 'audio'
    ? `<span class="pp-audio-thumb">${palmierIcon('waveform')}</span>`
    : `<img src="${escapePalmierText(poster)}" alt="" loading="eager">`;
  const symbolName = timeline ? 'film.stack' : type === 'video' ? 'video' : type === 'image' ? 'photo' : 'waveform';
  return `<button class="pp-media-card" type="button" ${attributes}>${thumbnail}<span class="pp-media-kind">${palmierIcon(symbolName)}</span>${duration ? `<small>${formatPalmierDuration(duration)}</small>` : ''}<b title="${escapePalmierText(name)}">${escapePalmierText(name)}</b></button>`;
}

async function openPalmierFolder(folderId, { trace = true } = {}) {
  const { media } = await loadPalmierSampleData();
  if (slideIndex !== 0) return;
  const folder = media.folders.find((item) => item.id === folderId);
  const entries = media.entries.filter((item) => item.folderId === folderId);
  const timelines = folder?.name === 'Real Footage Example'
    ? ['Real Footage', 'Real Footage Vertical']
    : ['AI Video'];
  const cards = [
    ...timelines.map((name) => ({
      name,
      timeline: name,
      type: 'timeline',
      poster: palmierTimelineAssets[name].poster,
      duration: palmierTimelineAssets[name].duration,
    })),
    ...entries.map((entry) => ({
      ...entry,
      mediaId: entry.id,
      poster: palmierAssetById[entry.id]?.poster,
    })),
  ];
  const body = elements.product.querySelector('[data-media-body]');
  body.innerHTML = `<div class="pp-folder-header"><button type="button" data-action="back-library">Library</button><span>${palmierIcon('chevron.right')}</span><strong>${escapePalmierText(folder?.name || 'Folder')}</strong></div><div class="pp-media-count">${cards.length} items</div><div class="pp-media-grid">${cards.map(palmierMediaCard).join('')}</div>`;
  elements.traceHeadline.textContent = `Opened ${folder?.name || 'a media folder'}`;
  if (trace) {
    addTrace({
      sentence: `Opened ${folder?.name || 'a media folder'}`,
      effect: `Displayed ${cards.length} real sample items`,
      chain: 'Library folder → media.json roster → browser media grid',
      evidence: `Palmier Sample media.json · folder ${folderId}`,
    });
  }
}

function stopPalmierPreview() {
  const video = elements.product.querySelector('[data-preview-video]');
  const audio = elements.product.querySelector('[data-preview-audio]');
  video?.pause();
  audio?.pause();
}

function setPalmierPreview({ name, src, poster, type = 'video', vertical = false, start = 0, showTitle = false }) {
  const frame = elements.product.querySelector('[data-film-frame]');
  const video = elements.product.querySelector('[data-preview-video]');
  const image = elements.product.querySelector('[data-preview-image]');
  const audioShell = elements.product.querySelector('[data-preview-audio-shell]');
  const audio = elements.product.querySelector('[data-preview-audio]');
  stopPalmierPreview();
  frame.classList.toggle('vertical', vertical);
  frame.classList.remove('is-playing');
  elements.product.querySelector('[data-preview-name]').textContent = name;
  elements.product.querySelector('[data-preview-title]').hidden = !showTitle;
  video.hidden = type !== 'video';
  image.hidden = type !== 'image';
  audioShell.hidden = type !== 'audio';
  if (type === 'video') {
    video.poster = poster || '';
    if (video.getAttribute('src') !== src) {
      video.src = src;
      video.load();
    }
    const seek = () => {
      video.currentTime = Math.min(start, Math.max(0, video.duration || start));
      video.removeEventListener('loadedmetadata', seek);
    };
    if (video.readyState >= 1) seek(); else video.addEventListener('loadedmetadata', seek);
  } else if (type === 'image') {
    image.src = src;
    image.alt = name;
  } else {
    audio.src = src;
    audioShell.querySelector('span').textContent = name;
  }
  const play = elements.product.querySelector('[data-action="toggle-play"]');
  play.dataset.playing = 'false';
  play.innerHTML = palmierIcon('play.fill');
  play.setAttribute('aria-label', 'Play preview');
}

async function openPalmierMedia(mediaId, { trace = true } = {}) {
  const { media } = await loadPalmierSampleData();
  const entry = media.entries.find((item) => item.id === mediaId);
  const asset = palmierAssetById[mediaId];
  if (!entry || !asset || slideIndex !== 0) return;
  activePalmierPreview = { kind: 'media', id: mediaId, name: entry.name };
  setPalmierPreview({ name: entry.name, src: asset.src, poster: asset.poster, type: entry.type });
  elements.traceHeadline.textContent = `Previewed ${entry.name}`;
  elements.product.querySelector('[data-inspector-title]').textContent = `${entry.type[0].toUpperCase()}${entry.type.slice(1)} Clip`;
  elements.product.querySelector('[data-inspector-body]').innerHTML = `<h3>${palmierIcon('chevron.down')} Source</h3><label><span>Name</span><button type="button" title="${escapePalmierText(entry.name)}">${escapePalmierText(entry.name)}</button></label><label><span>Duration</span><button type="button">${formatPalmierDuration(entry.duration) || 'Still'}</button></label>${entry.sourceWidth ? `<label><span>Resolution</span><button type="button">${entry.sourceWidth} × ${entry.sourceHeight}</button></label>` : ''}`;
  if (trace) {
    addTrace({
      sentence: `Previewed ${entry.name}`,
      effect: entry.type === 'video' ? 'Loaded the real video and audio' : entry.type === 'audio' ? 'Loaded the real audio file' : 'Loaded the real source image',
      chain: `Media card → media.json id → ${entry.source.project.relativePath}`,
      evidence: `Palmier Sample media.json · ${entry.id}`,
    });
  }
}

function bindPalmierActions() {
  [...new Set(palmierSteps.map((step) => step.target))].forEach((targetSelector) => {
    elements.product.querySelector(targetSelector)?.addEventListener('click', () => {
      window.clearTimeout(playbackTimer);
      const matches = palmierSteps.map((step, index) => step.target === targetSelector ? index : -1).filter((index) => index >= 0);
      const index = matches.includes(stepIndex) ? stepIndex : matches[0];
      runPalmierStep(index, true);
    });
  });

  elements.product.querySelectorAll('[data-action="media-tab"]').forEach((button) => {
    button.addEventListener('click', () => activateMediaTab(button));
  });

  elements.product.querySelector('[data-media-body]')?.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]');
    if (!action) return;
    if (action.dataset.action === 'open-folder') void openPalmierFolder(action.dataset.folderId);
    if (action.dataset.action === 'back-library') {
      elements.product.querySelector('[data-media-body]').innerHTML = palmierLibraryMarkup();
    }
    if (action.dataset.action === 'open-media') void openPalmierMedia(action.dataset.mediaId);
    if (action.dataset.action === 'open-timeline-media') {
      const timelineButton = elements.product.querySelector(`[data-action="timeline-tab"][data-timeline="${action.dataset.timeline}"]`);
      if (timelineButton) {
        selectPalmierTimeline(timelineButton);
        elements.traceHeadline.textContent = `Opened the ${action.dataset.timeline} edit`;
        addTrace({
          sentence: `Opened the ${action.dataset.timeline} edit`,
          effect: 'Loaded the real sample footage into the preview',
          chain: 'Media item → project.json timeline → source media',
          evidence: `Palmier Sample project.json · ${action.dataset.timeline}`,
        });
      }
    }
  });

  elements.product.querySelectorAll('[data-action="timeline-tab"]').forEach((button) => {
    button.addEventListener('click', () => selectPalmierTimeline(button));
  });
  elements.product.querySelector('[data-action="toggle-play"]')?.addEventListener('click', togglePalmierPlayback);
  const previewVideo = elements.product.querySelector('[data-preview-video]');
  const updatePreviewTime = () => {
    const frame = Math.floor((previewVideo.currentTime || 0) * 24);
    const seconds = Math.floor(frame / 24);
    const frames = String(frame % 24).padStart(2, '0');
    elements.product.querySelector('[data-current-time]').textContent = `00:00:${String(seconds).padStart(2, '0')}:${frames}`;
  };
  previewVideo?.addEventListener('timeupdate', updatePreviewTime);
  previewVideo?.addEventListener('ended', () => {
    const play = elements.product.querySelector('[data-action="toggle-play"]');
    play.dataset.playing = 'false';
    play.innerHTML = palmierIcon('play.fill');
    play.setAttribute('aria-label', 'Play preview');
  });
  elements.product.querySelector('[data-action="toggle-media"]')?.addEventListener('click', () => {
    elements.product.querySelector('.pp-media-panel')?.classList.toggle('is-hidden');
  });
  elements.product.querySelector('[data-action="toggle-inspector"]')?.addEventListener('click', () => {
    elements.product.querySelector('.pp-inspector-panel')?.classList.toggle('is-hidden');
  });
  elements.product.querySelectorAll('[data-action="close-export"]').forEach((button) => {
    button.addEventListener('click', () => { elements.product.querySelector('[data-export-sheet]').hidden = true; });
  });
}

function activateMediaTab(button) {
  elements.product.querySelectorAll('[data-action="media-tab"]').forEach((item) => item.classList.toggle('active', item === button));
  const content = {
    media: palmierLibraryMarkup(),
    index: '<div class="pp-empty-panel"><strong>Index</strong><span>Search transcript, shots, people, and moments.</span></div>',
    captions: '<div class="pp-empty-panel"><strong>Captions</strong><span>Generate and style captions for the active timeline.</span></div>',
    audio: '<div class="pp-empty-panel"><strong>Audio</strong><span>Speech, music, cleanup, and loudness controls.</span></div>',
  };
  elements.product.querySelector('[data-media-body]').innerHTML = content[button.dataset.tab];
}

function renderWorkflowMenu() {
  const active = palmierWorkflows[activeWorkflowIndex];
  elements.workflowTrigger.textContent = active.title;
  if (slideIndex === 0 && stepIndex === 0) elements.traceHeadline.textContent = active.description;
  elements.workflowMenu.replaceChildren();
  const heading = document.createElement('header');
  heading.innerHTML = '<strong>Try a Palmier workflow</strong><span>Guided, then interruptible</span>';
  elements.workflowMenu.appendChild(heading);
  palmierWorkflows.forEach((workflow, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = index === activeWorkflowIndex ? 'active' : '';
    button.innerHTML = `<strong>${workflow.title}</strong><span>${workflow.description}</span>`;
    button.addEventListener('click', () => {
      activeWorkflowIndex = index;
      palmierSteps = workflow.steps;
      paused = false;
      elements.workflowMenu.hidden = true;
      renderSlide(0);
    });
    elements.workflowMenu.appendChild(button);
  });
}

function selectPalmierTimeline(button) {
  elements.product.querySelectorAll('[data-action="timeline-tab"]').forEach((item) => item.classList.toggle('active', item === button));
  const name = button.dataset.timeline;
  const asset = palmierTimelineAssets[name];
  activePalmierPreview = { kind: 'timeline', name };
  setPalmierPreview({
    name,
    src: asset.src,
    poster: asset.poster,
    start: asset.start,
    vertical: name === 'Real Footage Vertical',
    showTitle: name === 'AI Video',
  });
}

function togglePalmierPlayback() {
  const button = elements.product.querySelector('[data-action="toggle-play"]');
  const video = elements.product.querySelector('[data-preview-video]');
  const audio = elements.product.querySelector('[data-preview-audio]');
  const activeMedia = !video.hidden ? video : !audio.closest('[data-preview-audio-shell]').hidden ? audio : null;
  if (!activeMedia) return;
  const playing = activeMedia.paused;
  if (playing) {
    activeMedia.play().catch(() => {});
  } else {
    activeMedia.pause();
  }
  button.dataset.playing = String(playing);
  button.innerHTML = palmierIcon(playing ? 'pause.fill' : 'play.fill');
  button.setAttribute('aria-label', playing ? 'Pause preview' : 'Play preview');
  elements.product.querySelector('[data-film-frame]').classList.toggle('is-playing', playing);
}

function applyPalmierStep(step, { manual = false } = {}) {
  const action = elements.product.querySelector(step.target)?.dataset.action;
  if (action === 'select-clip') {
    const clip = elements.product.querySelector(step.target);
    elements.product.querySelectorAll('.pp-clip').forEach((item) => item.classList.toggle('selected', item === clip));
    elements.product.querySelector('[data-inspector-title]').textContent = 'Text Clip';
    elements.product.querySelector('[data-inspector-body]').innerHTML = `<h3>${palmierIcon('chevron.down')} Text</h3><label><span>Content</span><button type="button">try it now!</button></label><label><span>Opacity</span><button type="button">100%</button></label><h3>${palmierIcon('chevron.down')} Transform</h3>`;
  }
  if (action === 'split-clip') {
    const clip = elements.product.querySelector('[data-action="select-clip"]');
    clip?.classList.add('split');
    clip?.setAttribute('aria-label', 'Two split title clips');
  }
  if (action === 'export-project') {
    elements.product.querySelector('[data-export-sheet]').hidden = false;
  }
  if (action === 'close-export') {
    elements.product.querySelector('[data-export-sheet]').hidden = true;
  }
  if (!manual && action === 'open-folder') {
    void openPalmierFolder(elements.product.querySelector(step.target).dataset.folderId, { trace: false });
  }
  if (!manual && action === 'open-media') {
    void openPalmierMedia(elements.product.querySelector(step.target).dataset.mediaId, { trace: false });
  }
  if (!manual && action === 'open-timeline-media') {
    const name = elements.product.querySelector(step.target).dataset.timeline;
    const timelineButton = elements.product.querySelector(`[data-action="timeline-tab"][data-timeline="${name}"]`);
    if (timelineButton) selectPalmierTimeline(timelineButton);
  }
  if (!manual && action === 'media-tab') activateMediaTab(elements.product.querySelector(step.target));
  if (!manual && action === 'timeline-tab') selectPalmierTimeline(elements.product.querySelector(step.target));
  if (!manual && action === 'toggle-play') togglePalmierPlayback();
}

function positionCursor(target) {
  const widget = document.querySelector('.product-widget');
  const widgetRect = widget.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const x = targetRect.left - widgetRect.left + (targetRect.width / 2) - 4;
  const y = targetRect.top - widgetRect.top + (targetRect.height / 2) - 5;
  elements.cursor.style.setProperty('--cursor-x', `${x}px`);
  elements.cursor.style.setProperty('--cursor-y', `${y}px`);
}

function runPalmierStep(index, manual = false) {
  if (slideIndex !== 0) return;
  const step = palmierSteps[index];
  if (step.target !== '[data-action="export-project"]') {
    elements.product.querySelector('[data-export-sheet]').hidden = true;
  }
  const target = elements.product.querySelector(step.target);
  if (!target) return;

  elements.product.querySelectorAll('.is-active').forEach((node) => node.classList.remove('is-active'));
  target.classList.add('is-active');
  applyPalmierStep(step, { manual });
  positionCursor(target);
  elements.traceHeadline.textContent = step.sentence;
  window.setTimeout(() => {
    elements.cursor.classList.remove('click');
    void elements.cursor.offsetWidth;
    elements.cursor.classList.add('click');
    addTrace(step);
  }, 620);

  stepIndex = (index + 1) % palmierSteps.length;
  if (!paused && !manual) playbackTimer = window.setTimeout(() => runPalmierStep(stepIndex), 2650);
  if (!paused && manual) playbackTimer = window.setTimeout(() => runPalmierStep(stepIndex), 3100);
}

function addTrace(entry, { live = false } = {}) {
  elements.feed.querySelector('.trace-empty')?.remove();
  elements.feed.querySelectorAll('.newest').forEach((node) => node.classList.remove('newest'));
  const details = document.createElement('details');
  details.className = 'trace-entry newest';
  const summary = document.createElement('summary');
  const copy = document.createElement('p');
  copy.textContent = entry.sentence;
  const effect = document.createElement('small');
  effect.textContent = entry.effect;
  copy.appendChild(effect);
  const arrow = document.createElement('img');
  arrow.className = 'trace-chevron';
  arrow.src = '/palmier-icons/chevron.down.png';
  arrow.alt = '';
  arrow.setAttribute('aria-hidden', 'true');
  summary.append(copy, arrow);
  const metadata = document.createElement('dl');
  [['Effect chain', entry.chain], ['Evidence', entry.evidence]].forEach(([term, value]) => {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    metadata.append(dt, dd);
  });
  details.append(summary, metadata);
  elements.feed.prepend(details);
  while (elements.feed.querySelectorAll('.trace-entry').length > 6) {
    elements.feed.querySelector('.trace-entry:last-of-type')?.remove();
  }
  elements.traceState.textContent = live ? 'Live' : paused ? 'Paused — your turn' : 'Playing';
  window.setTimeout(() => details.classList.remove('newest'), 1500);
}

async function renderLibreChat() {
  elements.product.innerHTML = '<div class="live-loading">Loading the live LibreChat target…</div>';
  elements.feed.innerHTML = '<p class="trace-empty">Use LibreChat on the left. Its real interaction captions will arrive here.</p>';
  try {
    if (!liveTarget) {
      const response = await fetch('/api/live-captions/config?session=landing-hero');
      if (!response.ok) throw new Error('Live target unavailable');
      ({ target: liveTarget } = await response.json());
    }
    if (slideIndex !== 1) return;
    const frame = document.createElement('iframe');
    frame.className = 'live-target';
    frame.title = 'Live LibreChat product';
    frame.src = liveTarget.url;
    elements.product.replaceChildren(frame);
    connectLiveStream();
  } catch {
    elements.product.innerHTML = '<div class="live-loading">The live target is offline. Start the local demo stack to use it.</div>';
    elements.traceState.textContent = 'Offline';
  }
}

function connectLiveStream() {
  if (liveStream) return;
  liveStream = new EventSource('/api/live-captions/stream?session=landing-hero');
  liveStream.onmessage = ({ data }) => {
    const row = JSON.parse(data);
    if (row.hello || slideIndex !== 1) return;
    const effect = row.metadata?.verifiedEffectChain?.length
      ? row.metadata.verifiedEffectChain.map((item) => item.kind || item.type || item).join(' → ')
      : row.metadata?.typedReason || 'No verified effect was attached';
    addTrace({
      sentence: row.sentence,
      effect: row.disposition === 'resolved' ? 'Proven from source' : 'Captioned honestly',
      chain: effect,
      evidence: row.metadata?.evidenceClass || row.disposition,
    }, { live: true });
    elements.traceHeadline.textContent = row.sentence;
  };
}

elements.resume.addEventListener('click', (event) => {
  event.stopPropagation();
  if (paused) resumePlayback(); else takeControl();
});
elements.workflowTrigger.addEventListener('click', (event) => {
  event.stopPropagation();
  elements.workflowMenu.hidden = !elements.workflowMenu.hidden;
});
document.querySelector('.product-widget').addEventListener('pointerdown', (event) => {
  if (event.target !== elements.resume && !event.target.closest('[data-workflow-ui]')) takeControl();
}, true);
document.querySelector('.product-widget').addEventListener('keydown', (event) => {
  if (event.target !== elements.resume && !event.target.closest('[data-workflow-ui]')) takeControl();
}, true);
document.querySelectorAll('[data-slide-index]').forEach((button) => {
  button.addEventListener('click', () => renderSlide(Number(button.dataset.slideIndex)));
});

renderSlide(0);
