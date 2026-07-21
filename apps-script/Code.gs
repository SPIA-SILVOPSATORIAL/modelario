const DESTINATION_FOLDER_ID = '1p7xdXX8BGPHeMmctfjmClxTU0Wkj3q6S';
const PROJECT_FILE_NAME = 'modelario-shared.json';

function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : '';
  if (action === 'result-folder-link') {
    return respond(resultFolderLink(e.parameter.resultId), e);
  }
  let file = projectFile();
  if (!file) {
    writeProject(JSON.stringify({
      updatedAt: new Date().toISOString(),
      data: { components: [] }
    }, null, 2));
    file = projectFile();
  }
  const stored = file ? JSON.parse(file.getBlob().getDataAsString()) : null;
  return respond({ ok: true, data: stored ? stored.data : null }, e);
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
    deleteResultFolder(request.resultId);
    return respond({ ok: true }, e);
  }
  const content = JSON.stringify({
    updatedAt: new Date().toISOString(),
    data: request.data
  }, null, 2);
  writeProject(content);

  return respond({ ok: true }, e);
}

function projectFile() {
  const matches = DriveApp.getFolderById(DESTINATION_FOLDER_ID)
    .getFilesByName(PROJECT_FILE_NAME);
  return matches.hasNext() ? matches.next() : null;
}

function writeProject(content) {
  const file = projectFile();
  if (file) {
    file.setContent(content);
  } else {
    DriveApp.getFolderById(DESTINATION_FOLDER_ID)
      .createFile(PROJECT_FILE_NAME, content, 'application/json');
  }
}

function saveResultFile(request) {
  const root = DriveApp.getFolderById(DESTINATION_FOLDER_ID);
  const folder = resultFolder(root, request.resultId, request.resultName);
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

function resultFolder(root, resultId, resultName) {
  const name = `resultado-${resultId}-${String(resultName || 'archivos').replace(/[\\/]/g, '-')}`;
  const matches = root.getFoldersByName(name);
  return matches.hasNext() ? matches.next() : root.createFolder(name);
}

function childFolder(parent, name) {
  const matches = parent.getFoldersByName(name);
  return matches.hasNext() ? matches.next() : parent.createFolder(name);
}

function findResultFolder(root, resultId) {
  const prefix = `resultado-${String(resultId || '')}-`;
  const folders = root.getFolders();
  while (folders.hasNext()) {
    const folder = folders.next();
    if (folder.getName().indexOf(prefix) === 0) return folder;
  }
  return null;
}

function deleteResultFolder(resultId) {
  const root = DriveApp.getFolderById(DESTINATION_FOLDER_ID);
  const folder = findResultFolder(root, resultId);
  if (folder) folder.setTrashed(true);
}

function resultFolderLink(resultId) {
  const root = DriveApp.getFolderById(DESTINATION_FOLDER_ID);
  const folder = findResultFolder(root, resultId);
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
