import { ui } from './state.js';

export function toFileSrc(filePath) {
    return encodeURI(`file:///${filePath.replace(/\\/g, '/')}`);
}

export function formatDate(timestamp) {
    return new Date(timestamp).toLocaleString();
}

export function formatLocation(lat, lon) {
    if (typeof lat !== 'number' || typeof lon !== 'number') return 'Unknown location';
    return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

export function stableRandomY(seed, max) {
    const x = Math.sin(seed) * 10000;
    return Math.floor((x - Math.floor(x)) * Math.max(1, max));
}

export function nodeCountLabel(cluster) {
    const videos = cluster.items.filter((item) => item.type === 'video').length;
    const images = cluster.items.length - videos;
    if (videos > 0 && images > 0) return `${cluster.items.length} items (${images} photos, ${videos} videos)`;
    if (videos > 0) return `${videos} video${videos > 1 ? 's' : ''}`;
    return `${images} photo${images > 1 ? 's' : ''}`;
}

export function renderEmptyState(message) {
    ui.gallery.innerHTML = '';
    ui.connections.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'details';
    empty.innerText = message;
    ui.gallery.appendChild(empty);
}
