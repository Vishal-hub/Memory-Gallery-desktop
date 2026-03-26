import { state, ui } from './state.js';
import { toFileSrc } from './utils.js';
import { setGraphTransformEnabled, openCluster, updateNavActiveState } from './graph.js';
import { setMapVisibility } from './map.js';
import { applyFilters } from './search.js';

function sortPeople(people, sortBy) {
    const sorted = [...people];
    switch (sortBy) {
        case 'name':
            sorted.sort((a, b) => {
                const aIsNamed = a.is_named ? 0 : 1;
                const bIsNamed = b.is_named ? 0 : 1;
                if (aIsNamed !== bIsNamed) return aIsNamed - bIsNamed;
                return a.name.localeCompare(b.name);
            });
            break;
        case 'recent':
            sorted.sort((a, b) => (b.updated_at_ms || 0) - (a.updated_at_ms || 0));
            break;
        case 'unnamed':
            sorted.sort((a, b) => {
                if (a.is_named !== b.is_named) return a.is_named - b.is_named;
                return (b.appearance_count || 0) - (a.appearance_count || 0);
            });
            break;
        case 'photos':
        default:
            sorted.sort((a, b) => (b.appearance_count || 0) - (a.appearance_count || 0));
            break;
    }
    return sorted;
}

function updatePeopleStats(people) {
    const total = people.length;
    const unnamed = people.filter(p => !p.is_named).length;
    if (ui.peopleCount) ui.peopleCount.textContent = `${total} ${total === 1 ? 'Person' : 'People'}`;
    if (ui.peopleUnnamed) ui.peopleUnnamed.textContent = unnamed > 0 ? `${unnamed} Anonymous` : 'Identified';
}

export function showPeopleToolbar() {
    if (ui.timelineWrap) ui.timelineWrap.classList.add('hidden');
    if (ui.peopleModeWrap) ui.peopleModeWrap.classList.remove('hidden');
}

export function hidePeopleToolbar() {
    if (ui.peopleModeWrap) ui.peopleModeWrap.classList.add('hidden');
}

function renderPeopleGrid(people, wrapper, switchGroupByFn) {
    const existingGrid = wrapper.querySelector('.grid');
    if (existingGrid) existingGrid.remove();

    const grid = document.createElement('div');
    grid.className = 'grid';

    people.forEach(person => {
        const item = document.createElement('div');
        item.className = 'person-card';

        const img = document.createElement('img');
        img.src = toFileSrc(person.thumbnail_path);

        const name = document.createElement('div');
        name.className = 'person-name';
        name.innerText = person.name;
        name.style.cursor = 'pointer';
        name.title = 'Click to rename';

        const stats = document.createElement('div');
        stats.className = 'person-stats';
        stats.innerText = `${person.appearance_count || 0} photo${(person.appearance_count || 0) !== 1 ? 's' : ''}`;

        const openRename = async (e) => {
            e.stopPropagation();
            ui.renameInput.value = person.name;
            ui.renameModal.classList.remove('hidden');
            ui.renameInput.focus();

            ui.saveRenameBtn.onclick = async () => {
                const newName = ui.renameInput.value.trim();
                if (newName && newName !== person.name) {
                    await window.api.invoke('rename-person', { id: person.id, name: newName });
                    ui.renameModal.classList.add('hidden');
                    ui.navPeople.click();
                } else {
                    ui.renameModal.classList.add('hidden');
                }
            };

            ui.closeRenameBtn.onclick = () => ui.renameModal.classList.add('hidden');
            ui.renameInput.onkeydown = (ev) => {
                if (ev.key === 'Enter') ui.saveRenameBtn.click();
                if (ev.key === 'Escape') ui.renameModal.classList.add('hidden');
            };
        };

        name.onclick = openRename;

        const rename = document.createElement('button');
        rename.className = 'rename-btn';
        rename.innerText = '✎';
        rename.onclick = openRename;

        item.onclick = async () => {
            await focusClusterFromPeople(person.id, switchGroupByFn);
        };

        item.appendChild(img);
        item.appendChild(name);
        item.appendChild(stats);
        item.appendChild(rename);
        grid.appendChild(item);
    });

    wrapper.appendChild(grid);
}

export async function openPeopleGallery(switchGroupByFn) {
    const token = state.navigationToken;
    await switchGroupByFn('person');
    if (token !== state.navigationToken) return;

    state.inDetailsView = true;
    setMapVisibility(false, { skipRender: true });
    setGraphTransformEnabled(false);
    if (ui.floatingRecenterBtn) ui.floatingRecenterBtn.classList.add('hidden');

    ui.viewport.classList.add('scrollable-mode');
    ui.viewport.style.cursor = 'default';
    ui.connections.innerHTML = '';
    ui.gallery.innerHTML = '';
    ui.gallery.style.position = 'relative';
    ui.gallery.style.width = '100%';
    ui.gallery.style.height = 'auto';
    ui.gallery.style.minHeight = '100%';

    const wrapper = document.createElement('div');
    wrapper.className = 'details';
    wrapper.id = 'peopleWrapper';

    const header = document.createElement('div');
    header.className = 'view-header';

    const title = document.createElement('h2');
    title.innerText = 'Recognized Identities';
    header.appendChild(title);
    wrapper.appendChild(header);

    const people = await window.api.invoke('get-people');
    state.people = people;

    showPeopleToolbar();
    updatePeopleStats(people);

    const sorted = sortPeople(people, state.peopleSortBy);
    renderPeopleGrid(sorted, wrapper, switchGroupByFn);

    ui.gallery.appendChild(wrapper);
    ui.viewport.scrollTop = 0;
    updateNavActiveState();
}

export function resortPeopleGallery(switchGroupByFn) {
    const wrapper = document.getElementById('peopleWrapper');
    if (!wrapper || !state.people.length) return;
    const sorted = sortPeople(state.people, state.peopleSortBy);
    renderPeopleGrid(sorted, wrapper, switchGroupByFn);
}

export async function focusClusterFromPeople(personId, switchGroupByFn) {
    state.inDetailsView = false;
    hidePeopleToolbar();
    setMapVisibility(false, { skipRender: true });
    await switchGroupByFn('person');
    state.personFilter = personId;
    applyFilters();
    state.openedFromPeople = true;
    openCluster(`person-${personId}`);
}
