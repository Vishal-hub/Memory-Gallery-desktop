import { GRAPH, state, ui } from './state.js';
import { renderEmptyState } from './utils.js';
import {
  setTransform,
  resetViewportContext,
  redrawConnections,
  centerOnPositions,
  renderClusters,
  updateNavActiveState,
  handleBackNavigation,
} from './graph.js';
import {
  setMapStyle,
  fitMapToClusters,
  setMapVisibility,
  updateMapMarkers,
  updateModeToolbar,
  focusClusterFromMap,
} from './map.js';
import { openPeopleGallery, hidePeopleToolbar, resortPeopleGallery } from './people.js';
import { applyFilters, bindSearchListeners } from './search.js';
import {
  setLoadingSubtitle,
  setLoadingDetail,
  setLoadingProgress,
  setLoadingPhase,
  markPhaseDone,
  dismissLoading,
  isLoadingVisible,
  resetLoading,
} from './loading.js';

let _rafFilterId = 0;
function debouncedApplyFilters() {
  cancelAnimationFrame(_rafFilterId);
  _rafFilterId = requestAnimationFrame(() => applyFilters());
}

let _refreshDebounceTimer = 0;
function debouncedRefreshViewMode() {
  clearTimeout(_refreshDebounceTimer);
  _refreshDebounceTimer = setTimeout(() => refreshViewMode(), 300);
}

// Per-phase progress tracking for concurrent pipeline
const _phaseProgress = { scan: 0, metadata: 0, ai: 0, faces: 0, vectors: 0 };
const _phaseWeights = { scan: 0.10, metadata: 0.15, ai: 0.30, faces: 0.25, vectors: 0.20 };
const _phasesStarted = new Set();
const _phasesDone = new Set();
function _updateLoadingAggregate() {
  if (!isLoadingVisible()) return;
  const total = _phaseProgress.scan * _phaseWeights.scan
    + _phaseProgress.metadata * _phaseWeights.metadata
    + _phaseProgress.ai * _phaseWeights.ai
    + _phaseProgress.faces * _phaseWeights.faces
    + _phaseProgress.vectors * _phaseWeights.vectors;
  setLoadingProgress(total);
}
function _markPipelinePhaseDone(phase) {
  _phasesDone.add(phase);
  const pipelinePhases = ['ai', 'faces', 'vectors'];
  const started = pipelinePhases.filter(p => _phasesStarted.has(p));
  if (started.length > 0 && started.every(p => _phasesDone.has(p)) && isLoadingVisible()) {
    dismissLoading();
  }
}

let _metadataRefreshTimer = 0;
function debouncedMetadataRefresh() {
  clearTimeout(_metadataRefreshTimer);
  _metadataRefreshTimer = setTimeout(async () => {
    try {
      const result = await window.api.invoke('read-images', { groupBy: state.groupBy });
      if (Array.isArray(result.clusters) && result.clusters.length > 0) {
        state.allClusters = result.clusters;
        state.filteredClusters = [...state.allClusters];
        applyFilters();
      }
    } catch (_) { }
  }, 500);
}

// ---------------------------------------------------------------------------
// User-activity heartbeat for polite background indexing
// ---------------------------------------------------------------------------

let lastUserActivityPingAt = 0;

function notifyUserActivity(force = false) {
  if (!window.api || typeof window.api.send !== 'function') return;
  const now = Date.now();
  if (!force && now - lastUserActivityPingAt < 250) return;
  lastUserActivityPingAt = now;
  window.api.send('user-activity');
}

function bindUserActivitySignals() {
  const passive = { passive: true };
  window.addEventListener('pointerdown', () => notifyUserActivity(true), passive);
  window.addEventListener('mousemove', () => notifyUserActivity(false), passive);
  window.addEventListener('wheel', () => notifyUserActivity(false), passive);
  window.addEventListener('keydown', () => notifyUserActivity(true));
  window.addEventListener('focus', () => notifyUserActivity(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      notifyUserActivity(true);
    }
  });
}

// ---------------------------------------------------------------------------
// Library dirty badge
// ---------------------------------------------------------------------------

function updateLibraryDirtyUI() {
  if (ui.refreshLibraryBtn) {
    ui.refreshLibraryBtn.classList.toggle('needs-refresh', state.libraryDirty);
    ui.refreshLibraryBtn.title = state.libraryDirty ? 'New or changed files detected' : 'Refresh Library';
  }
  if (ui.manageFoldersBtn) {
    ui.manageFoldersBtn.classList.toggle('has-badge', state.libraryDirty);
    ui.manageFoldersBtn.title = state.libraryDirty ? 'Settings (new or changed files detected)' : 'Settings';
  }
}

// ---------------------------------------------------------------------------
// Group-by switching
// ---------------------------------------------------------------------------

async function refreshViewMode() {
  updateNavActiveState();
  ui.status.innerText = 'Reclustering memories...';
  ui.status.style.opacity = '1';
  try {
    const data = await window.api.invoke('get-events', { groupBy: state.groupBy });
    state.allClusters = data;
    state.filteredClusters = [...data];
    state.clusterElements.clear();
    state.lastPositions = [];
    applyFilters();
    ui.status.innerText = `Loaded ${data.length} clusters.`;
    setTimeout(() => ui.status.style.opacity = '0', 2000);
  } catch (err) {
    ui.status.innerText = `Error: ${err.message}`;
  }
}

async function switchGroupBy(nextGroupBy) {
  if (state.groupBy === nextGroupBy) return;
  state.groupBy = nextGroupBy;
  state.personFilter = null;

  if (ui.groupBySelect) {
    const trigger = ui.groupBySelect.querySelector('.dropdown-trigger');
    const label = trigger.querySelector('.dropdown-label');
    const item = ui.groupBySelect.querySelector(`.dropdown-item[data-value="${nextGroupBy}"]`);
    if (item && label) {
      ui.groupBySelect.querySelectorAll('.dropdown-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      label.innerText = item.innerText;
    }
  }

  await refreshViewMode();
}

// ---------------------------------------------------------------------------
// IPC event listeners
// ---------------------------------------------------------------------------

function bindIPCListeners() {
  if (!window.api || !window.api.on) return;

  window.api.on('indexing-progress', (_event, data) => {
    ui.status.innerText = `✨ ${data.message} (${data.percentage}%)`;
    if (isLoadingVisible()) {
      setLoadingPhase('metadata');
      setLoadingSubtitle('Scanning & processing files...');
      _phaseProgress.scan = data.percentage;
      _updateLoadingAggregate();
      setLoadingDetail(`${data.current} / ${data.total} files`);
    }
  });

  window.api.on('library-refresh-complete', (_event, data) => {
    state.libraryDirty = false;
    updateLibraryDirtyUI();
    if (isLoadingVisible()) {
      _phaseProgress.scan = 100;
      markPhaseDone('scan');
      _updateLoadingAggregate();
    }
    if (data?.reason !== 'manual' && !state.inDetailsView) {
      debouncedRefreshViewMode();
    }
  });

  window.api.on('library-change-detected', () => {
    state.libraryDirty = true;
    updateLibraryDirtyUI();
  });

  window.api.on('library-refresh-error', (_event, data) => {
    ui.status.innerText = `Refresh failed: ${data.message}`;
    ui.status.style.opacity = '1';
  });

  window.api.on('metadata-processing-started', () => {
    _phasesStarted.add('metadata');
    if (isLoadingVisible()) {
      setLoadingPhase('metadata');
      setLoadingSubtitle('Processing photo metadata...');
    }
  });

  window.api.on('metadata-batch-progress', (_event, data) => {
    ui.status.innerText = `Processing metadata: ${data.current} / ${data.total} (${data.percentage}%)`;
    ui.status.style.opacity = '1';
    if (isLoadingVisible()) {
      _phaseProgress.metadata = data.percentage;
      _updateLoadingAggregate();
      setLoadingDetail(`${data.current} / ${data.total} files`);
    }
  });

  window.api.on('metadata-batch-ready', (_event, data) => {
    if (data?.eventsCount > 0) {
      debouncedMetadataRefresh();
    }
  });

  window.api.on('metadata-processing-complete', () => {
    _phaseProgress.metadata = 100;
    _phasesDone.add('metadata');
    _updateLoadingAggregate();
    debouncedMetadataRefresh();
    if (ui.status.innerText.startsWith('Processing metadata')) {
      ui.status.innerText = '';
      ui.status.style.opacity = '0';
    }
  });

  window.api.on('face-indexing-started', (_event, data) => {
    _phasesStarted.add('faces');
    ui.status.innerText = `Analyzing faces: 0 / ${data.total}`;
    ui.status.style.opacity = '1';
    if (isLoadingVisible()) {
      setLoadingPhase('faces');
      setLoadingSubtitle('Recognizing faces...');
      setLoadingDetail(`0 / ${data.total}`);
    }
  });

  window.api.on('face-indexing-progress', (_event, data) => {
    ui.status.innerText = `Analyzing faces: ${data.current} / ${data.total} (${data.percentage}%)`;
    ui.status.style.opacity = '1';
    if (isLoadingVisible()) {
      _phaseProgress.faces = data.percentage;
      _updateLoadingAggregate();
      setLoadingDetail(`${data.current} / ${data.total} faces`);
    }
  });

  window.api.on('face-indexing-complete', (_event, data) => {
    const seconds = typeof data?.durationMs === 'number' ? (data.durationMs / 1000).toFixed(1) : null;
    ui.status.innerText = seconds ? `Face indexing complete in ${seconds}s` : 'Face indexing complete';
    ui.status.style.opacity = '1';
    if (isLoadingVisible()) {
      _phaseProgress.faces = 100;
      markPhaseDone('faces');
      setLoadingDetail('');
      _updateLoadingAggregate();
    }
    _markPipelinePhaseDone('faces');
    setTimeout(() => {
      if (ui.status.innerText.startsWith('Face indexing complete')) {
        ui.status.innerText = '';
        ui.status.style.opacity = '0';
      }
    }, 1800);
    if (!state.inDetailsView) {
      debouncedRefreshViewMode();
    }
  });

  window.api.on('visual-indexing-started', (_event, data) => {
    _phasesStarted.add('ai');
    ui.status.innerText = `Analyzing : 0 / ${data.total}`;
    ui.status.style.opacity = '1';
    if (isLoadingVisible()) {
      setLoadingPhase('ai');
      setLoadingSubtitle('AI analyzing your photos...');
      setLoadingDetail(`0 / ${data.total}`);
    }
  });

  window.api.on('visual-indexing-progress', (_event, data) => {
    ui.status.innerText = `Analyzing : ${data.current} / ${data.total} (${data.percentage}%)`;
    ui.status.style.opacity = '1';
    if (isLoadingVisible()) {
      _phaseProgress.ai = data.percentage;
      _updateLoadingAggregate();
      setLoadingDetail(`${data.current} / ${data.total} images`);
    }
  });

  window.api.on('visual-indexing-complete', (_event, data) => {
    const seconds = typeof data?.durationMs === 'number' ? (data.durationMs / 1000).toFixed(1) : null;
    ui.status.innerText = seconds ? `Analysis complete in ${seconds}s` : 'Analysis complete';
    ui.status.style.opacity = '1';
    if (isLoadingVisible()) {
      _phaseProgress.ai = 100;
      markPhaseDone('ai');
      setLoadingDetail('');
      _updateLoadingAggregate();
    }
    _markPipelinePhaseDone('ai');
    setTimeout(() => {
      if (ui.status.innerText.startsWith('Analysis complete')) {
        ui.status.innerText = '';
        ui.status.style.opacity = '0';
      }
    }, 1800);
    if (!state.inDetailsView) {
      debouncedRefreshViewMode();
    }
  });

  window.api.on('semantic-indexing-started', (_event, data) => {
    _phasesStarted.add('vectors');
    ui.status.innerText = `Indexing search vectors: 0 / ${data.total}`;
    ui.status.style.opacity = '1';
    if (isLoadingVisible()) {
      setLoadingPhase('vectors');
      setLoadingSubtitle('Building search index...');
      setLoadingDetail(`0 / ${data.total}`);
    }
  });

  window.api.on('semantic-indexing-progress', (_event, data) => {
    ui.status.innerText = `Indexing search vectors: ${data.current} / ${data.total} (${data.percentage}%)`;
    ui.status.style.opacity = '1';
    if (isLoadingVisible()) {
      _phaseProgress.vectors = data.percentage;
      _updateLoadingAggregate();
      setLoadingDetail(`${data.current} / ${data.total} vectors`);
    }
  });

  window.api.on('semantic-indexing-complete', (_event, data) => {
    const seconds = typeof data?.durationMs === 'number' ? (data.durationMs / 1000).toFixed(1) : null;
    ui.status.innerText = seconds ? `Search indexing complete in ${seconds}s` : 'Search indexing complete';
    ui.status.style.opacity = '1';
    if (isLoadingVisible()) {
      _phaseProgress.vectors = 100;
      markPhaseDone('vectors');
      _updateLoadingAggregate();
    }
    _markPipelinePhaseDone('vectors');
    setTimeout(() => {
      if (ui.status.innerText.startsWith('Search indexing complete')) {
        ui.status.innerText = '';
        ui.status.style.opacity = '0';
      }
    }, 1800);
  });

  window.api.on('model-load-error', (_event, data) => {
    console.warn('[Models] Load error:', data.message);
    ui.status.innerText = data.hint || 'AI features are unavailable — check your connection and restart.';
    ui.status.style.opacity = '1';
    if (isLoadingVisible()) {
      markPhaseDone('ai');
      markPhaseDone('faces');
      markPhaseDone('vectors');
      setLoadingSubtitle('AI models unavailable — basic features still work');
      setTimeout(() => dismissLoading(), 2000);
    }
  });
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadImages() {
  try {
    setLoadingSubtitle('Loading your memories...');
    setLoadingPhase('scan');
    ui.status.innerText = 'Loading your memories...';
    ui.status.style.opacity = '1';

    const result = await window.api.invoke('read-images', { groupBy: state.groupBy });
    state.allClusters = result.clusters;
    const indexDebug = result.indexDebug;
    state.libraryDirty = Boolean(indexDebug?.libraryDirty);
    updateLibraryDirtyUI();

    if (!Array.isArray(state.allClusters) || state.allClusters.length === 0) {
      if (!indexDebug?.latestRun) {
        setLoadingSubtitle('First run — discovering your photos...');
        await refreshLibrary();
        return;
      }
      const previouslyScanned = indexDebug.latestRun.scannedCount > 0;
      if (previouslyScanned) {
        setLoadingSubtitle('Re-indexing your library...');
        ui.status.innerText = 'Rebuilding library...';
        ui.status.style.opacity = '1';
        await refreshLibrary();
        return;
      }
      ui.status.innerText = 'No supported images found in your configured folders.';
      dismissLoading();
      renderEmptyState('No photos found. Open Settings to add folders with JPG/PNG/WEBP images.');
    } else {
      dismissLoading();
      if (state.libraryDirty) {
        ui.status.innerText = 'New or changed files detected. Refresh Library to update.';
        ui.status.style.opacity = '1';
      } else {
        ui.status.innerText = '';
        ui.status.style.opacity = '0';
      }
    }

    if (indexDebug) {
      ui.debug.style.opacity = '0';
    }

    state.filteredClusters = [...state.allClusters];
    ui.slider.oninput = debouncedApplyFilters;
    applyFilters();
  } catch (error) {
    dismissLoading();
    ui.status.innerText = 'Unable to load photos.';
    renderEmptyState(`Error: ${error.message || 'Unknown error'}`);
  }
}

async function refreshLibrary() {
  try {
    if (isLoadingVisible()) {
      setLoadingSubtitle('Discovering your memories...');
      setLoadingPhase('scan');
    }
    ui.status.innerText = '✨ Discovering your memories...';
    ui.status.style.opacity = '1';

    const result = await window.api.invoke('refresh-library', { groupBy: state.groupBy });
    state.allClusters = result.clusters;
    const indexDebug = result.indexDebug;
    state.libraryDirty = Boolean(indexDebug?.libraryDirty);
    updateLibraryDirtyUI();

    if (!Array.isArray(state.allClusters) || state.allClusters.length === 0) {
      const scannedSomething = indexDebug?.latestRun?.scannedCount > 0;
      if (scannedSomething) {
        setLoadingSubtitle('Processing your photos — this may take a moment...');
        ui.status.innerText = 'Building your library...';
        ui.status.style.opacity = '1';
      } else {
        ui.status.innerText = 'No supported images found in your configured folders.';
        dismissLoading();
        renderEmptyState('No photos found. Open Settings to add folders with JPG/PNG/WEBP images.');
      }
    } else {
      if (isLoadingVisible()) {
        markPhaseDone('scan');
      }
      dismissLoading();
      ui.status.innerText = 'Enhancing metadata in the background...';
      ui.status.style.opacity = '1';

      state.filteredClusters = [...state.allClusters];
      ui.slider.oninput = debouncedApplyFilters;
      applyFilters();
    }

    if (indexDebug) {
      ui.debug.style.opacity = '0';
    }
  } catch (error) {
    dismissLoading();
    ui.status.innerText = 'Unable to refresh library.';
    renderEmptyState(`Error: ${error.message || 'Unknown error'}`);
  }
}

// ---------------------------------------------------------------------------
// Custom dropdown helper
// ---------------------------------------------------------------------------

function setupCustomDropdown(el, onChange) {
  if (!el) return;
  const trigger = el.querySelector('.dropdown-trigger');
  const labelEl = trigger.querySelector('.dropdown-label');
  const menu = el.querySelector('.dropdown-menu');
  const items = Array.from(el.querySelectorAll('.dropdown-item'));
  let focusedIdx = -1;

  function isOpen() { return menu.classList.contains('show'); }

  function openMenu() {
    document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
    document.querySelectorAll('.dropdown-trigger').forEach(t => { t.classList.remove('open'); t.setAttribute('aria-expanded', 'false'); });
    menu.classList.add('show');
    trigger.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    focusedIdx = items.findIndex(i => i.classList.contains('active'));
    if (focusedIdx >= 0) items[focusedIdx].classList.add('focused');
  }

  function closeMenu(returnFocus) {
    menu.classList.remove('show');
    trigger.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    items.forEach(i => i.classList.remove('focused'));
    focusedIdx = -1;
    if (returnFocus) trigger.focus();
  }

  function selectItem(item) {
    const val = item.getAttribute('data-value');
    items.forEach(i => { i.classList.remove('active'); i.setAttribute('aria-selected', 'false'); });
    item.classList.add('active');
    item.setAttribute('aria-selected', 'true');
    if (labelEl) labelEl.innerText = item.innerText;
    onChange(val);
    closeMenu(true);
  }

  function moveFocus(delta) {
    items.forEach(i => i.classList.remove('focused'));
    focusedIdx = (focusedIdx + delta + items.length) % items.length;
    items[focusedIdx].classList.add('focused');
    items[focusedIdx].scrollIntoView({ block: 'nearest' });
  }

  trigger.onclick = (e) => {
    e.stopPropagation();
    isOpen() ? closeMenu(true) : openMenu();
  };

  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      if (!isOpen()) openMenu();
      else if (e.key === 'ArrowDown') moveFocus(1);
    } else if (e.key === 'Escape' && isOpen()) {
      e.preventDefault();
      closeMenu(true);
    }
  });

  el.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1); }
    else if ((e.key === 'Enter' || e.key === ' ') && focusedIdx >= 0) { e.preventDefault(); selectItem(items[focusedIdx]); }
    else if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); }
    else if (e.key === 'Home') { e.preventDefault(); focusedIdx = -1; moveFocus(1); }
    else if (e.key === 'End') { e.preventDefault(); focusedIdx = items.length; moveFocus(-1); }
    else if (e.key === 'Tab') { closeMenu(false); }
  });

  items.forEach(item => {
    item.onclick = (e) => {
      e.stopPropagation();
      selectItem(item);
    };
  });
}

// ---------------------------------------------------------------------------
// Viewport interactions
// ---------------------------------------------------------------------------

function bindInteractions() {
  // Map popup click delegation
  document.addEventListener('click', (event) => {
    const popupTrigger = event.target.closest('.map-popup-link');
    if (popupTrigger) {
      event.preventDefault();
      focusClusterFromMap(popupTrigger.dataset.clusterId);
      return;
    }
  });

  // Viewport panning
  ui.viewport.addEventListener('mousedown', (e) => {
    if (state.inDetailsView) return;
    state.isDraggingViewport = true;
    state.dragMoved = false;
    state.dragStartClientX = e.clientX;
    state.dragStartClientY = e.clientY;
    state.startOffsetX = state.offsetX;
    state.startOffsetY = state.offsetY;
    ui.viewport.classList.add('dragging');
  });

  window.addEventListener('mousemove', (e) => {
    if (state.draggedNodeId) {
      const target = state.lastPositions.find((p) => p.id === state.draggedNodeId);
      if (!target) return;

      const rect = ui.viewport.getBoundingClientRect();
      const worldX = (e.clientX - rect.left - state.offsetX) / state.scale;
      const worldY = (e.clientY - rect.top - state.offsetY) / state.scale;
      target.x = Math.max(20, Math.min(worldX - target.dragOffsetX, GRAPH.width - 160));
      target.y = Math.max(20, Math.min(worldY - target.dragOffsetY, GRAPH.height - 170));

      if (Math.abs(target.x - target.startX) > 2 || Math.abs(target.y - target.startY) > 2) {
        state.nodeDragMoved = true;
      }

      const el = state.clusterElements.get(state.draggedNodeId);
      if (el) {
        el.style.left = `${target.x}px`;
        el.style.top = `${target.y}px`;
      }
      redrawConnections(state.lastPositions);
      return;
    }

    if (!state.isDraggingViewport) return;
    const dx = e.clientX - state.dragStartClientX;
    const dy = e.clientY - state.dragStartClientY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) state.dragMoved = true;
    state.offsetX = state.startOffsetX + dx;
    state.offsetY = state.startOffsetY + dy;
    setTransform();
  });

  window.addEventListener('mouseup', () => {
    if (state.draggedNodeId) {
      if (state.nodeDragMoved) state.suppressClickUntil = Date.now() + 180;
      state.draggedNodeId = null;
      state.nodeDragMoved = false;
      ui.viewport.classList.remove('dragging');
      return;
    }
    if (state.dragMoved) state.suppressClickUntil = Date.now() + 180;
    state.isDraggingViewport = false;
    ui.viewport.classList.remove('dragging');
  });

  // Keyboard shortcuts
  window.addEventListener('keydown', async (e) => {
    if (e.key === 'Backspace') {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        return;
      }
      if (document.querySelector('.lightbox')) {
        return;
      }
      e.preventDefault();
      await handleBackNavigation();
    }

    if (e.key === 'Escape') {
      if (state.draggedNodeId) {
        state.draggedNodeId = null;
        state.nodeDragMoved = false;
        ui.viewport.classList.remove('dragging');
        redrawConnections(state.lastPositions);
      }
      if (ui.settingsModal && !ui.settingsModal.classList.contains('hidden')) {
        ui.settingsModal.classList.add('hidden');
      }
      if (ui.renameModal && !ui.renameModal.classList.contains('hidden')) {
        ui.renameModal.classList.add('hidden');
      }
    }
  });

  // Zoom / horizontal scroll
  ui.viewport.addEventListener('wheel', (e) => {
    if (state.inDetailsView) return;

    const isZoom = e.ctrlKey || e.metaKey || (Math.abs(e.deltaY) > Math.abs(e.deltaX));

    if (isZoom) {
      e.preventDefault();
      const zoomSpeed = 0.0015;
      const delta = -e.deltaY;
      const oldScale = state.scale;

      state.scale = Math.max(0.12, Math.min(1.0, state.scale + delta * zoomSpeed));

      const rect = ui.viewport.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const worldCenterX = GRAPH.width / 2;
      const worldCenterY = GRAPH.height / 2;

      if (state.scale < 0.7) {
        const targetOffsetX = (rect.width / 2) - (worldCenterX * state.scale);
        const targetOffsetY = (rect.height / 2) - (worldCenterY * state.scale);
        state.offsetX = state.offsetX * 0.85 + targetOffsetX * 0.15;
        state.offsetY = state.offsetY * 0.85 + targetOffsetY * 0.15;
      } else {
        state.offsetX = mouseX - (mouseX - state.offsetX) * (state.scale / oldScale);
        state.offsetY = mouseY - (mouseY - state.offsetY) * (state.scale / oldScale);
      }

      clampOffsets();
      setTransform();
    } else {
      state.offsetX -= e.deltaX * 1.5;
      clampOffsets();
      setTransform();
      e.preventDefault();
    }
  }, { passive: false });

  function clampOffsets() {
    const vw = ui.viewport.clientWidth;
    const vh = ui.viewport.clientHeight;
    const minX = -(GRAPH.width * state.scale - 200);
    const maxX = vw - 200;
    const minY = -(GRAPH.height * state.scale - 200);
    const maxY = vh - 200;
    state.offsetX = Math.max(minX, Math.min(maxX, state.offsetX));
    state.offsetY = Math.max(minY, Math.min(maxY, state.offsetY));
  }

  // Recenter button
  if (ui.floatingRecenterBtn) {
    ui.floatingRecenterBtn.addEventListener('click', () => {
      centerOnPositions(state.lastPositions);
      if (ui.floatingRecenterBtn) {
        ui.floatingRecenterBtn.classList.add('hidden');
      }
    });
  }

  // Clear cache
  ui.clearCacheActionBtn.addEventListener('click', async () => {
    if (confirm('This will wipe all indexed data (thumbnails, AI tags, face data, search index) and close the app.\n\nYou will need to re-open the app to rebuild your library.\n\nContinue?')) {
      ui.clearCacheActionBtn.disabled = true;
      const iconEl = ui.clearCacheActionBtn.querySelector('.action-btn-icon svg');
      if (iconEl) iconEl.classList.add('spin');
      const textEl = ui.clearCacheActionBtn.querySelector('.action-btn-text strong');
      if (textEl) textEl.textContent = 'Clearing...';
      await window.api.invoke('clear-cache');
    }
  });

  function onActivate(el, handler) {
    el.onclick = handler;
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handler(e);
      }
    });
  }

  // Navigation tabs
  onActivate(ui.navTimeline, async () => {
    const token = ++state.navigationToken;
    hidePeopleToolbar();
    if (ui.timelineWrap) ui.timelineWrap.classList.remove('hidden');
    resetViewportContext();
    setMapVisibility(false, { skipRender: true });
    await switchGroupBy('date');
    if (token !== state.navigationToken) return;
    if (state.groupBy === 'date') {
      refreshViewMode();
    }
  });

  onActivate(ui.navPeople, async () => {
    ++state.navigationToken;
    await openPeopleGallery(switchGroupBy);
  });

  // Custom dropdowns
  setupCustomDropdown(ui.groupBySelect, (val) => {
    switchGroupBy(val);
  });

  setupCustomDropdown(ui.mapStyleSelect, (val) => {
    setMapStyle(val);
  });

  setupCustomDropdown(ui.peopleSortSelect, (val) => {
    state.peopleSortBy = val;
    resortPeopleGallery(switchGroupBy);
  });

  // Close dropdowns on outside click
  document.addEventListener('click', () => {
    document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
    document.querySelectorAll('.dropdown-trigger').forEach(t => {
      t.classList.remove('open');
      t.setAttribute('aria-expanded', 'false');
    });
  });

  // Map toggle
  onActivate(ui.navMap, async () => {
    const token = ++state.navigationToken;
    hidePeopleToolbar();
    if (ui.timelineWrap) ui.timelineWrap.classList.remove('hidden');
    const willShow = !state.showMap;
    if (willShow) {
      resetViewportContext();
      await switchGroupBy('location');
      if (token !== state.navigationToken) return;
    } else {
      resetViewportContext();
      setMapVisibility(false, { skipRender: true });
      await switchGroupBy('date');
      if (token !== state.navigationToken) return;
      if (state.groupBy === 'date') {
        refreshViewMode();
      }
      return;
    }
    setMapVisibility(willShow);
  });

  // Fit-map button
  if (ui.fitMapBtn) {
    ui.fitMapBtn.classList.add('hidden');
    ui.fitMapBtn.onclick = () => {
      state.mapSearchLocked = false;
      fitMapToClusters(state.filteredClusters);
      if (ui.fitMapBtn) {
        ui.fitMapBtn.classList.add('hidden');
      }
    };
  }

  if (ui.mapStyleSelect) {
    ui.mapStyleSelect.value = state.currentMapStyle;
    ui.mapStyleSelect.onchange = (e) => {
      setMapStyle(e.target.value);
    };
  }

  // Settings modal
  onActivate(ui.manageFoldersBtn, async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const settings = await window.api.invoke('get-index-roots');
      state.indexRoots = Array.isArray(settings) ? settings : settings.roots;
      ui.includeVideosCheckbox.checked = settings.includeVideos !== false;
      renderRootsList();
      ui.settingsModal.classList.remove('hidden');
    } catch (err) {
      console.error('Failed to open folders:', err);
      alert('Could not open folder settings.');
    }
  });

  ui.closeSettingsBtn.onclick = () => ui.settingsModal.classList.add('hidden');
  ui.addFolderBtn.onclick = async () => {
    const path = await window.api.invoke('select-folder');
    if (path && !state.indexRoots.includes(path)) {
      state.indexRoots.push(path);
      renderRootsList();
    }
  };

  ui.saveSettingsBtn.onclick = async () => {
    await window.api.invoke('set-index-roots', {
      roots: state.indexRoots,
      includeVideos: ui.includeVideosCheckbox.checked
    });
    ui.settingsModal.classList.add('hidden');
    refreshLibrary();
  };

  function renderRootsList() {
    ui.rootsList.innerHTML = '';
    state.indexRoots.forEach((root, idx) => {
      const item = document.createElement('div');
      item.className = 'root-item';
      item.innerHTML = `
        <span>${root}</span>
        <button class="remove-btn" title="Remove">✕</button>
      `;
      item.querySelector('.remove-btn').onclick = () => {
        state.indexRoots.splice(idx, 1);
        renderRootsList();
      };
      ui.rootsList.appendChild(item);
    });
  }

  // Search input with semantic debounce
  let semanticSearchTimeout = null;

  ui.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      ui.searchInput.blur();
      return;
    }
    if (e.key === 'Enter' && state.showMap && state.searchQuery.trim().length > 0) {
      e.preventDefault();
      const query = state.searchQuery.toLowerCase().trim();
      const match = state.filteredClusters.find(c =>
        c.placeName && c.placeName.toLowerCase().includes(query)
      );

      if (match) {
        const fallback = match.items?.find((it) => typeof it.latitude === 'number' && typeof it.longitude === 'number');
        const lat = typeof match.centerLat === 'number' ? match.centerLat : fallback?.latitude;
        const lon = typeof match.centerLon === 'number' ? match.centerLon : fallback?.longitude;
        if (typeof lat === 'number' && typeof lon === 'number') {
          state.mapSearchLocked = true;
          state.map.flyTo([lat, lon], 12, { animate: true, duration: 1.5 });
          const markerLat = lat.toFixed(5);
          const markerLon = lon.toFixed(5);
          setTimeout(() => {
            const marker = state.mapMarkers.find(m => {
              return m.getLatLng().lat.toFixed(5) === markerLat &&
                m.getLatLng().lng.toFixed(5) === markerLon;
            });
            if (marker) {
              marker.openPopup();
            }
          }, 1600);
        }
      } else {
        ui.status.innerText = `Location "${state.searchQuery}" not found on map`;
        ui.status.style.opacity = '1';
        setTimeout(() => {
          if (ui.status.innerText.includes("not found")) {
            ui.status.innerText = '';
            ui.status.style.opacity = '0';
          }
        }, 3000);
      }
    }
  });

  ui.searchInput.oninput = (e) => {
    state.searchQuery = e.target.value;
    if (state.searchQuery.length > 0) {
      ui.clearSearchBtn.style.display = 'flex';
    } else {
      ui.clearSearchBtn.style.display = 'none';
      state.semanticMatches = [];
    }
    applyFilters();

    clearTimeout(semanticSearchTimeout);
    if (state.searchQuery.length >= 3) {
      semanticSearchTimeout = setTimeout(async () => {
        ui.status.innerText = '✨ Analyzing visual concepts...';
        ui.status.style.opacity = '1';
        try {
          const matchedPaths = await window.api.invoke('search-semantic', state.searchQuery);
          if (!matchedPaths || matchedPaths.length === 0) return;
          const items = [];
          state.allClusters.forEach(c => {
            c.items.forEach(it => {
              if (matchedPaths.includes(it.path)) items.push(it);
            });
          });
          state.semanticMatches = items;
          applyFilters();
        } catch (err) {
          console.error('Semantic search failed:', err);
          ui.status.innerText = 'Visual search unavailable — try a keyword search instead';
          ui.status.style.opacity = '1';
          setTimeout(() => {
            if (ui.status.innerText.includes('Visual search unavailable')) {
              ui.status.innerText = '';
              ui.status.style.opacity = '0';
            }
          }, 4000);
          return;
        }
        ui.status.innerText = '';
        ui.status.style.opacity = '0';
      }, 600);
    }
  };

  if (ui.clearSearchBtn) {
    ui.clearSearchBtn.onclick = () => {
      ui.searchInput.value = '';
      state.searchQuery = '';
      state.mapSearchLocked = false;
      ui.clearSearchBtn.style.display = 'none';
      applyFilters();
    };
  }

  // Refresh library button
  ui.refreshLibraryBtn.addEventListener('click', async () => {
    ui.refreshLibraryBtn.disabled = true;
    const iconEl = ui.refreshLibraryBtn.querySelector('.action-btn-icon svg');
    const textEl = ui.refreshLibraryBtn.querySelector('.action-btn-text strong');
    const subtextEl = ui.refreshLibraryBtn.querySelector('.action-btn-text small');
    if (iconEl) iconEl.classList.add('spin');
    if (textEl) textEl.textContent = 'Refreshing...';
    if (subtextEl) subtextEl.textContent = 'Scanning folders for changes...';
    try {
      await refreshLibrary();
    } finally {
      ui.refreshLibraryBtn.disabled = false;
      if (iconEl) iconEl.classList.remove('spin');
      if (textEl) textEl.textContent = 'Refresh Library';
      if (subtextEl) subtextEl.textContent = 'Re-scan folders for new or changed files';
    }
  });

  // Resize handling
  window.addEventListener('resize', () => {
    if (state.showMap && state.map) {
      state.map.invalidateSize(false);
      updateMapMarkers(state.filteredClusters);
      return;
    }
    if (!state.inDetailsView) renderClusters(state.filteredClusters);
  });
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

updateModeToolbar();
bindUserActivitySignals();
bindSearchListeners();
bindIPCListeners();
bindInteractions();
loadImages();
