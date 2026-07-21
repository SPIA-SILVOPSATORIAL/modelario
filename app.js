(() => {
  "use strict";

  const MAX_RESULT_SIZE = 50_000_000;
  const CLOUD_SYNC_ENDPOINT = "https://script.google.com/macros/s/AKfycbzAsanCfW08iTgfXvEFtU5a38qKz5BaZ-p1Ed3A2x6WYhLnvWjll1cArf1hA1CzrAYeBw/exec";
  const CLOUD_SYNC_DELAY = 1800;
  let data = { components: [] };
  let selectedComponentId = data.components[0]?.id ?? null;
  let selectedArchitectureId = data.components[0]?.architectures[0]?.id ?? null;
  let selectedVersionId = data.components[0]?.architectures[0]?.versions[0]?.id ?? null;
  let activeTab = "overview";
  let activeEntityMenu = null;
  let entityMenuCloseTimer = null;
  let pendingResultFiles = [];
  let toastTimer = null;
  let cloudSyncTimer = null;
  let latestCloudSnapshot = null;
  let cloudReady = false;
  let cloudLoadError = false;

  const tree = document.getElementById("tree");
  const totals = document.getElementById("sidebar-totals");
  const breadcrumb = document.getElementById("breadcrumb");
  const content = document.getElementById("content");
  const modalRoot = document.getElementById("modal-root");
  const toast = document.getElementById("toast");

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function uid(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }
  function esc(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
  function statusClass(value) { return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }

  function normalize(source) {
    if (Array.isArray(source?.components)) return { components: source.components.map((component) => ({ ...component, objective: component.objective || "", notes: Array.isArray(component.notes) ? component.notes : (component.currentNotes ? [{ id: uid("note"), date: new Date().toISOString().slice(0, 10), text: component.currentNotes }] : []), activities: component.activities || [], architectures: component.architectures || [] })) };
    if (!Array.isArray(source?.groups)) return { components: [] };
    return { components: source.groups.flatMap((group) => group.components.map((part) => {
      const model = part.model;
      const version = model ? { id: uid("version"), version: model.version || "0.001", source: model.source || "", resolution: model.resolution || "", tileSize: model.tileSize || "", stride: model.stride || "", trainingLevel: model.trainingLevel || "", labels: model.labels || "", trainPeriod: model.trainPeriod || "", geography: model.geography || "", notes: model.notes || "", evaluation: null, results: model.results || [] } : null;
      return { id: part.id || uid("component"), name: part.name || "Componente sin nombre", description: part.description || "", status: part.status || "Exploración", objective: model?.objective || "", notes: [], activities: [], architectures: version ? [{ id: model.id || uid("architecture"), name: model.family || "Arquitectura sin definir", versions: [version] }] : [] };
    })) };
  }

  function queueCloudSync() {
    latestCloudSnapshot = clone(data);
    window.clearTimeout(cloudSyncTimer);
    cloudSyncTimer = window.setTimeout(syncCloudSnapshot, CLOUD_SYNC_DELAY);
  }
  function cloudSaveFrame() {
    let frame = document.getElementById("modelario-cloud-save-frame");
    if (frame) return frame.name;
    frame = document.createElement("iframe");
    frame.id = "modelario-cloud-save-frame";
    frame.name = "modelario-cloud-save-frame";
    frame.hidden = true;
    document.body.appendChild(frame);
    return frame.name;
  }
  function syncCloudSnapshot() {
    if (!latestCloudSnapshot) return;
    const snapshot = latestCloudSnapshot;
    latestCloudSnapshot = null;
    try {
      const form = document.createElement("form");
      const payload = document.createElement("textarea");
      form.method = "post";
      form.action = CLOUD_SYNC_ENDPOINT;
      form.target = cloudSaveFrame();
      form.hidden = true;
      payload.name = "payload";
      payload.value = JSON.stringify({ data: snapshot });
      form.appendChild(payload);
      document.body.appendChild(form);
      form.submit();
      window.setTimeout(() => form.remove(), 1_000);
    } catch {
      latestCloudSnapshot = snapshot;
      notify("No se pudo sincronizar con Drive; se reintentará mientras la página esté abierta");
    }
    if (latestCloudSnapshot) {
      window.clearTimeout(cloudSyncTimer);
      cloudSyncTimer = window.setTimeout(syncCloudSnapshot, 15_000);
    }
  }
  function persist(message) {
    render();
    queueCloudSync();
    notify(message);
  }
  function loadCloudData() {
    cloudReady = false;
    cloudLoadError = false;
    render();
    const callback = `modelarioCloudLoad_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let completed = false;
    let timeout = null;
    let script = null;
    const cleanUp = () => { window.clearTimeout(timeout); script?.remove(); delete window[callback]; };
    const fail = () => {
      if (completed) return;
      completed = true;
      cleanUp();
      cloudLoadError = true;
      render();
      notify("No se pudo cargar la información de Drive");
    };
    window[callback] = (response) => {
      if (completed) return;
      if (!response?.ok) { fail(); return; }
      completed = true;
      cleanUp();
      data = response.data ? normalize(response.data) : { components: [] };
      selectedComponentId = data.components[0]?.id ?? null;
      selectedArchitectureId = data.components[0]?.architectures[0]?.id ?? null;
      selectedVersionId = data.components[0]?.architectures[0]?.versions[0]?.id ?? null;
      activeTab = "overview";
      cloudReady = true;
      render();
      hydrateFrames();
      if (!response.data) queueCloudSync();
    };
    script = document.createElement("script");
    script.async = true;
    script.src = `${CLOUD_SYNC_ENDPOINT}?callback=${encodeURIComponent(callback)}&timestamp=${Date.now()}`;
    script.onerror = fail;
    timeout = window.setTimeout(fail, 15_000);
    document.head.appendChild(script);
  }
  function cloudJsonp(action, params = {}) {
    return new Promise((resolve, reject) => {
      const callback = `modelarioCloudAction_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      let completed = false;
      let script = null;
      const timeout = window.setTimeout(() => finish(new Error("Drive tardó demasiado en responder")), 60_000);
      const cleanUp = () => { window.clearTimeout(timeout); script?.remove(); delete window[callback]; };
      const finish = (error, response) => {
        if (completed) return;
        completed = true;
        cleanUp();
        if (error) reject(error); else resolve(response);
      };
      window[callback] = (response) => finish(null, response);
      script = document.createElement("script");
      const query = new URLSearchParams({ action, callback, timestamp: String(Date.now()), ...params });
      script.src = `${CLOUD_SYNC_ENDPOINT}?${query.toString()}`;
      script.onerror = () => finish(new Error("No se pudo conectar con Drive"));
      document.head.appendChild(script);
    });
  }
  function postCloudAction(request) {
    return fetch(CLOUD_SYNC_ENDPOINT, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(request)
    });
  }
  function current() {
    const component = data.components.find((item) => item.id === selectedComponentId) ?? data.components[0] ?? null;
    if (component) selectedComponentId = component.id;
    const architecture = component?.architectures.find((item) => item.id === selectedArchitectureId) ?? component?.architectures[0] ?? null;
    if (architecture) selectedArchitectureId = architecture.id;
    const version = architecture?.versions.find((item) => item.id === selectedVersionId) ?? architecture?.versions[0] ?? null;
    if (version) selectedVersionId = version.id;
    return { component, architecture, version };
  }
  function notify(message) { window.clearTimeout(toastTimer); toast.textContent = `✓ ${message}`; toast.hidden = false; toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2600); }

  function render() {
    if (!cloudReady) {
      tree.innerHTML = "";
      totals.innerHTML = `<span>${cloudLoadError ? "Sin conexión a Drive" : "Conectando con Drive…"}</span>`;
      breadcrumb.innerHTML = "";
      content.innerHTML = `<div class="empty-state"><span class="empty-icon">${cloudLoadError ? "!" : "…"}</span><h2>${cloudLoadError ? "No se pudo cargar el proyecto" : "Cargando proyecto compartido"}</h2><p>${cloudLoadError ? "Comprueba la conexión e inténtalo de nuevo." : "Leyendo la información central desde Drive."}</p>${cloudLoadError ? `<button class="primary-button" type="button" data-action="retry-cloud">Reintentar</button>` : ""}</div>`;
      return;
    }
    const { component, architecture, version } = current();
    tree.innerHTML = data.components.map((item) => `<div class="tree-group"><div class="tree-group-title"><button class="group-button ${item.id === component?.id ? "active" : ""}" type="button" data-action="component" data-id="${esc(item.id)}"><span class="folder-dot"></span><span>${esc(item.name)}</span><small>${item.architectures.length}</small></button>${entityMenu(item.id)}</div></div>`).join("");
    const architectureCount = data.components.reduce((sum, item) => sum + item.architectures.length, 0);
    const versionCount = data.components.reduce((sum, item) => sum + item.architectures.reduce((inner, item) => inner + item.versions.length, 0), 0);
    totals.innerHTML = `<span>${data.components.length} componentes</span><span>${architectureCount} arquitecturas</span><span>${versionCount} versiones</span>`;
    breadcrumb.innerHTML = component ? `<strong>${esc(component.name)}</strong>${architecture ? `<b>›</b><span>${esc(architecture.name)}</span>${version ? `<b>›</b><span>v${esc(version.version)}</span>` : ""}` : ""}` : `<strong>Sin componentes</strong>`;
    if (!component) { content.innerHTML = emptyState("◇", "Crea tu primer componente", "Organiza aquí un caso de uso y sus arquitecturas comparables.", "Nuevo componente", "component"); return; }
    const tabs = [["tracking", "Seguimiento"], ["overview", "Arquitecturas"], ["spec", "Ficha técnica"], ["results", "Resultados"]];
    content.innerHTML = `<section class="component-hero"><div><div class="eyebrow"><span class="status status-${statusClass(component.status)}">${esc(component.status)}</span><span>Componente</span></div><h1>${esc(component.name)}</h1><p>${esc(component.description)}</p></div><div class="hero-aside">${architecture ? `<div class="model-selector"><span>ARQUITECTURA ACTIVA</span><strong>${esc(architecture.name)}</strong><small>v${esc(version?.version || "sin versión")}</small></div>` : ""}</div></section><div class="tabbar" role="tablist">${tabs.map(([id, label]) => `<button type="button" role="tab" aria-selected="${activeTab === id}" data-action="tab" data-tab="${id}">${label}</button>`).join("")}</div><div id="tab-content">${renderTab(component, architecture, version)}</div>`;
  }
  function renderTab(component, architecture, version) {
    if (activeTab === "tracking") return renderTracking(component);
    if (!architecture) return emptyState("⌁", "Aún no hay arquitecturas", "Añade una arquitectura para documentar versiones, métricas y resultados.", "Añadir arquitectura", "architecture");
    if (!version) return `<section><div class="page-section-heading"><div><span>ARQUITECTURA</span><h2>${esc(architecture.name)}</h2><p>Esta arquitectura aún no tiene versiones.</p></div><button class="danger-button" type="button" data-action="delete-architecture">Eliminar arquitectura</button></div>${emptyState("⌁", "Esta arquitectura aún no tiene versiones", "Crea la primera versión para registrar su ficha técnica, métricas y resultados.", "Añadir versión", "new-version")}</section>`;
    if (activeTab === "results") return renderResults(architecture, version);
    if (activeTab === "spec") return `${renderSpec(component, architecture, version)}${renderEvaluation(architecture, version)}`;
    return renderOverview(component, architecture, version);
  }
  function renderOverview(component, architecture, version) {
    const firstResult = version.results[0];
    const metrics = evaluationMetrics(version.evaluation);
    return `<section class="architecture-section"><div class="page-section-heading"><div><span>ARQUITECTURAS DEL COMPONENTE</span><h2>Alternativas técnicas</h2><p>Selecciona una arquitectura para revisar su versión activa.</p></div><div class="inline-actions"><button class="primary-button" type="button" data-action="modal" data-modal="architecture">＋ Añadir arquitectura</button><button class="danger-button" type="button" data-action="delete-architecture">Eliminar arquitectura</button></div></div><div class="selection-dropdowns single-selector"><label><span>ARQUITECTURA ACTIVA</span><select data-select="architecture">${component.architectures.map((item) => `<option value="${esc(item.id)}" ${item.id === architecture.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label></div><div class="overview-grid"><section class="summary-panel"><div class="section-title"><div><span>VERSIÓN ACTIVA</span><h2>${esc(architecture.name)} <i>v${esc(version.version)}</i></h2></div><button type="button" data-action="tab" data-tab="spec">Ver ficha y evaluación →</button></div><div class="fact-grid">${fact("Fuente de imagen", version.source)}${fact("Resolución", version.resolution)}${fact("Unidad de entrenamiento", version.trainingLevel)}</div></section><section class="quick-panel"><div class="section-title"><div><span>ÚLTIMA CARPETA</span><h2>Resultados</h2></div><button type="button" data-action="tab" data-tab="results">Ver →</button></div>${firstResult ? `<div class="mini-empty"><strong>${esc(firstResult.name)}</strong><span>${esc(resultFolderDetails(firstResult))}</span></div>` : `<div class="mini-empty">Todavía no hay carpetas adjuntas</div>`}</section><section class="metrics-strip"><div class="section-title"><div><span>RENDIMIENTO</span><h2>Métricas calculadas</h2></div><button type="button" data-action="tab" data-tab="spec">Abrir ficha y evaluación →</button></div><div class="metric-row">${metrics.slice(0, 4).map((metric) => `<div><span>${esc(metric.name)}</span><strong>${esc(metric.value)}</strong><em>${esc(version.evaluation?.split || "")}</em></div>`).join("") || `<div><span>Sin matriz registrada</span></div>`}</div></section></div></section>`;
  }
  function renderTracking(component) {
    const activities = [...component.activities].sort((a, b) => a.date.localeCompare(b.date));
    return `<section><div class="page-section-heading"><div><span>CONTEXTO DEL COMPONENTE</span><h2>Seguimiento</h2><p>Objetivo, notas y bitácora de trabajo.</p></div><div class="inline-actions"><button class="quiet-button" type="button" data-action="modal" data-modal="tracking">Editar objetivo</button><button class="quiet-button" type="button" data-action="modal" data-modal="note">＋ Nota</button><button class="primary-button" type="button" data-action="modal" data-modal="activity">＋ Actividad</button></div></div><div class="tracking-grid"><section class="summary-panel"><span>OBJETIVO</span><p class="tracking-copy">${esc(component.objective || "Sin objetivo registrado.")}</p></section><section class="summary-panel"><span>NOTAS</span>${component.notes.length ? `<div class="note-list">${[...component.notes].reverse().map((note) => `<article><time>${esc(note.date)}</time><p>${esc(note.text)}</p></article>`).join("")}</div>` : `<p class="tracking-copy">Aún no hay notas.</p>`}</section></div><section class="calendar-panel"><div class="section-title"><div><span>CALENDARIO DE TRABAJO</span><h2>Bitácora</h2></div></div>${activities.length ? `<div class="calendar-grid">${activities.map((item) => `<article class="calendar-entry"><time>${esc(item.date)}</time><span class="activity-status status-${statusClass(item.status)}">${esc(item.status)}</span><strong>${esc(item.title)}</strong><p>${esc(item.notes || "Sin notas.")}</p></article>`).join("")}</div>` : `<div class="mini-empty">Aún no hay actividades registradas</div>`}</section></section>`;
  }
  function renderSpec(component, architecture, version) {
    return `<section><div class="page-section-heading"><div><span>FICHA TÉCNICA</span><h2>${esc(architecture.name)} <i>v${esc(version.version)}</i></h2><p>Datos técnicos de esta versión; el objetivo y el seguimiento se registran aparte.</p></div><div class="inline-actions"><button class="primary-button" type="button" data-action="modal" data-modal="new-version">＋ Nueva versión</button><button class="quiet-button" type="button" data-action="modal" data-modal="version">Editar versión</button><button class="danger-button" type="button" data-action="delete-version">Eliminar ficha</button></div></div><div class="selection-dropdowns"><label><span>ARQUITECTURA</span><select data-select="architecture">${component.architectures.map((item) => `<option value="${esc(item.id)}" ${item.id === architecture.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label><label><span>VERSIÓN</span><select data-select="version">${architecture.versions.map((item) => `<option value="${esc(item.id)}" ${item.id === version.id ? "selected" : ""}>v${esc(item.version)}</option>`).join("")}</select></label></div><div class="sheet-grid"><section><h3>Contexto espacial</h3>${fact("Geografía", version.geography)}${fact("Periodo de datos", version.trainPeriod)}</section><section><h3>Imágenes y tiles</h3>${fact("Fuente", version.source)}${fact("Resolución", version.resolution)}${version.trainingLevel === "Tile" ? `${fact("Tamaño de tile", version.tileSize)}${fact("Stride", version.stride)}` : ""}</section><section><h3>Entrenamiento</h3>${fact("Unidad", version.trainingLevel)}${fact("Etiquetas", version.labels)}</section></div><div class="notes-block"><span>NOTAS DE LA VERSIÓN</span><p>${esc(version.notes || "Sin notas registradas.")}</p></div></section>`;
  }
  function renderEvaluation(architecture, version) {
    const matrix = version.evaluation ?? { split: "Validación", tp: "", fp: "", fn: "", tn: "" };
    const metrics = evaluationMetrics(matrix);
    return `<section><div class="page-section-heading"><div><span>EVALUACIÓN · ${esc(architecture.name)} v${esc(version.version)}</span><h2>Matriz de confusión</h2><p>Registra la matriz; las métricas se calculan automáticamente a partir de ella.</p></div></div><form id="matrix-form" class="evaluation-layout"><section class="matrix-panel"><label class="matrix-context"><span>PARTICIÓN</span><select name="split"><option ${matrix.split === "Validación" ? "selected" : ""}>Validación</option><option ${matrix.split === "Test" ? "selected" : ""}>Test</option></select></label><div class="matrix-table"><div class="matrix-corner">Real / Predicho</div><div>Positivo</div><div>Negativo</div><div>Positivo</div><label><span>TP</span><input name="tp" type="number" min="0" step="1" value="${esc(matrix.tp)}" required></label><label><span>FN</span><input name="fn" type="number" min="0" step="1" value="${esc(matrix.fn)}" required></label><div>Negativo</div><label><span>FP</span><input name="fp" type="number" min="0" step="1" value="${esc(matrix.fp)}" required></label><label><span>TN</span><input name="tn" type="number" min="0" step="1" value="${esc(matrix.tn)}" required></label></div><p class="matrix-help">TP: verdadero positivo · FP: falso positivo · FN: falso negativo · TN: verdadero negativo.</p><button class="primary-button" type="submit">Guardar matriz</button></section><section class="calculated-panel"><span>MÉTRICAS CALCULADAS</span>${metrics.length ? `<div class="metric-cards calculated-cards">${metrics.map((metric) => `<article><span>${esc(metric.name)}</span><strong>${esc(metric.value)}</strong></article>`).join("")}</div>` : `<div class="mini-empty">Completa la matriz para calcular las métricas.</div>`}</section></form></section>`;
  }
  function evaluationMetrics(matrix) {
    const values = [matrix?.tp, matrix?.fp, matrix?.fn, matrix?.tn].map((value) => Number(String(value).replace(",", ".")));
    if (values.some((value) => !Number.isFinite(value) || value < 0) || values.reduce((sum, value) => sum + value, 0) === 0) return [];
    const [tp, fp, fn, tn] = values;
    const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;
    const format = (value) => value === null ? "—" : new Intl.NumberFormat("es-CO", { style: "percent", maximumFractionDigits: 1 }).format(value);
    return [{ name: "Precisión", value: format(ratio(tp, tp + fp)) }, { name: "Recall", value: format(ratio(tp, tp + fn)) }, { name: "F1-score", value: format(ratio(2 * tp, 2 * tp + fp + fn)) }, { name: "Especificidad", value: format(ratio(tn, tn + fp)) }, { name: "Accuracy", value: format(ratio(tp + tn, tp + fp + fn + tn)) }, { name: "IoU", value: format(ratio(tp, tp + fp + fn)) }];
  }
  function resultFolderDetails(result) {
    const count = Number(result.fileCount || result.files?.length || 0);
    const size = Number(result.totalSize || 0);
    return `${count} archivo${count === 1 ? "" : "s"}${size ? ` · ${formatFileSize(size)}` : ""}`;
  }
  function renderResults(architecture, version) {
    return `<section class="results-view"><div class="page-section-heading"><div><span>${esc(architecture.name)} · v${esc(version.version)}</span><h2>Carpetas de resultados</h2><p>Archivos adjuntos a esta versión.</p></div><button class="primary-button" type="button" data-action="modal" data-modal="result">＋ Añadir carpeta</button></div>${version.results.length ? `<div class="result-folder-list">${version.results.map((result) => `<article class="result-folder-card"><div><span>CARPETA</span><strong>${esc(result.name)}</strong><small>${esc(resultFolderDetails(result))}</small></div><div class="result-folder-actions"><time>${esc(result.updatedAt || "")}</time><div><button class="quiet-button" type="button" data-action="open-result" data-id="${esc(result.id)}">Abrir en Drive</button><button class="danger-button" type="button" data-action="delete-result" data-id="${esc(result.id)}">Eliminar</button></div></div></article>`).join("")}</div>` : emptyState("◇", "No hay carpetas todavía", "Adjunta una carpeta con los resultados de esta versión.", "Añadir carpeta", "result")}</section>`;
  }
  function fact(label, value) { return `<div class="fact"><span>${esc(label)}</span><strong>${esc(value || "—")}</strong></div>`; }
  function emptyState(icon, title, text, button, modal) { return `<div class="empty-state"><span class="empty-icon">${icon}</span><h2>${esc(title)}</h2><p>${esc(text)}</p><button class="primary-button" type="button" data-action="modal" data-modal="${modal}">${esc(button)}</button></div>`; }
  function entityMenu(id) { const menuId = `component:${id}`; const isOpen = activeEntityMenu === menuId; return `<div class="entity-menu"><button class="more-button" type="button" data-action="toggle-menu" data-menu="${esc(menuId)}" aria-label="Opciones del componente" aria-expanded="${isOpen}">•••</button>${isOpen ? `<div class="entity-menu-popover" role="menu"><button type="button" role="menuitem" data-action="modal" data-modal="rename-component">Renombrar</button><button class="menu-danger" type="button" role="menuitem" data-action="delete-component">Eliminar</button></div>` : ""}</div>`; }
  function hydrateFrames() {}

  function openModal(kind) {
    const { component, architecture, version } = current();
    const title = { component: "Nuevo componente", "rename-component": "Renombrar componente", architecture: "Nueva arquitectura", version: "Editar versión", "new-version": "Nueva versión", tracking: "Objetivo del componente", note: "Nueva nota", activity: "Nueva actividad", result: "Añadir carpeta de resultados" }[kind];
    let fields = "";
    if (kind === "component") fields = field("Nombre del componente", "name", "Ej. Detección de suelo desnudo", "", true) + field("Descripción", "description", "Qué representa este componente", "", false, true);
    if (kind === "rename-component") fields = field("Nombre del componente", "name", "", component?.name, true);
    if (kind === "architecture") fields = field("Arquitectura", "name", "Ej. U-Net, Mask R-CNN", "", true);
    if (kind === "tracking") fields = field("Objetivo", "objective", "Qué se busca lograr con este componente", component?.objective, false, true);
    if (kind === "note") fields = field("Nota", "text", "Registra una novedad, decisión o hallazgo", "", true, true);
    if (kind === "activity") fields = `<div class="form-grid">${field("Fecha", "date", "", new Date().toISOString().slice(0, 10), true, false, false, "date")}${selectField("Estado", "status", "En curso", ["Planeado", "En curso", "Terminado", "Bloqueado"])}</div>${field("Actividad", "title", "Ej. Etiquetado de nuevos tiles", "", true)}${field("Notas", "notes", "Detalle, decisión o bloqueo", "", false, true)}`;
    if (kind === "result") { pendingResultFiles = []; fields = `<div id="result-dropzone" class="result-dropzone" tabindex="0" role="button" aria-label="Seleccionar carpeta de resultados"><strong>Selecciona una carpeta de resultados</strong><span>Incluye allí todos los archivos que quieras conservar con esta versión.</span><div class="upload-actions"><label class="quiet-button" for="result-folder">Seleccionar carpeta</label></div><input id="result-folder" type="file" webkitdirectory directory></div><p id="result-file-status" class="upload-status">Aún no has seleccionado una carpeta.</p>`; }
    if (kind === "version" || kind === "new-version") { const source = kind === "new-version" ? { ...version, version: nextVersion(version?.version), notes: "" } : version; fields = versionFields(source); }
    const modalActions = kind === "result" ? `<div class="modal-actions"><button type="button" class="quiet-button" data-action="close">Cancelar</button></div>` : `<div class="modal-actions"><button type="button" class="quiet-button" data-action="close">Cancelar</button><button type="submit" class="primary-button">Guardar</button></div>`;
    modalRoot.innerHTML = `<div id="modal-backdrop" class="modal-backdrop"><div class="modal-card wide" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><div><span>${architecture ? esc(architecture.name) : "MODELARIO"}</span><h2 id="modal-title">${esc(title)}</h2></div><button class="icon-button" type="button" data-action="close" aria-label="Cerrar">×</button></div><form id="modal-form" data-kind="${kind}">${fields}${modalActions}</form></div></div>`;
    toggleTileFields();
    (kind === "result" ? modalRoot.querySelector("#result-dropzone") : document.querySelector("#modal-form input, #modal-form textarea, #modal-form select"))?.focus();
  }
  function versionFields(value = {}) { return `<div class="form-grid">${field("Versión", "version", "0.001", value.version, true)}${selectField("Unidad de entrenamiento", "trainingLevel", value.trainingLevel, ["Tile", "Finca", "Potrero", "Pixel"])}${field("Fuente de imagen", "source", "PlanetScope, Sentinel-2, dron…", value.source)}${field("Resolución espacial", "resolution", "3 m/píxel", value.resolution)}${field("Tamaño de tile", "tileSize", "512 × 512 px", value.tileSize, false, false, false, "text", "tile-only")}${field("Stride / solape", "stride", "256 px / 50%", value.stride, false, false, false, "text", "tile-only")}${field("Tipo de etiquetas", "labels", "Polígonos, puntos, clases…", value.labels)}${field("Periodo de datos", "trainPeriod", "2023-01 — 2025-01", value.trainPeriod)}${field("Geografía", "geography", "Región / país", value.geography)}</div>${field("Notas de la versión", "notes", "Cambios marginales, decisiones y limitaciones", value.notes, false, true)}`; }
  function field(label, name, placeholder, value = "", required = false, textarea = false, large = false, type = "text", className = "") { return `<label class="field ${className}"><span>${esc(label)}</span>${textarea ? `<textarea name="${name}" placeholder="${esc(placeholder)}" class="${large ? "large" : ""}" ${required ? "required" : ""}>${esc(value || "")}</textarea>` : `<input type="${type}" name="${name}" placeholder="${esc(placeholder)}" value="${esc(value || "")}" ${required ? "required" : ""}>`}</label>`; }
  function selectField(label, name, value, options) { return `<label class="field"><span>${esc(label)}</span><select name="${name}">${options.map((option) => `<option ${option === value ? "selected" : ""}>${esc(option)}</option>`).join("")}</select></label>`; }
  function nextVersion(value) { const number = Number.parseFloat(value || "0") || 0; return (number + 0.001).toFixed(3); }
  function closeModal() { modalRoot.innerHTML = ""; }
  async function submitModal(event) {
    event.preventDefault(); const form = event.target; const values = Object.fromEntries(new FormData(form).entries()); const kind = form.dataset.kind; const { component, architecture, version } = current();
    if (kind === "component") { const created = { id: uid("component"), name: values.name.trim(), description: values.description.trim(), status: "Exploración", objective: "", notes: [], activities: [], architectures: [] }; data.components.push(created); selectedComponentId = created.id; selectedArchitectureId = null; selectedVersionId = null; }
    if (kind === "rename-component" && component) component.name = values.name.trim();
    if (kind === "architecture" && component) { const firstVersion = { id: uid("version"), version: "0.001", source: "", resolution: "", tileSize: "", stride: "", trainingLevel: "Tile", labels: "", trainPeriod: "", geography: "", notes: "", evaluation: null, results: [] }; const created = { id: uid("architecture"), name: values.name.trim(), versions: [firstVersion] }; component.architectures.push(created); selectedArchitectureId = created.id; selectedVersionId = firstVersion.id; }
    if (kind === "tracking" && component) component.objective = values.objective.trim();
    if (kind === "note" && component) component.notes.push({ id: uid("note"), date: new Date().toLocaleDateString("es-CO"), text: values.text.trim() });
    if (kind === "activity" && component) component.activities.push({ id: uid("activity"), date: values.date, title: values.title.trim(), status: values.status, notes: values.notes.trim() });
    if (kind === "version" && version) Object.assign(version, versionData(values, version));
    if (kind === "new-version" && architecture) { const created = { id: uid("version"), ...versionData(values), evaluation: null, results: [] }; architecture.versions.push(created); selectedVersionId = created.id; }
    if (kind === "result") return;
    closeModal(); persist(kind === "result" ? "Resultado añadido; sincronizando con Drive" : "Cambios sincronizándose con Drive"); window.setTimeout(hydrateFrames, 0);
  }
  function normalizedPath(value) { return String(value || "").replace(/\\/g, "/").split("/").reduce((parts, part) => { if (!part || part === ".") return parts; if (part === "..") { parts.pop(); return parts; } parts.push(part); return parts; }, []).join("/"); }
  function recordFile(file, path = file.webkitRelativePath || file.name) { return { file, path: normalizedPath(path) }; }
  function readDataUrl(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("No se pudo leer un asset")); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file); }); }
  async function buildResultFolder(records) {
    if (!records.length) throw new Error("Selecciona una carpeta con los resultados");
    const largeFile = records.find((record) => record.file.size > MAX_RESULT_SIZE);
    if (largeFile) throw new Error(`El archivo ${largeFile.file.name} supera 50 MB`);
    const folderName = records[0].path.split("/")[0] || "Carpeta de resultados";
    return { id: uid("result"), name: folderName, fileCount: records.length, totalSize: records.reduce((sum, record) => sum + record.file.size, 0), updatedAt: new Date().toLocaleDateString("es-CO") };
  }
  function formatFileSize(bytes) { if (!bytes) return "0 B"; const units = ["B", "KB", "MB", "GB"]; const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1); return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`; }
  function updatePendingResultStatus() { const status = modalRoot.querySelector("#result-file-status"); if (!status) return; const totalSize = pendingResultFiles.reduce((total, record) => total + record.file.size, 0); status.textContent = `${pendingResultFiles.length} archivo${pendingResultFiles.length === 1 ? "" : "s"} seleccionado${pendingResultFiles.length === 1 ? "" : "s"} · ${formatFileSize(totalSize)}`; }
  function addPendingResultFiles(records) { const seen = new Set(pendingResultFiles.map((record) => `${record.path}:${record.file.size}:${record.file.lastModified}`)); pendingResultFiles.push(...records.filter((record) => { const key = `${record.path}:${record.file.size}:${record.file.lastModified}`; if (seen.has(key)) return false; seen.add(key); return true; })); updatePendingResultStatus(); }
  async function attachResultFolder() {
    const { version } = current();
    const status = modalRoot.querySelector("#result-file-status");
    if (!version || !pendingResultFiles.length) return;
    if (status) status.textContent = "Preparando carpeta…";
    try {
      const result = await buildResultFolder(pendingResultFiles);
      for (let index = 0; index < pendingResultFiles.length; index += 1) {
        const record = pendingResultFiles[index];
        if (status) status.textContent = `Subiendo archivo ${index + 1} de ${pendingResultFiles.length}…`;
        await postCloudAction({ action: "result-file", resultId: result.id, resultName: result.name, path: record.path, mimeType: record.file.type || "application/octet-stream", data: await readDataUrl(record.file) });
      }
      version.results.unshift(result);
      closeModal();
      persist("Carpeta añadida; sincronizando con Drive");
    } catch (error) {
      const message = error.message || "No se pudo preparar la carpeta";
      if (status) status.textContent = message;
      notify(message);
    }
  }
  function versionData(values) { return { version: values.version.trim(), source: values.source.trim(), resolution: values.resolution.trim(), tileSize: values.trainingLevel === "Tile" ? values.tileSize.trim() : "", stride: values.trainingLevel === "Tile" ? values.stride.trim() : "", trainingLevel: values.trainingLevel, labels: values.labels.trim(), trainPeriod: values.trainPeriod.trim(), geography: values.geography.trim(), notes: values.notes.trim() }; }
  function toggleTileFields() { const trainingLevel = modalRoot.querySelector('[name="trainingLevel"]'); if (!trainingLevel) return; const isTile = trainingLevel.value === "Tile"; modalRoot.querySelectorAll(".tile-only").forEach((field) => { field.hidden = !isTile; const input = field.querySelector("input"); if (input) input.required = isTile; }); }
  function exportData() { const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `modelario-respaldo-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(link.href); notify("Respaldo exportado"); }
  function deleteComponent() { const { component } = current(); if (!component || !window.confirm(`¿Eliminar el componente “${component.name}” y todas sus arquitecturas? Esta acción no se puede deshacer.`)) return; data.components = data.components.filter((item) => item.id !== component.id); selectedComponentId = data.components[0]?.id ?? null; selectedArchitectureId = data.components[0]?.architectures[0]?.id ?? null; selectedVersionId = data.components[0]?.architectures[0]?.versions[0]?.id ?? null; activeTab = "overview"; persist("Componente eliminado"); }
  function deleteArchitecture() { const { component, architecture } = current(); if (!component || !architecture || !window.confirm(`¿Eliminar la arquitectura “${architecture.name}” y todas sus versiones? Esta acción no se puede deshacer.`)) return; component.architectures = component.architectures.filter((item) => item.id !== architecture.id); selectedArchitectureId = component.architectures[0]?.id ?? null; selectedVersionId = component.architectures[0]?.versions[0]?.id ?? null; activeTab = "overview"; persist("Arquitectura eliminada"); }
  function deleteVersion() { const { architecture, version } = current(); if (!architecture || !version || !window.confirm(`¿Eliminar la versión ${version.version}? Esta acción no se puede deshacer.`)) return; architecture.versions = architecture.versions.filter((item) => item.id !== version.id); selectedVersionId = architecture.versions[0]?.id ?? null; activeTab = "spec"; persist("Versión eliminada"); }
  async function deleteResult(resultId) {
    const { version } = current();
    const result = version?.results.find((item) => item.id === resultId);
    if (!version || !result || !window.confirm(`¿Eliminar la carpeta “${result.name}” de Drive? Esta acción no se puede deshacer.`)) return;
    try {
      await postCloudAction({ action: "delete-result", resultId: result.id });
      version.results = version.results.filter((item) => item.id !== result.id);
      persist("Carpeta eliminada de Drive");
    } catch {
      notify("No se pudo eliminar la carpeta de Drive");
    }
  }
  async function openResultFolder(resultId) {
    const { version } = current();
    const result = version?.results.find((item) => item.id === resultId);
    if (!result) return;
    const resultWindow = window.open("", "_blank");
    notify("Abriendo carpeta en Drive…");
    try {
      const response = await cloudJsonp("result-folder-link", { resultId: result.id });
      if (!response?.ok || !response.url) throw new Error(response?.error || "No se pudo abrir la carpeta");
      if (resultWindow) resultWindow.location.assign(response.url); else window.location.assign(response.url);
    } catch (error) {
      resultWindow?.close();
      notify(error.message || "No se pudo descargar la carpeta");
    }
  }
  content.addEventListener("submit", (event) => { if (event.target.id !== "matrix-form") return; event.preventDefault(); const { version } = current(); if (!version) return; const values = Object.fromEntries(new FormData(event.target).entries()); version.evaluation = { split: values.split, tp: Number(values.tp), fp: Number(values.fp), fn: Number(values.fn), tn: Number(values.tn) }; persist("Matriz de confusión guardada"); });
  document.addEventListener("click", (event) => { const control = event.target.closest("[data-action]"); if (!control) return; const action = control.dataset.action; if (action === "retry-cloud") loadCloudData(); if (action === "component") { selectedComponentId = control.dataset.id; const item = data.components.find((value) => value.id === selectedComponentId); selectedArchitectureId = item?.architectures[0]?.id ?? null; selectedVersionId = item?.architectures[0]?.versions[0]?.id ?? null; activeTab = "overview"; render(); hydrateFrames(); } if (action === "architecture") { selectedArchitectureId = control.dataset.id; const architecture = current().component?.architectures.find((item) => item.id === selectedArchitectureId); selectedVersionId = architecture?.versions[0]?.id ?? null; if (!control.dataset.keepTab) activeTab = "overview"; render(); hydrateFrames(); } if (action === "version") { selectedVersionId = control.dataset.id; render(); hydrateFrames(); } if (action === "tab") { activeTab = control.dataset.tab; render(); hydrateFrames(); } if (action === "toggle-menu") { window.clearTimeout(entityMenuCloseTimer); activeEntityMenu = activeEntityMenu === control.dataset.menu ? null : control.dataset.menu; render(); hydrateFrames(); } if (action === "modal") openModal(control.dataset.modal); if (action === "close") closeModal(); if (action === "export") exportData(); if (action === "delete-component") deleteComponent(); if (action === "delete-architecture") deleteArchitecture(); if (action === "delete-version") deleteVersion(); if (action === "delete-result") deleteResult(control.dataset.id); if (action === "open-result") openResultFolder(control.dataset.id); });
  document.addEventListener("change", (event) => { const selector = event.target.closest("[data-select]"); if (!selector) return; if (selector.dataset.select === "architecture") { selectedArchitectureId = selector.value; const architecture = current().component?.architectures.find((item) => item.id === selectedArchitectureId); selectedVersionId = architecture?.versions[0]?.id ?? null; } if (selector.dataset.select === "version") selectedVersionId = selector.value; render(); hydrateFrames(); });
  tree.addEventListener("mouseout", (event) => { const menu = event.target.closest(".entity-menu"); if (!menu || menu.contains(event.relatedTarget) || !activeEntityMenu) return; window.clearTimeout(entityMenuCloseTimer); entityMenuCloseTimer = window.setTimeout(() => { activeEntityMenu = null; render(); hydrateFrames(); }, 1500); });
  tree.addEventListener("mouseover", (event) => { if (event.target.closest(".entity-menu")) window.clearTimeout(entityMenuCloseTimer); });
  modalRoot.addEventListener("click", (event) => { if (event.target.id === "modal-backdrop") closeModal(); const zone = event.target.closest("#result-dropzone"); if (zone && !event.target.closest("label")) modalRoot.querySelector("#result-folder")?.click(); });
  modalRoot.addEventListener("submit", (event) => { if (event.target.id === "modal-form") submitModal(event); });
  modalRoot.addEventListener("change", async (event) => { if (event.target.name === "trainingLevel") toggleTileFields(); if (event.target.id === "result-folder") { addPendingResultFiles([...event.target.files].map((file) => recordFile(file))); event.target.value = ""; await attachResultFolder(); } });
  modalRoot.addEventListener("keydown", (event) => { if (event.key !== "Enter" && event.key !== " ") return; const zone = event.target.closest("#result-dropzone"); if (!zone) return; event.preventDefault(); modalRoot.querySelector("#result-folder")?.click(); });
  document.getElementById("import-file").addEventListener("change", (event) => { const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { try { data = normalize(JSON.parse(String(reader.result))); selectedComponentId = data.components[0]?.id ?? null; selectedArchitectureId = data.components[0]?.architectures[0]?.id ?? null; selectedVersionId = data.components[0]?.architectures[0]?.versions[0]?.id ?? null; activeTab = "overview"; persist("Respaldo importado"); hydrateFrames(); } catch { notify("El archivo no es un respaldo válido de Modelario"); } event.target.value = ""; }; reader.readAsText(file); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && modalRoot.innerHTML) closeModal(); });
  render(); hydrateFrames();
  loadCloudData();
})();
