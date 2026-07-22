(() => {
  "use strict";

  const MAX_RESULT_SIZE = 50_000_000;
  const CLOUD_SYNC_ENDPOINT = "https://script.google.com/macros/s/AKfycbzAsanCfW08iTgfXvEFtU5a38qKz5BaZ-p1Ed3A2x6WYhLnvWjll1cArf1hA1CzrAYeBw/exec";
  const CLOUD_SYNC_DELAY = 1800;
  let data = { components: [] };
  let selectedComponentId = data.components[0]?.id ?? null;
  let selectedArchitectureId = data.components[0]?.architectures[0]?.id ?? null;
  let selectedVersionId = data.components[0]?.architectures[0]?.versions[0]?.id ?? null;
  let activeTab = "tracking";
  let activeEntityMenu = null;
  let activeNoteMenu = null;
  let activeActivityMenu = null;
  let editingActivityId = null;
  let calendarPointerDrag = null;
  let activeCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let activeComparisonMetric = "f1";
  let entityMenuCloseTimer = null;
  let pendingResultFiles = [];
  let pendingNoteFiles = [];
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
    if (Array.isArray(source?.components)) return { components: source.components.map((component) => { const architectures = component.architectures || []; const activities = Array.isArray(component.activities) ? component.activities : (component.trackings || []).flatMap((tracking) => tracking.activities || []); const legacyModelIds = Array.isArray(component.comparisonModelIds) ? component.comparisonModelIds : (component.trackings || []).flatMap((tracking) => tracking.modelIds || []); const savedSelections = Array.isArray(component.comparisonSelections) ? component.comparisonSelections : legacyModelIds.map((architectureId) => ({ architectureId })); const comparisonSelections = savedSelections.map((selection) => { const architecture = architectures.find((item) => item.id === selection.architectureId); return architecture ? { architectureId: architecture.id, versionId: architecture.versions.find((version) => version.id === selection.versionId)?.id || architecture.versions[architecture.versions.length - 1]?.id || "" } : null; }).filter(Boolean); return { ...component, notes: Array.isArray(component.notes) ? component.notes.map((note) => ({ ...note, attachments: Array.isArray(note.attachments) ? note.attachments : [] })) : [], activities: activities.map((activity) => ({ ...activity, architectureId: activity.architectureId || "", startDate: activity.startDate || activity.date || "", endDate: activity.endDate || "" })), comparisonSelections, architectures }; }) };
    if (!Array.isArray(source?.groups)) return { components: [] };
    return { components: source.groups.flatMap((group) => group.components.map((part) => {
      const model = part.model;
      const version = model ? { id: uid("version"), version: model.version || "0.001", source: model.source || "", resolution: model.resolution || "", tileSize: model.tileSize || "", stride: model.stride || "", trainingLevel: model.trainingLevel || "", labels: model.labels || "", trainPeriod: model.trainPeriod || "", geography: model.geography || "", notes: model.notes || "", evaluation: null, results: model.results || [] } : null;
      return { id: part.id || uid("component"), name: part.name || "Componente sin nombre", description: part.description || "", status: part.status || "Exploración", activities: [], architectures: version ? [{ id: model.id || uid("architecture"), name: model.family || "Arquitectura sin definir", versions: [version] }] : [] };
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
      activeTab = "tracking";
      cloudReady = true;
      render();
      showTrackingTop();
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
  function showTrackingTop() { window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" })); }

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
    hydrateFrames();
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
    const activityStart = (item) => item.startDate || item.date || "";
    const activityEnd = (item) => item.endDate || activityStart(item);
    const activities = [...(component.activities || [])].sort((a, b) => activityStart(a).localeCompare(activityStart(b)));
    const year = activeCalendarMonth.getFullYear();
    const month = activeCalendarMonth.getMonth();
    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const calendarDays = Array.from({ length: firstWeekday + daysInMonth }, (_, index) => {
      if (index < firstWeekday) return `<div class="month-day empty" aria-hidden="true"></div>`;
      const day = index - firstWeekday + 1;
      const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const weekday = (firstWeekday + day - 1) % 7;
      const entries = activities.filter((item) => activityStart(item) <= date && activityEnd(item) >= date);
      const segments = entries.filter((item) => activityStart(item) === date || weekday === 0).slice(0, 2).map((item, activityIndex) => { const totalDays = Math.floor((new Date(`${activityEnd(item)}T12:00:00`) - new Date(`${date}T12:00:00`)) / 86_400_000) + 1; const spanDays = Math.min(7 - weekday, totalDays); const isActualStart = activityStart(item) === date; const isActualEnd = activityEnd(item) === shiftDate(date, spanDays - 1); const width = `calc(${spanDays * 100}% + ${spanDays - 1}px - 12px)`; return `<span class="calendar-activity" style="width:${width};top:${30 + activityIndex * 29}px" title="${esc(item.title)}">${isActualStart ? `<i class="activity-resize activity-resize-start" data-resize-activity="${esc(item.id)}" data-resize-edge="start" aria-label="Ajustar inicio"></i>` : ""}${esc(item.title)}${isActualEnd ? `<i class="activity-resize activity-resize-end" data-resize-activity="${esc(item.id)}" data-resize-edge="end" aria-label="Ajustar final"></i>` : ""}</span>`; }).join("");
      return `<div class="month-day ${entries.length ? "has-activity" : ""}" data-calendar-date="${date}"><time>${day}</time>${segments}${entries.length > 2 ? `<small>+${entries.length - 2} más</small>` : ""}</div>`;
    }).join("");
    return `<section><div class="page-section-heading"><div><span>ACTIVIDADES DEL COMPONENTE</span><h2>Calendario</h2><p>Arrastra una barra para moverla o sus extremos para añadir o quitar días.</p></div><button class="primary-button" type="button" data-action="modal" data-modal="activity">＋ Actividad</button></div><section class="calendar-panel"><div class="calendar-toolbar"><button class="quiet-button" type="button" data-action="calendar-month" data-offset="-1" aria-label="Mes anterior">←</button><h3>${esc(new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric" }).format(activeCalendarMonth))}</h3><button class="quiet-button" type="button" data-action="calendar-month" data-offset="1" aria-label="Mes siguiente">→</button></div><div class="month-calendar"><div class="month-weekdays"><span>Lun</span><span>Mar</span><span>Mié</span><span>Jue</span><span>Vie</span><span>Sáb</span><span>Dom</span></div><div class="month-days">${calendarDays}</div></div></section><section class="activity-list-panel"><div class="section-title"><div><span>PRÓXIMAS Y RECIENTES</span><h2>Actividades</h2></div></div>${activities.length ? `<div class="calendar-grid">${activities.map((item) => { const isOpen = activeActivityMenu === item.id; return `<article class="calendar-entry"><div class="activity-head"><time>${esc(formatDate(activityStart(item)))}${item.endDate ? ` — ${esc(formatDate(item.endDate))}` : ""}</time><div class="entity-menu"><button class="more-button" type="button" data-action="toggle-activity-menu" data-id="${esc(item.id)}" aria-label="Opciones de la actividad" aria-expanded="${isOpen}">•••</button>${isOpen ? `<div class="entity-menu-popover"><button type="button" data-action="edit-activity" data-id="${esc(item.id)}">Editar</button><button class="menu-danger" type="button" data-action="delete-activity" data-id="${esc(item.id)}">Eliminar</button></div>` : ""}</div></div><strong>${esc(item.title)}</strong><p>${esc(item.notes || "Sin notas.")}</p></article>`; }).join("")}</div>` : `<div class="mini-empty">Aún no hay actividades registradas.</div>`}</section>${renderModelComparison(component)}<section class="comparison-view notes-view"><div class="page-section-heading"><div><span>NOTAS DEL COMPONENTE</span><h2>Notas</h2><p>Registra decisiones, hallazgos o novedades del trabajo.</p></div><button class="quiet-button" type="button" data-action="modal" data-modal="note">＋ Nota</button></div>${component.notes.length ? `<div class="note-list">${[...component.notes].reverse().map((note) => { const isOpen = activeNoteMenu === note.id; return `<article><div class="note-head"><time>${esc(note.date)}</time><div class="entity-menu"><button class="more-button" type="button" data-action="toggle-note-menu" data-id="${esc(note.id)}" aria-label="Opciones de la nota" aria-expanded="${isOpen}">•••</button>${isOpen ? `<div class="entity-menu-popover"><button class="menu-danger" type="button" data-action="delete-note" data-id="${esc(note.id)}">Eliminar nota</button></div>` : ""}</div></div><p>${esc(note.text)}</p></article>`; }).join("")}</div>` : `<div class="mini-empty">Aún no hay notas.</div>`}</section></section>`;
  }
  function formatDate(value) {
    if (!value) return "Sin fecha";
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric" }).format(date);
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
  const comparisonMetrics = [{ id: "precision", name: "Precisión" }, { id: "recall", name: "Recall" }, { id: "f1", name: "F1-score" }, { id: "specificity", name: "Especificidad" }, { id: "accuracy", name: "Accuracy" }, { id: "iou", name: "IoU" }];
  function metricValues(matrix) {
    const values = [matrix?.tp, matrix?.fp, matrix?.fn, matrix?.tn].map((value) => Number(String(value).replace(",", ".")));
    if (values.some((value) => !Number.isFinite(value) || value < 0) || values.reduce((sum, value) => sum + value, 0) === 0) return null;
    const [tp, fp, fn, tn] = values;
    const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;
    return { precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn), f1: ratio(2 * tp, 2 * tp + fp + fn), specificity: ratio(tn, tn + fp), accuracy: ratio(tp + tn, tp + fp + fn + tn), iou: ratio(tp, tp + fp + fn) };
  }
  function formatPercent(value) { return value === null || value === undefined ? "—" : new Intl.NumberFormat("es-CO", { style: "percent", maximumFractionDigits: 1 }).format(value); }
  function renderModelComparison(component) {
    const metric = comparisonMetrics.find((item) => item.id === activeComparisonMetric) || comparisonMetrics[2];
    const models = component.comparisonSelections.map((selection) => {
      const architecture = component.architectures.find((item) => item.id === selection.architectureId);
      const version = architecture?.versions.find((item) => item.id === selection.versionId) || architecture?.versions[architecture.versions.length - 1];
      return architecture ? { architecture, version, values: version ? metricValues(version.evaluation) : null } : null;
    }).filter(Boolean).sort((a, b) => (b.values?.[metric.id] ?? -1) - (a.values?.[metric.id] ?? -1));
    const best = models.find((item) => item.values?.[metric.id] !== null && item.values?.[metric.id] !== undefined);
    return `<section class="comparison-view"><div class="page-section-heading"><div><span>MODELOS SELECCIONADOS</span><h2>Comparación</h2><p>Compara la última versión de los modelos que selecciones.</p></div><button class="quiet-button" type="button" data-action="modal" data-modal="comparison-models">Seleccionar modelos</button></div><div class="comparison-controls"><label><span>MÉTRICA</span><select data-select="comparison-metric">${comparisonMetrics.map((item) => `<option value="${item.id}" ${item.id === metric.id ? "selected" : ""}>${item.name}</option>`).join("")}</select></label>${best ? `<div class="comparison-best"><span>MEJOR RESULTADO</span><strong>${esc(best.architecture.name)} <i>v${esc(best.version.version)}</i></strong><b>${esc(formatPercent(best.values[metric.id]))}</b></div>` : ""}</div>${models.length ? `<div class="comparison-list">${models.map((item, index) => { const value = item.values?.[metric.id]; return `<article class="comparison-model ${value === null || value === undefined ? "is-empty" : ""}"><div class="comparison-rank">${value === null || value === undefined ? "—" : index + 1}</div><div class="comparison-name"><strong>${esc(item.architecture.name)}</strong><span>${item.version ? `Última versión ${esc(item.version.version)} · ${esc(item.version.evaluation?.split || "Sin evaluación")}` : "Sin versiones"}</span></div><div class="comparison-bar"><i style="width:${Math.max(0, (value || 0) * 100)}%"></i></div><strong class="comparison-value">${esc(formatPercent(value))}</strong></article>`; }).join("")}</div>` : `<div class="mini-empty">Selecciona los modelos que quieres comparar.</div>`}</section>`;
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
  function renderNoteAttachments(note) {
    const attachments = note.attachments || [];
    if (!attachments.length) return "";
    return `<div class="note-attachments" aria-label="Adjuntos de la nota">${attachments.map((attachment) => `<div class="note-attachment"><button type="button" data-action="open-note-file" data-note-id="${esc(note.id)}" data-id="${esc(attachment.id)}" title="Abrir ${esc(attachment.name)}"><span>Adjunto</span>${esc(attachment.name)}${attachment.size ? `<small>${esc(formatFileSize(attachment.size))}</small>` : ""}</button><button class="note-attachment-remove" type="button" data-action="delete-note-file" data-note-id="${esc(note.id)}" data-id="${esc(attachment.id)}" aria-label="Eliminar ${esc(attachment.name)}">×</button></div>`).join("")}</div>`;
  }
  function hydrateFrames() {
    const { component } = current();
    if (!component) return;
    document.querySelectorAll(".note-list article").forEach((article) => {
      if (article.querySelector(".note-attachments")) return;
      const noteId = article.querySelector('[data-action="toggle-note-menu"]')?.dataset.id;
      const note = component.notes?.find((item) => item.id === noteId);
      if (note?.attachments?.length) article.insertAdjacentHTML("beforeend", renderNoteAttachments(note));
    });
  }

  function openModal(kind) {
    const { component, architecture, version } = current();
    const activity = component?.activities?.find((item) => item.id === editingActivityId);
    const title = { component: "Nuevo componente", "rename-component": "Renombrar componente", architecture: "Nueva arquitectura", version: "Editar versión", "new-version": "Nueva versión", note: "Nueva nota", activity: "Nueva actividad", "edit-activity": "Editar actividad", "comparison-models": "Modelos a comparar", result: "Añadir carpeta de resultados" }[kind];
    let fields = "";
    if (kind === "component") fields = field("Nombre del componente", "name", "Ej. Detección de suelo desnudo", "", true) + field("Descripción", "description", "Qué representa este componente", "", false, true);
    if (kind === "rename-component") fields = field("Nombre del componente", "name", "", component?.name, true);
    if (kind === "architecture") fields = field("Arquitectura", "name", "Ej. U-Net, Mask R-CNN", "", true);
    if (kind === "note") { pendingNoteFiles = []; fields = `${field("Nota", "text", "Registra una novedad, decisión o hallazgo", "", true, true)}<label class="field attachment-picker"><span>Adjuntos (opcional)</span><input id="note-files" type="file" multiple><small>Puedes seleccionar varios archivos de hasta 50 MB cada uno.</small></label><p id="note-file-status" class="upload-status">Sin archivos adjuntos.</p>`; }
    if (kind === "activity" || kind === "edit-activity") { const value = kind === "edit-activity" ? activity : null; fields = `<div class="form-grid">${field("Fecha de inicio", "startDate", "", value?.startDate || value?.date || new Date().toISOString().slice(0, 10), true, false, false, "date")}${field("Fecha final (opcional)", "endDate", "", value?.endDate || "", false, false, false, "date")}</div>${field("Actividad", "title", "Ej. Revisar datos de entrenamiento", value?.title, true)}${field("Notas", "notes", "Detalle adicional", value?.notes, false, true)}`; }
    if (kind === "comparison-models") fields = component?.architectures.length ? `<p class="form-help">La última versión está seleccionada por defecto; puedes cambiarla para cada modelo.</p><div class="model-check-list">${component.architectures.map((item) => { const selection = component.comparisonSelections.find((value) => value.architectureId === item.id); const defaultVersionId = selection?.versionId || item.versions[item.versions.length - 1]?.id || ""; return `<label><input type="checkbox" name="modelIds" value="${esc(item.id)}" ${selection ? "checked" : ""}><span><strong>${esc(item.name)}</strong><small>Versión a comparar</small><select name="version-${esc(item.id)}" ${item.versions.length ? "" : "disabled"}>${item.versions.map((version) => `<option value="${esc(version.id)}" ${version.id === defaultVersionId ? "selected" : ""}>v${esc(version.version)}</option>`).join("") || "<option>Sin versiones</option>"}</select></span></label>`; }).join("")}</div>` : `<div class="mini-empty">Crea una arquitectura antes de seleccionar modelos.</div>`;
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
  function closeModal() { editingActivityId = null; modalRoot.innerHTML = ""; }
  async function submitModal(event) {
    event.preventDefault(); const form = event.target; const formData = new FormData(form); const values = Object.fromEntries(formData.entries()); const kind = form.dataset.kind; const { component, architecture, version } = current(); const activity = component?.activities?.find((item) => item.id === editingActivityId);
    if (kind === "component") { const created = { id: uid("component"), name: values.name.trim(), description: values.description.trim(), status: "Exploración", notes: [], activities: [], comparisonSelections: [], architectures: [] }; data.components.push(created); selectedComponentId = created.id; selectedArchitectureId = null; selectedVersionId = null; }
    if (kind === "rename-component" && component) component.name = values.name.trim();
    if (kind === "architecture" && component) { const firstVersion = { id: uid("version"), version: "0.001", source: "", resolution: "", tileSize: "", stride: "", trainingLevel: "Tile", labels: "", trainPeriod: "", geography: "", notes: "", evaluation: null, results: [] }; const created = { id: uid("architecture"), name: values.name.trim(), versions: [firstVersion] }; component.architectures.push(created); selectedArchitectureId = created.id; selectedVersionId = firstVersion.id; }
    if (kind === "note" && component) {
      const note = { id: uid("note"), date: new Date().toLocaleDateString("es-CO"), text: values.text.trim(), attachments: [] };
      component.notes = component.notes || [];
      component.notes.push(note);
      try {
        await attachNoteFiles(component, note);
      } catch (error) {
        component.notes = component.notes.filter((item) => item.id !== note.id);
        notify(error.message || "No se pudieron adjuntar los archivos");
        return;
      }
    }
    if ((kind === "activity" || kind === "edit-activity") && values.endDate && values.endDate < values.startDate) { notify("La fecha final debe ser posterior a la fecha inicial"); return; }
    if (kind === "activity" && component) component.activities.push({ id: uid("activity"), date: values.startDate, startDate: values.startDate, endDate: values.endDate || "", title: values.title.trim(), notes: values.notes.trim() });
    if (kind === "edit-activity" && activity) Object.assign(activity, { date: values.startDate, startDate: values.startDate, endDate: values.endDate || "", title: values.title.trim(), notes: values.notes.trim() });
    if (kind === "comparison-models" && component) component.comparisonSelections = formData.getAll("modelIds").map((architectureId) => ({ architectureId, versionId: String(formData.get(`version-${architectureId}`) || component.architectures.find((item) => item.id === architectureId)?.versions.at(-1)?.id || "") }));
    if (kind === "version" && version) Object.assign(version, versionData(values, version));
    if (kind === "new-version" && architecture) { const created = { id: uid("version"), ...versionData(values), evaluation: null, results: [] }; architecture.versions.push(created); selectedVersionId = created.id; }
    if (kind === "result") return;
    if (kind === "edit-activity") editingActivityId = null;
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
  function noteStorageName(file) { return `${uid("file")}-${String(file.name || "archivo").replace(/[\\/:*?"<>|]/g, "-").slice(0, 80)}`; }
  function updatePendingNoteStatus() { const status = modalRoot.querySelector("#note-file-status"); if (!status) return; const totalSize = pendingNoteFiles.reduce((total, record) => total + record.file.size, 0); status.textContent = pendingNoteFiles.length ? `${pendingNoteFiles.length} archivo${pendingNoteFiles.length === 1 ? "" : "s"} adjunto${pendingNoteFiles.length === 1 ? "" : "s"} · ${formatFileSize(totalSize)}` : "Sin archivos adjuntos."; }
  function addPendingNoteFiles(records) { const seen = new Set(pendingNoteFiles.map((record) => `${record.file.name}:${record.file.size}:${record.file.lastModified}`)); pendingNoteFiles.push(...records.filter((record) => { const key = `${record.file.name}:${record.file.size}:${record.file.lastModified}`; if (seen.has(key)) return false; seen.add(key); return true; })); updatePendingNoteStatus(); }
  async function attachNoteFiles(component, note) {
    if (!pendingNoteFiles.length) return;
    const largeFile = pendingNoteFiles.find((record) => record.file.size > MAX_RESULT_SIZE);
    if (largeFile) throw new Error(`El archivo ${largeFile.file.name} supera 50 MB`);
    const status = modalRoot.querySelector("#note-file-status");
    for (let index = 0; index < pendingNoteFiles.length; index += 1) {
      const record = pendingNoteFiles[index];
      const attachment = { id: uid("attachment"), name: record.file.name, storageName: noteStorageName(record.file), size: record.file.size, mimeType: record.file.type || "application/octet-stream" };
      if (status) status.textContent = `Subiendo adjunto ${index + 1} de ${pendingNoteFiles.length}…`;
      await postCloudAction({ action: "note-file", componentId: component.id, componentName: component.name, noteId: note.id, fileName: attachment.storageName, mimeType: attachment.mimeType, data: await readDataUrl(record.file) });
      note.attachments.push(attachment);
    }
  }
  async function attachResultFolder() {
    const { component, version } = current();
    const status = modalRoot.querySelector("#result-file-status");
    if (!version || !pendingResultFiles.length) return;
    if (status) status.textContent = "Preparando carpeta…";
    try {
      const result = await buildResultFolder(pendingResultFiles);
      for (let index = 0; index < pendingResultFiles.length; index += 1) {
        const record = pendingResultFiles[index];
        if (status) status.textContent = `Subiendo archivo ${index + 1} de ${pendingResultFiles.length}…`;
        await postCloudAction({ action: "result-file", componentId: component.id, componentName: component.name, resultId: result.id, resultName: result.name, path: record.path, mimeType: record.file.type || "application/octet-stream", data: await readDataUrl(record.file) });
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
  function deleteComponent() { const { component } = current(); if (!component || !window.confirm(`¿Eliminar el componente “${component.name}” y todas sus arquitecturas? Esta acción no se puede deshacer.`)) return; data.components = data.components.filter((item) => item.id !== component.id); selectedComponentId = data.components[0]?.id ?? null; selectedArchitectureId = data.components[0]?.architectures[0]?.id ?? null; selectedVersionId = data.components[0]?.architectures[0]?.versions[0]?.id ?? null; activeTab = "tracking"; persist("Componente eliminado"); }
  function deleteArchitecture() { const { component, architecture } = current(); if (!component || !architecture || !window.confirm(`¿Eliminar la arquitectura “${architecture.name}” y todas sus versiones? Esta acción no se puede deshacer.`)) return; component.architectures = component.architectures.filter((item) => item.id !== architecture.id); selectedArchitectureId = component.architectures[0]?.id ?? null; selectedVersionId = component.architectures[0]?.versions[0]?.id ?? null; activeTab = "overview"; persist("Arquitectura eliminada"); }
  function deleteVersion() { const { architecture, version } = current(); if (!architecture || !version || !window.confirm(`¿Eliminar la versión ${version.version}? Esta acción no se puede deshacer.`)) return; architecture.versions = architecture.versions.filter((item) => item.id !== version.id); selectedVersionId = architecture.versions[0]?.id ?? null; activeTab = "spec"; persist("Versión eliminada"); }
  function deleteActivity(activityId) { const { component } = current(); const activity = component?.activities?.find((item) => item.id === activityId); if (!component || !activity || !window.confirm("¿Eliminar esta actividad? Esta acción no se puede deshacer.")) return; component.activities = component.activities.filter((item) => item.id !== activityId); activeActivityMenu = null; persist("Actividad eliminada"); }
  async function deleteNote(noteId) {
    const { component } = current();
    const note = component?.notes?.find((item) => item.id === noteId);
    if (!component || !note || !window.confirm("¿Eliminar esta nota y sus adjuntos? Esta acción no se puede deshacer.")) return;
    try {
      await postCloudAction({ action: "delete-note-attachments", componentId: component.id, noteId: note.id });
      component.notes = component.notes.filter((item) => item.id !== noteId);
      activeNoteMenu = null;
      persist("Nota y adjuntos eliminados");
    } catch {
      notify("No se pudieron eliminar los adjuntos de Drive");
    }
  }
  async function openNoteFile(noteId, attachmentId) {
    const { component } = current();
    const note = component?.notes?.find((item) => item.id === noteId);
    const attachment = note?.attachments?.find((item) => item.id === attachmentId);
    if (!component || !note || !attachment) return;
    const fileWindow = window.open("", "_blank");
    notify("Abriendo adjunto en Drive…");
    try {
      const response = await cloudJsonp("note-file-link", { componentId: component.id, noteId: note.id, fileName: attachment.storageName || attachment.name });
      if (!response?.ok || !response.url) throw new Error(response?.error || "No se pudo abrir el adjunto");
      if (fileWindow) fileWindow.location.assign(response.url); else window.location.assign(response.url);
    } catch (error) {
      fileWindow?.close();
      notify(error.message || "No se pudo abrir el adjunto");
    }
  }
  async function deleteNoteFile(noteId, attachmentId) {
    const { component } = current();
    const note = component?.notes?.find((item) => item.id === noteId);
    const attachment = note?.attachments?.find((item) => item.id === attachmentId);
    if (!component || !note || !attachment || !window.confirm(`¿Eliminar el adjunto “${attachment.name}”?`)) return;
    try {
      await postCloudAction({ action: "delete-note-file", componentId: component.id, noteId: note.id, fileName: attachment.storageName || attachment.name });
      note.attachments = note.attachments.filter((item) => item.id !== attachment.id);
      persist("Adjunto eliminado");
    } catch {
      notify("No se pudo eliminar el adjunto de Drive");
    }
  }
  function shiftDate(value, days) { const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); }
  function resizeActivity(activityId, edge, date) { const { component } = current(); const activity = component?.activities?.find((item) => item.id === activityId); const start = activity?.startDate || activity?.date; const end = activity?.endDate || start; if (!activity || !start || !date) return; if (edge === "start" && date > end) { notify("El inicio no puede ser posterior al final"); return; } if (edge === "end" && date < start) { notify("El final no puede ser anterior al inicio"); return; } if (edge === "start") { activity.startDate = date; activity.date = date; } else activity.endDate = date === start ? "" : date; persist("Duración de la actividad actualizada"); }
  async function deleteResult(resultId) {
    const { component, version } = current();
    const result = version?.results.find((item) => item.id === resultId);
    if (!version || !result || !window.confirm(`¿Eliminar la carpeta “${result.name}” de Drive? Esta acción no se puede deshacer.`)) return;
    try {
      await postCloudAction({ action: "delete-result", componentId: component.id, resultId: result.id });
      version.results = version.results.filter((item) => item.id !== result.id);
      persist("Carpeta eliminada de Drive");
    } catch {
      notify("No se pudo eliminar la carpeta de Drive");
    }
  }
  async function openResultFolder(resultId) {
    const { component, version } = current();
    const result = version?.results.find((item) => item.id === resultId);
    if (!result) return;
    const resultWindow = window.open("", "_blank");
    notify("Abriendo carpeta en Drive…");
    try {
      const response = await cloudJsonp("result-folder-link", { componentId: component.id, resultId: result.id });
      if (!response?.ok || !response.url) throw new Error(response?.error || "No se pudo abrir la carpeta");
      if (resultWindow) resultWindow.location.assign(response.url); else window.location.assign(response.url);
    } catch (error) {
      resultWindow?.close();
      notify(error.message || "No se pudo descargar la carpeta");
    }
  }
  content.addEventListener("submit", (event) => { if (event.target.id !== "matrix-form") return; event.preventDefault(); const { version } = current(); if (!version) return; const values = Object.fromEntries(new FormData(event.target).entries()); version.evaluation = { split: values.split, tp: Number(values.tp), fp: Number(values.fp), fn: Number(values.fn), tn: Number(values.tn) }; persist("Matriz de confusión guardada"); });
  document.addEventListener("click", (event) => { const control = event.target.closest("[data-action]"); if (!control) return; const action = control.dataset.action; if (action === "retry-cloud") loadCloudData(); if (action === "component") { selectedComponentId = control.dataset.id; const item = data.components.find((value) => value.id === selectedComponentId); selectedArchitectureId = item?.architectures[0]?.id ?? null; selectedVersionId = item?.architectures[0]?.versions[0]?.id ?? null; activeTab = "tracking"; render(); hydrateFrames(); } if (action === "calendar-month") { activeCalendarMonth = new Date(activeCalendarMonth.getFullYear(), activeCalendarMonth.getMonth() + Number(control.dataset.offset), 1); render(); } if (action === "architecture") { selectedArchitectureId = control.dataset.id; const architecture = current().component?.architectures.find((item) => item.id === selectedArchitectureId); selectedVersionId = architecture?.versions[0]?.id ?? null; if (!control.dataset.keepTab) activeTab = "overview"; render(); hydrateFrames(); } if (action === "version") { selectedVersionId = control.dataset.id; render(); hydrateFrames(); } if (action === "tab") { activeTab = control.dataset.tab; render(); hydrateFrames(); } if (action === "toggle-menu") { window.clearTimeout(entityMenuCloseTimer); activeEntityMenu = activeEntityMenu === control.dataset.menu ? null : control.dataset.menu; render(); hydrateFrames(); } if (action === "toggle-note-menu") { activeNoteMenu = activeNoteMenu === control.dataset.id ? null : control.dataset.id; render(); } if (action === "toggle-activity-menu") { activeActivityMenu = activeActivityMenu === control.dataset.id ? null : control.dataset.id; render(); } if (action === "edit-activity") { editingActivityId = control.dataset.id; openModal("edit-activity"); } if (action === "modal") openModal(control.dataset.modal); if (action === "close") closeModal(); if (action === "export") exportData(); if (action === "delete-component") deleteComponent(); if (action === "delete-architecture") deleteArchitecture(); if (action === "delete-version") deleteVersion(); if (action === "delete-note") deleteNote(control.dataset.id); if (action === "delete-activity") deleteActivity(control.dataset.id); if (action === "delete-result") deleteResult(control.dataset.id); if (action === "open-result") openResultFolder(control.dataset.id); });
  document.addEventListener("click", (event) => { const control = event.target.closest("[data-action]"); if (control?.dataset.action === "component" || (control?.dataset.action === "tab" && control.dataset.tab === "tracking")) showTrackingTop(); });
  function calendarDayAtPoint(event) { return document.elementsFromPoint(event.clientX, event.clientY).find((item) => item.matches?.("[data-calendar-date]")) || null; }
  function clearCalendarDrag() { document.querySelectorAll(".month-day.drag-over, .calendar-activity.is-resizing").forEach((item) => item.classList.remove("drag-over", "is-resizing")); }
  document.addEventListener("pointerdown", (event) => { if (event.button !== 0) return; const handle = event.target.closest("[data-resize-activity]"); if (!handle) return; event.preventDefault(); calendarPointerDrag = { id: handle.dataset.resizeActivity, edge: handle.dataset.resizeEdge }; handle.closest(".calendar-activity")?.classList.add("is-resizing"); });
  document.addEventListener("pointermove", (event) => { if (!calendarPointerDrag) return; const day = calendarDayAtPoint(event); document.querySelectorAll(".month-day.drag-over").forEach((item) => item.classList.remove("drag-over")); day?.classList.add("drag-over"); });
  document.addEventListener("pointerup", (event) => { if (!calendarPointerDrag) return; const drag = calendarPointerDrag; const day = calendarDayAtPoint(event); calendarPointerDrag = null; clearCalendarDrag(); if (!day) return; resizeActivity(drag.id, drag.edge, day.dataset.calendarDate); });
  document.addEventListener("pointercancel", () => { calendarPointerDrag = null; clearCalendarDrag(); });
  document.addEventListener("change", (event) => { const selector = event.target.closest("[data-select]"); if (!selector) return; if (selector.dataset.select === "architecture") { selectedArchitectureId = selector.value; const architecture = current().component?.architectures.find((item) => item.id === selectedArchitectureId); selectedVersionId = architecture?.versions[0]?.id ?? null; } if (selector.dataset.select === "version") selectedVersionId = selector.value; if (selector.dataset.select === "comparison-metric") activeComparisonMetric = selector.value; render(); hydrateFrames(); });
  tree.addEventListener("mouseout", (event) => { const menu = event.target.closest(".entity-menu"); if (!menu || menu.contains(event.relatedTarget) || !activeEntityMenu) return; window.clearTimeout(entityMenuCloseTimer); entityMenuCloseTimer = window.setTimeout(() => { activeEntityMenu = null; render(); hydrateFrames(); }, 1500); });
  tree.addEventListener("mouseover", (event) => { if (event.target.closest(".entity-menu")) window.clearTimeout(entityMenuCloseTimer); });
  modalRoot.addEventListener("click", (event) => { if (event.target.id === "modal-backdrop") closeModal(); const zone = event.target.closest("#result-dropzone"); if (zone && !event.target.closest("label")) modalRoot.querySelector("#result-folder")?.click(); });
  modalRoot.addEventListener("submit", (event) => { if (event.target.id === "modal-form") submitModal(event); });
  modalRoot.addEventListener("change", async (event) => { if (event.target.name === "trainingLevel") toggleTileFields(); if (event.target.id === "result-folder") { addPendingResultFiles([...event.target.files].map((file) => recordFile(file))); event.target.value = ""; await attachResultFolder(); } });
  modalRoot.addEventListener("keydown", (event) => { if (event.key !== "Enter" && event.key !== " ") return; const zone = event.target.closest("#result-dropzone"); if (!zone) return; event.preventDefault(); modalRoot.querySelector("#result-folder")?.click(); });
  document.getElementById("import-file").addEventListener("change", (event) => { const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { try { data = normalize(JSON.parse(String(reader.result))); selectedComponentId = data.components[0]?.id ?? null; selectedArchitectureId = data.components[0]?.architectures[0]?.id ?? null; selectedVersionId = data.components[0]?.architectures[0]?.versions[0]?.id ?? null; activeTab = "tracking"; persist("Respaldo importado"); hydrateFrames(); } catch { notify("El archivo no es un respaldo válido de Modelario"); } event.target.value = ""; }; reader.readAsText(file); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && modalRoot.innerHTML) closeModal(); });
  modalRoot.addEventListener("change", (event) => {
    if (event.target.id !== "note-files") return;
    addPendingNoteFiles([...event.target.files].map((file) => recordFile(file)));
    event.target.value = "";
  });
  document.addEventListener("click", (event) => {
    const control = event.target.closest("[data-action]");
    if (!control) return;
    if (control.dataset.action === "open-note-file") openNoteFile(control.dataset.noteId, control.dataset.id);
    if (control.dataset.action === "delete-note-file") deleteNoteFile(control.dataset.noteId, control.dataset.id);
  });
  render(); hydrateFrames();
  loadCloudData();
})();
