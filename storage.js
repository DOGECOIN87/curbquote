import { estimateProject, validateProject } from './project.js';
import { DETAIL_FIELDS } from './planning.js';
import { validatePropertyContext } from './property-data.js';

const KEY = 'curbquote.projects.v1';
export function readProjects(storage) {
  const raw = storage.getItem(KEY);
  if (!raw) return [];
  let projects;
  try { projects = JSON.parse(raw); } catch { throw new Error('Saved projects could not be read. Your current estimate is still available.'); }
  if (!Array.isArray(projects) || projects.length > 30) throw new Error('Saved project data is invalid.');
  return projects.map(validateSavedProject);
}
export function validateSavedProject(project) {
  if (!project || typeof project.id !== 'string' || !/^[a-z0-9-]{8,80}$/i.test(project.id) || typeof project.name !== 'string' || !project.name.trim() || project.name.length > 80 || typeof project.address !== 'string' || project.address.length > 120 || typeof project.updatedAt !== 'string' || !Number.isFinite(Date.parse(project.updatedAt))) throw new Error('A saved project is invalid.');
  const options = validateProject(project.options);
  const result = estimateProject(project.inputs, options);
  const p = project.planning;
  const planning = p && typeof p === 'object' ? {
    confirmed: Array.isArray(p.confirmed) ? [...new Set(p.confirmed.filter(key => DETAIL_FIELDS.includes(key)))] : [],
    goal: typeof p.goal === 'string' ? p.goal.slice(0, 1800) : '',
    budget: typeof p.budget === 'string' ? p.budget.slice(0, 16) : '',
    allowPhasing: p.allowPhasing === true
  } : undefined;
  const propertyData = validatePropertyContext(project.propertyData);
  const inputs = { ...project.inputs, ...result.inputs };
  // Stories are unused for window/door budgets, but valid profile facts must survive a save.
  const stories = Number(project.inputs.stories);
  if (!options.siding && Number.isInteger(stories) && stories >= 1 && stories <= 4) inputs.stories = stories;
  return { id: project.id, name: project.name.trim(), address: project.address, updatedAt: project.updatedAt, inputs, options, ...(planning ? { planning } : {}), ...(propertyData ? { propertyData } : {}) };
}
export function saveProject(storage, project) {
  const valid = validateSavedProject(project);
  const projects = readProjects(storage).filter(item => item.id !== valid.id);
  if (projects.length >= 30) throw new Error('You have 30 saved projects. Delete one before saving another.');
  projects.unshift(valid);
  storage.setItem(KEY, JSON.stringify(projects));
  return projects;
}
export function deleteProject(storage, id) {
  const projects = readProjects(storage).filter(item => item.id !== id);
  storage.setItem(KEY, JSON.stringify(projects));
  return projects;
}

// Photos are kept in this browser's IndexedDB, separate from small estimate records.
async function photoStore(mode, action) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('curbquote-photos', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('photos');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Photo storage is unavailable in this browser.'));
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('photos', mode);
      const request = action(transaction.objectStore('photos'));
      let value;
      request.onsuccess = () => { value = request.result; };
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = () => reject(new Error('Photo storage is full or unavailable.'));
      transaction.onabort = () => reject(new Error('Photo could not be saved.'));
    });
  } finally { db.close(); }
}
export const savePhoto = (id, photo) => photoStore('readwrite', store => store.put(photo, id));
export const loadPhoto = id => photoStore('readonly', store => store.get(id));
export const deletePhoto = id => photoStore('readwrite', store => store.delete(id));
