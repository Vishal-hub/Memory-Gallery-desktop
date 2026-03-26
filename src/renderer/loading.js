import { ui } from './state.js';

const PHASES = ['scan', 'metadata', 'ai', 'faces', 'vectors'];

let currentPhase = null;
let dismissed = false;

export function setLoadingSubtitle(text) {
    if (ui.loadingSubtitle) ui.loadingSubtitle.textContent = text;
}

export function setLoadingDetail(text) {
    if (ui.loadingDetail) ui.loadingDetail.textContent = text;
}

export function setLoadingProgress(percent) {
    if (!ui.loadingProgressWrap || !ui.loadingProgressBar) return;
    ui.loadingProgressWrap.classList.toggle('visible', percent > 0);
    ui.loadingProgressBar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
}

export function setLoadingPhase(phase) {
    if (!ui.loadingPhases || dismissed) return;
    currentPhase = phase;

    const phaseIndex = PHASES.indexOf(phase);
    const items = ui.loadingPhases.querySelectorAll('.loading-phase');

    items.forEach((el, i) => {
        el.classList.remove('active', 'done');
        if (i < phaseIndex) {
            el.classList.add('done');
        } else if (i === phaseIndex) {
            el.classList.add('active');
        }
    });
}

export function markPhaseDone(phase) {
    if (!ui.loadingPhases) return;
    const el = ui.loadingPhases.querySelector(`[data-phase="${phase}"]`);
    if (el) {
        el.classList.remove('active');
        el.classList.add('done');
    }
}

export function dismissLoading() {
    if (dismissed) return;
    dismissed = true;

    PHASES.forEach(p => markPhaseDone(p));
    setLoadingProgress(100);
    setLoadingSubtitle('Ready');
    setLoadingDetail('');

    setTimeout(() => {
        if (ui.loadingScreen) {
            ui.loadingScreen.classList.add('hidden');
        }
    }, 400);
}

export function isLoadingVisible() {
    return !dismissed;
}

export function resetLoading() {
    dismissed = false;
    currentPhase = null;
    if (ui.loadingScreen) {
        ui.loadingScreen.classList.remove('hidden');
    }
    setLoadingSubtitle('Preparing your memories...');
    setLoadingDetail('');
    setLoadingProgress(0);

    if (ui.loadingPhases) {
        ui.loadingPhases.querySelectorAll('.loading-phase').forEach(el => {
            el.classList.remove('active', 'done');
        });
    }
}
