import { toFileSrc } from './utils.js';

export function showLightbox(items, startIndex = 0) {
    if (!items || items.length === 0) return;
    let currentIndex = startIndex;

    const overlay = document.createElement('div');
    overlay.className = 'lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Photo viewer');

    const closeBtn = document.createElement('button');
    closeBtn.className = 'close';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', 'Close photo viewer');

    const img = document.createElement('img');
    const counter = document.createElement('div');
    counter.className = 'lightbox-counter';
    counter.setAttribute('aria-live', 'polite');

    const prevBtn = document.createElement('button');
    prevBtn.className = 'lightbox-nav prev';
    prevBtn.innerHTML = '&#10094;';
    prevBtn.setAttribute('aria-label', 'Previous photo');

    const nextBtn = document.createElement('button');
    nextBtn.className = 'lightbox-nav next';
    nextBtn.innerHTML = '&#10095;';
    nextBtn.setAttribute('aria-label', 'Next photo');

    function updateContent() {
        const item = items[currentIndex];
        img.src = toFileSrc(item.path);
        img.alt = item.placeName || 'Photo preview';
        counter.innerText = `${currentIndex + 1} / ${items.length}`;
        prevBtn.style.display = items.length > 1 ? 'block' : 'none';
        nextBtn.style.display = items.length > 1 ? 'block' : 'none';
    }

    function showPrev(e) {
        if (e) e.stopPropagation();
        currentIndex = (currentIndex - 1 + items.length) % items.length;
        updateContent();
    }

    function showNext(e) {
        if (e) e.stopPropagation();
        currentIndex = (currentIndex + 1) % items.length;
        updateContent();
    }

    function close() {
        overlay.remove();
        window.removeEventListener('keydown', handleKeys);
    }

    function handleKeys(e) {
        if (e.key === 'Escape' || e.key === 'Backspace') close();
        if (e.key === 'ArrowLeft') showPrev();
        if (e.key === 'ArrowRight') showNext();
    }

    closeBtn.onclick = close;
    prevBtn.onclick = showPrev;
    nextBtn.onclick = showNext;

    overlay.onclick = (e) => {
        if (e.target === overlay) {
            close();
            return;
        }
        const rect = overlay.getBoundingClientRect();
        if (e.clientX < rect.width / 3) {
            showPrev();
        } else if (e.clientX > (rect.width * 2) / 3) {
            showNext();
        }
    };

    updateContent();

    overlay.appendChild(closeBtn);
    overlay.appendChild(prevBtn);
    overlay.appendChild(nextBtn);
    overlay.appendChild(img);
    overlay.appendChild(counter);
    document.body.appendChild(overlay);
    window.addEventListener('keydown', handleKeys);
}
