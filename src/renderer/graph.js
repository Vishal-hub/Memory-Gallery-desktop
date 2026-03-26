import { GRAPH, state, ui } from './state.js';
import { toFileSrc, formatDate, nodeCountLabel } from './utils.js';
import { showLightbox } from './lightbox.js';
import { updateMapMarkers, setMapVisibility } from './map.js';

export function setTransform() {
    if (state.inDetailsView) {
        if (ui.floatingRecenterBtn) ui.floatingRecenterBtn.classList.add('hidden');
    } else {
        const movedX = Math.abs(state.offsetX - state.idealOffsetX) > 8;
        const movedY = Math.abs(state.offsetY - state.idealOffsetY) > 8;
        const zoomed = Math.abs(state.scale - 1.0) > 0.02;
        const isOffCenter = movedX || movedY || zoomed;
        if (ui.floatingRecenterBtn) {
            ui.floatingRecenterBtn.classList.toggle('hidden', !isOffCenter);
        }
    }

    const transform = `translate(${state.offsetX}px, ${state.offsetY}px) scale(${state.scale})`;
    ui.gallery.style.transform = transform;
    ui.connections.style.transform = transform;

    const outThreshold = 0.75;
    const outEnd = 0.18;
    const morphFactor = Math.max(0, Math.min(1, (outThreshold - state.scale) / (outThreshold - outEnd)));
    updateMorphedLayout(morphFactor);
}

export function resetViewportContext() {
    state.inDetailsView = false;
    state.openedFromMap = false;
    state.openedFromPeople = false;
    if (ui.viewport) {
        ui.viewport.classList.remove('scrollable-mode');
        ui.viewport.style.overflow = 'hidden';
        ui.viewport.style.cursor = 'grab';
    }
    if (ui.gallery) {
        ui.gallery.style.position = 'absolute';
        ui.gallery.style.height = '100%';
    }
}

function updateMorphedLayout(morphFactor) {
    if (!state.lastPositions || state.lastPositions.length === 0) return;

    const centerX = GRAPH.width / 2;
    const centerY = GRAPH.height / 2;
    const count = state.lastPositions.length;
    const circleRadius = Math.min(GRAPH.height / 2 - 80, Math.max(250, count * 18));

    const morphedPositions = state.lastPositions.map((pos, i) => {
        const waveX = GRAPH.startX + i * GRAPH.gapX;
        const lane = Math.abs((i % 4) - 2);
        const waveY = GRAPH.startY + lane * GRAPH.laneGap;

        const angle = (i / count) * Math.PI * 2;
        const circleX = centerX + circleRadius * Math.cos(angle);
        const circleY = centerY + circleRadius * Math.sin(angle);

        let x = waveX;
        let y = waveY;

        if (morphFactor > 0) {
            x = waveX * (1 - morphFactor) + circleX * morphFactor;
            y = waveY * (1 - morphFactor) + circleY * morphFactor;
        }

        const el = state.clusterElements.get(pos.id);
        if (el) {
            el.style.left = `${x}px`;
            el.style.top = `${y}px`;
        }

        return { ...pos, x, y };
    });

    redrawConnections(morphedPositions, morphFactor);
}

export function redrawConnections(positions, morphFactor = 0) {
    if (!positions || positions.length < 2) {
        ui.connections.innerHTML = '';
        return;
    }

    ui.connections.innerHTML = '';
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < positions.length - 1; i++) {
        const pos = positions[i];
        const next = positions[i + 1];

        const el = state.clusterElements.get(pos.id);
        const nextEl = state.clusterElements.get(next.id);

        const startWidth = el ? el.offsetWidth : GRAPH.nodeWidth;
        const startHeight = el ? el.offsetHeight : GRAPH.nodeHeight;
        const endHeight = nextEl ? nextEl.offsetHeight : GRAPH.nodeHeight;

        const startX = pos.x + startWidth;
        const startY = pos.y + startHeight / 2;
        const endX = next.x;
        const endY = next.y + endHeight / 2;

        const curveIntensity = 1 - Math.min(1, morphFactor * 1.2);
        const cpDistance = Math.max(0, (endX - startX) * 0.8 * curveIntensity);

        const cp1X = startX + cpDistance;
        const cp1Y = startY;
        const cp2X = endX - cpDistance;
        const cp2Y = endY;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const d = `M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY}`;
        path.setAttribute('d', d);

        const staggerDelay = i * 0.015;
        const segmentOpacity = Math.max(0, 1 - (morphFactor * 3.5 + staggerDelay));
        path.style.opacity = segmentOpacity;

        const dashBase = 8;
        const dashGap = 8 + morphFactor * 40;
        path.style.strokeDasharray = `${dashBase} ${dashGap}`;
        path.style.strokeWidth = Math.max(3, 4 / state.scale);

        fragment.appendChild(path);
    }

    ui.connections.appendChild(fragment);
}

export function setGraphTransformEnabled(enabled) {
    ui.connections.style.display = enabled ? 'block' : 'none';
    if (enabled) {
        setTransform();
    } else {
        ui.gallery.style.transform = 'none';
        ui.connections.style.transform = 'none';
    }
}

export function centerOnPositions(positions) {
    if (!positions || positions.length === 0) return;

    state.scale = 1.0;
    state.idealScale = 1;

    positions.forEach((pos, i) => {
        const waveX = GRAPH.startX + i * GRAPH.gapX;
        const lane = Math.abs((i % 4) - 2);
        const waveY = GRAPH.startY + lane * GRAPH.laneGap;
        pos.x = waveX;
        pos.y = waveY;
        const el = state.clusterElements.get(pos.id);
        if (el) {
            el.style.left = `${waveX}px`;
            el.style.top = `${waveY}px`;
        }
    });

    const margin = 36;
    const xValues = positions.map((p) => p.x);
    const yValues = positions.map((p) => p.y);
    const minX = Math.min(...xValues);
    const maxX = Math.max(...xValues);
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);

    const graphWidth = maxX - minX + GRAPH.nodeWidth;
    const graphHeight = maxY - minY + GRAPH.nodeHeight;

    const viewportWidth = ui.viewport.clientWidth - margin * 2;
    const viewportHeight = ui.viewport.clientHeight - margin * 2;

    if (graphWidth * state.scale <= viewportWidth) {
        state.offsetX = margin - minX * state.scale + (viewportWidth - graphWidth * state.scale) / 2;
    } else {
        state.offsetX = margin - minX * state.scale;
    }

    state.offsetY = margin - minY * state.scale + (viewportHeight - graphHeight * state.scale) / 2;

    state.idealOffsetX = state.offsetX;
    state.idealOffsetY = state.offsetY;

    setTransform();
    redrawConnections(positions);
}

function getRelatedClusters(currentEventId) {
    const currentIndex = state.filteredClusters.findIndex((c) => c.id === currentEventId);
    if (currentIndex < 0) return [];
    const spread = 2;
    const related = [];
    for (let i = Math.max(0, currentIndex - spread); i <= Math.min(state.filteredClusters.length - 1, currentIndex + spread); i += 1) {
        if (i !== currentIndex) related.push(state.filteredClusters[i]);
    }
    return related;
}

export function renderClusters(clusters, options = {}) {
    state.filteredClusters = clusters;
    setGraphTransformEnabled(true);
    ui.gallery.innerHTML = '';

    const totalWidth = Math.max(1200, (clusters.length + 1) * GRAPH.gapX + 300);
    const totalHeight = 800;
    GRAPH.width = totalWidth;
    GRAPH.height = totalHeight;

    ui.gallery.style.width = `${GRAPH.width}px`;
    ui.gallery.style.height = `${GRAPH.height}px`;
    ui.connections.style.width = `${GRAPH.width}px`;
    ui.connections.style.height = `${GRAPH.height}px`;
    ui.connections.setAttribute('width', GRAPH.width);
    ui.connections.setAttribute('height', GRAPH.height);
    ui.connections.setAttribute('viewBox', `0 0 ${GRAPH.width} ${GRAPH.height}`);

    const positions = [];
    state.clusterElements.clear();

    clusters.forEach((cluster, index) => {
        const div = document.createElement('div');
        div.className = 'cluster';
        div.setAttribute('role', 'button');
        div.setAttribute('tabindex', '0');
        div.setAttribute('aria-label', `${cluster.placeName || cluster.label || ''} — ${nodeCountLabel(cluster)}`);

        const x = GRAPH.startX + index * GRAPH.gapX;
        const lane = Math.abs((index % 4) - 2);
        const y = GRAPH.startY + lane * GRAPH.laneGap;

        positions.push({ id: cluster.id, x, y });
        div.style.left = `${x}px`;
        div.style.top = `${y}px`;

        div.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            openCluster(cluster.id);
        });

        div.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                openCluster(cluster.id);
            }
        });

        div.addEventListener('mousedown', (e) => {
            if (state.inDetailsView) return;
            e.stopPropagation();
            const target = positions.find((p) => p.id === cluster.id);
            if (!target) return;
            state.draggedNodeId = cluster.id;
            state.nodeDragMoved = false;
            target.startX = target.x;
            target.startY = target.y;

            const rect = ui.viewport.getBoundingClientRect();
            const worldX = (e.clientX - rect.left - state.offsetX) / state.scale;
            const worldY = (e.clientY - rect.top - state.offsetY) / state.scale;
            target.dragOffsetX = worldX - target.x;
            target.dragOffsetY = worldY - target.y;
            ui.viewport.classList.add('dragging');
        });

        if (cluster.items[0].type === 'video') {
            const video = document.createElement('video');
            video.src = toFileSrc(cluster.items[0].path);
            video.width = 96;
            video.height = 96;
            video.muted = true;
            video.autoplay = true;
            video.loop = true;
            video.playsInline = true;
            div.appendChild(video);
        } else {
            const img = document.createElement('img');
            const displaySrc = cluster.items[0].thumbnailPath || cluster.items[0].path;
            img.src = toFileSrc(displaySrc);
            img.loading = 'lazy';
            img.onload = () => redrawConnections(state.lastPositions);
            div.appendChild(img);
        }

        const count = document.createElement('div');
        count.className = 'count';
        count.innerText = nodeCountLabel(cluster);

        const date = document.createElement('div');
        date.className = 'date';
        date.innerText = new Date(cluster.startTime).toDateString();

        div.appendChild(count);
        div.appendChild(date);

        if (cluster.placeName) {
            const chip = document.createElement('div');
            chip.className = 'place-chip';
            chip.innerText = cluster.placeName;
            div.appendChild(chip);
        }

        if (cluster.items[0].aiTags) {
            const tags = cluster.items[0].aiTags.split(',').slice(0, 2);
            tags.forEach(tag => {
                const tagEl = document.createElement('div');
                tagEl.className = 'ai-tag';
                tagEl.innerText = `✨ ${tag.trim()}`;
                div.appendChild(tagEl);
            });
        }

        ui.gallery.appendChild(div);
        state.clusterElements.set(cluster.id, div);
    });

    state.lastPositions = positions;
    redrawConnections(positions);
    centerOnPositions(positions);
    updateMapMarkers(clusters, options);
}

export function openCluster(eventId) {
    const cluster = state.filteredClusters.find((c) => c.id === eventId);
    if (!cluster) return;

    state.inDetailsView = true;
    setGraphTransformEnabled(false);
    if (ui.floatingRecenterBtn) ui.floatingRecenterBtn.classList.add('hidden');

    ui.viewport.classList.add('scrollable-mode');
    ui.viewport.style.cursor = 'default';
    ui.connections.innerHTML = '';
    ui.gallery.innerHTML = '';
    ui.gallery.style.width = '100%';

    const wrapper = document.createElement('div');
    wrapper.className = 'details';

    const header = document.createElement('div');
    header.className = 'view-header';

    const cameFromMap = state.openedFromMap;
    const cameFromPeople = state.openedFromPeople;
    const backDest = cameFromMap ? 'map' : cameFromPeople ? 'people' : 'timeline';
    const backLabel = cameFromMap ? 'Back to Map' : cameFromPeople ? 'Back to Identities' : 'Back to Timeline';

    const back = document.createElement('div');
    back.className = 'nav-item back-nav';
    back.style.width = 'fit-content';
    back.style.cursor = 'pointer';
    back.setAttribute('data-back-action', backDest);
    back.innerHTML = `<i>←</i> <span>${backLabel}</span>`;
    back.onclick = (e) => {
        e.stopPropagation();
        handleBackNavigation();
    };
    header.appendChild(back);
    wrapper.appendChild(header);

    const title = document.createElement('h2');
    title.innerText = formatDate(cluster.startTime);
    wrapper.appendChild(title);

    if (cluster.placeName) {
        const chip = document.createElement('div');
        chip.className = 'place-chip';
        chip.innerText = `🌍 ${cluster.placeName}`;
        wrapper.appendChild(chip);
    }

    if (cluster.items[0].aiTags) {
        const tagContainer = document.createElement('div');
        const tags = cluster.items[0].aiTags.split(',');
        tags.forEach(tag => {
            const tagEl = document.createElement('div');
            tagEl.className = 'ai-tag';
            tagEl.innerText = `✨ ${tag.trim()}`;
            tagContainer.appendChild(tagEl);
        });
        wrapper.appendChild(tagContainer);
    }

    const grid = document.createElement('div');
    grid.className = 'grid';
    cluster.items.forEach((item) => {
        if (item.type === 'video') {
            const video = document.createElement('video');
            video.src = toFileSrc(item.path);
            video.controls = true;
            video.preload = 'metadata';
            grid.appendChild(video);
        } else {
            const img = document.createElement('img');
            img.src = toFileSrc(item.path);
            img.loading = 'lazy';
            img.setAttribute('tabindex', '0');
            img.setAttribute('role', 'button');
            img.alt = item.tags || item.name || 'Photo';
            const imageItems = cluster.items.filter(it => it.type !== 'video');
            const imgIndex = imageItems.indexOf(item);
            img.onclick = () => showLightbox(imageItems, imgIndex);
            img.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    showLightbox(imageItems, imgIndex);
                }
            });
            grid.appendChild(img);
        }
    });
    wrapper.appendChild(grid);

    const relatedTitle = document.createElement('h3');
    relatedTitle.innerText = 'Related Moments';
    wrapper.appendChild(relatedTitle);

    const related = getRelatedClusters(eventId);
    if (related.length === 0) {
        const none = document.createElement('p');
        none.innerText = 'No nearby moments available.';
        wrapper.appendChild(none);
    } else {
        related.forEach((rel) => {
            const item = document.createElement('div');
            item.className = 'nav-item';
            item.setAttribute('role', 'button');
            item.setAttribute('tabindex', '0');
            item.innerText = `${new Date(rel.startTime).toDateString()} (${rel.items.length})`;
            const activate = (e) => {
                e.stopPropagation();
                openCluster(rel.id);
            };
            item.onclick = activate;
            item.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    activate(e);
                }
            });
            wrapper.appendChild(item);
        });
    }

    ui.gallery.appendChild(wrapper);

    setTimeout(() => {
        grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 250);

    updateNavActiveState();
}

export function updateNavActiveState() {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    if (state.showMap || (state.inDetailsView && state.openedFromMap)) {
        ui.navMap.classList.add('active');
    } else if ((state.groupBy === 'person' && state.inDetailsView) || state.openedFromPeople) {
        ui.navPeople.classList.add('active');
    } else {
        ui.navTimeline.classList.add('active');
    }

    if (state.inDetailsView) {
        setGraphTransformEnabled(false);
    } else {
        setGraphTransformEnabled(true);
    }
}

export async function handleBackNavigation() {
    if (!state.inDetailsView) return;

    const backBtn = document.querySelector('.back-nav');
    const action = backBtn ? backBtn.getAttribute('data-back-action') :
        (state.openedFromMap ? 'map' : (state.openedFromPeople ? 'people' : 'timeline'));

    console.log('[Nav] Back navigation triggered, action=', action);

    if (action === 'people') {
        resetViewportContext();
        ui.navPeople.click();
    } else if (action === 'map') {
        resetViewportContext();
        setMapVisibility(true);
        setTimeout(() => setTransform(), 0);
    } else {
        resetViewportContext();
        renderClusters(state.filteredClusters);
        setTransform();
    }
}