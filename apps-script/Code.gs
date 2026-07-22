const DESTINATION_FOLDER_ID = '1p7xdXX8BGPHeMmctfjmClxTU0Wkj3q6S';
const INDEX_FILE_NAME = 'modelario-index.json';
const LEGACY_PROJECT_FILE_NAME = 'modelario-shared.json';
const COMPONENT_FILE_NAME = 'componente.json';
const RESULTS_FOLDER_NAME = 'resultados';

function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : '';
  if (action === 'result-folder-link') {
    return respond(resultFolderLink(e.parameter.componentId, e.parameter.resultId), e);
  }
  return respond({ ok: true, data: readProject() }, e);
}

function doPost(e) {
  const raw = e && e.parameter && e.parameter.payload
    ? e.parameter.payload
    : e.postData.contents;
  const request = JSON.parse(raw);
  if (request.action === 'result-file') {
    saveResultFile(request);
    return respond({ ok: true }, e);
  }
  if (request.action === 'delete-result') {
    deleteResultFolder(request.componentId, request.resultId);
    return respond({ ok: true }, e);
  }
  writeProject(request.data || { components: [] });
  return respond({ ok: true }, e);
}

function rootFolder() {
  return DriveApp.getFolderById(DESTINATION_FOLDER_ID);
}

function namedFile(folder, name) {
  const files = folder.getFilesByName(name);
  return files.hasNext() ? files.next() : null;
}

function readJsonFile(file, fallback) {
  if (!file) return fallback;
  try {
    return JSON.parse(file.getBlob().getDataAsString());
  } catch (error) {
    return fallback;
  }
}

function writeJsonFile(folder, name, value) {
  const content = JSON.stringify(value, null, 2);
  const file = namedFile(folder, name);
  if (file) file.setContent(content);
  else folder.createFile(name, content, 'application/json');
}

function readIndex(root) {
  return readJsonFile(namedFile(root, INDEX_FILE_NAME), null);
}

function readProject() {
  const root = rootFolder();
  let index = readIndex(root);
  if (!index) {
    const legacy = readJsonFile(namedFile(root, LEGACY_PROJECT_FILE_NAME), null);
    if (legacy && legacy.data) {
      writeProject(legacy.data);
      index = readIndex(root);
    } else {
      writeProject({ components: [] });
      index = readIndex(root);
    }
  }
  const components = (index.components || []).map((entry) => {
    const folder = componentFolder(root, entry);
    const stored = readJsonFile(namedFile(folder, COMPONENT_FILE_NAME), null);
    return stored && stored.data ? stored.data : null;
  }).filter(Boolean);
  return { components };
}

function writeProject(data) {
  const root = rootFolder();
  const previous = readIndex(root) || { components: [] };
  const previousById = {};
  (previous.components || []).forEach((entry) => { previousById[entry.id] = entry; });
  const index = {
    updatedAt: new Date().toISOString(),
    components: (data.components || []).map((component) => {
      const folder = componentFolder(root, previousById[component.id], component);
      const results = childFolder(folder, RESULTS_FOLDER_NAME);
      migrateLegacyResults(root, results, component);
      writeJsonFile(folder, COMPONENT_FILE_NAME, {
        updatedAt: new Date().toISOString(),
        data: component
      });
      return {
        id: component.id,
        name: component.name || 'Componente sin nombre',
        description: component.description || '',
        status: component.status || '',
        folderId: folder.getId(),
        updatedAt: new Date().toISOString()
      };
    })
  };
  writeJsonFile(root, INDEX_FILE_NAME, index);
}

function safeName(value) {
  return String(value || 'sin-nombre')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

function componentFolder(root, entry, component) {
  if (entry && entry.folderId) {
    try {
      return DriveApp.getFolderById(entry.folderId);
    } catch (error) {}
  }
  const id = (component && component.id) || (entry && entry.id);
  const prefix = `componente-${id}-`;
  const folders = root.getFolders();
  while (folders.hasNext()) {
    const folder = folders.next();
    if (folder.getName().indexOf(prefix) === 0) return folder;
  }
  const name = (component && component.name) || (entry && entry.name) || 'sin-nombre';
  return root.createFolder(`${prefix}${safeName(name)}`);
}

function componentEntry(componentId, componentName) {
  const root = rootFolder();
  const index = readIndex(root) || { components: [] };
  const existing = (index.components || []).filter((entry) => entry.id === componentId)[0];
  if (existing) return { root, index, entry: existing };
  const entry = { id: componentId, name: componentName || 'Componente', folderId: '' };
  const folder = componentFolder(root, entry, { id: componentId, name: componentName || 'Componente' });
  entry.folderId = folder.getId();
  index.components = index.components || [];
  index.components.push(entry);
  writeJsonFile(root, INDEX_FILE_NAME, index);
  return { root, index, entry };
}

function migrateLegacyResults(root, resultsFolder, component) {
  eachResult(component, (result) => {
    const legacy = findResultFolder(root, result.id);
    if (legacy && legacy.getParents().hasNext() && legacy.getParents().next().getId() === root.getId()) {
      legacy.moveTo(resultsFolder);
    }
  });
}

function eachResult(component, callback) {
  (component.architectures || []).forEach((architecture) => {
    (architecture.versions || []).forEach((version) => {
      (version.results || []).forEach(callback);
    });
  });
}

function saveResultFile(request) {
  const location = componentEntry(request.componentId, request.componentName);
  const component = componentFolder(location.root, location.entry, null);
  const results = childFolder(component, RESULTS_FOLDER_NAME);
  const folder = resultFolder(results, request.resultId, request.resultName);
  const parts = String(request.path || '').split('/').filter(Boolean);
  const relativeParts = parts.length > 1 ? parts.slice(1) : parts;
  const fileName = relativeParts.pop() || 'archivo';
  let parent = folder;
  relativeParts.forEach((name) => { parent = childFolder(parent, name); });
  if (parent.getFilesByName(fileName).hasNext()) return;
  const base64 = String(request.data || '').split(',').pop();
  if (!base64) throw new Error('Archivo sin contenido');
  const bytes = Utilities.base64Decode(base64);
  parent.createFile(Utilities.newBlob(bytes, request.mimeType || 'application/octet-stream', fileName));
}

function resultFolder(parent, resultId, resultName) {
  const name = `resultado-${resultId}-${safeName(resultName || 'archivos')}`;
  const matches = parent.getFoldersByName(name);
  return matches.hasNext() ? matches.next() : parent.createFolder(name);
}

function childFolder(parent, name) {
  const matches = parent.getFoldersByName(name);
  return matches.hasNext() ? matches.next() : parent.createFolder(name);
}

function findResultFolder(parent, resultId) {
  const prefix = `resultado-${String(resultId || '')}-`;
  const folders = parent.getFolders();
  while (folders.hasNext()) {
    const folder = folders.next();
    if (folder.getName().indexOf(prefix) === 0) return folder;
  }
  return null;
}

function componentResultsFolder(componentId) {
  const location = componentEntry(componentId, 'Componente');
  return childFolder(componentFolder(location.root, location.entry, null), RESULTS_FOLDER_NAME);
}

function deleteResultFolder(componentId, resultId) {
  const folder = findResultFolder(componentResultsFolder(componentId), resultId);
  if (folder) folder.setTrashed(true);
}

function resultFolderLink(componentId, resultId) {
  const folder = findResultFolder(componentResultsFolder(componentId), resultId);
  if (!folder) return { ok: false, error: 'No se encontró la carpeta de resultados en Drive.' };
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { ok: true, url: folder.getUrl() };
}

function respond(payload, e) {
  const callback = e && e.parameter ? e.parameter.callback : '';
  if (callback && /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(callback)) {
    return ContentService.createTextOutput(`${callback}(${JSON.stringify(payload)});`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
