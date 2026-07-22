MODELARIO — VERSIÓN SINCRONIZADA

1. Abre index.html con Chrome, Edge o Firefox.
2. La página carga el proyecto compartido desde Google Drive al abrirse; no conserva una copia persistente en el navegador.
3. Cada cambio se sincroniza automáticamente con la estructura organizada de Drive tras unos segundos sin actividad.
4. Usa «Exportar datos» periódicamente para crear un respaldo JSON adicional.
5. Usa «Importar» para recuperar un respaldo.

Estructura del inventario:
- La barra lateral contiene componentes (casos de uso).
- Cada componente puede tener varias arquitecturas comparables.
- Cada arquitectura conserva sus versiones (0.001, 0.002, etc.), evaluación por matriz de confusión y resultados.
- La pestaña «Seguimiento» guarda el objetivo, notas acumulables y una bitácora de actividades.
- Los resultados se adjuntan como una carpeta completa de archivos para cada versión; se pueden abrir en Drive para descargarlos sin guardar ZIPs adicionales en el proyecto, o eliminar desde la misma pestaña.

Estructura en Google Drive:
- `modelario-index.json` conserva un índice ligero de los componentes.
- Cada componente tiene su propia carpeta, su archivo `componente.json` y una subcarpeta `resultados`.
- La primera carga con esta versión convierte automáticamente el antiguo `modelario-shared.json`, sin borrar ese archivo de respaldo.

Para GitHub Pages:
- Sube index.html, styles.css, app.js y favicon.svg a la raíz del repositorio.
- En GitHub, activa Pages con fuente «GitHub Actions».
- Este repositorio incluye el flujo `.github/workflows/pages.yml` para publicar automáticamente cada cambio en `main`.
- Esta versión es completamente estática y no necesita compilación. La sincronización automática usa la aplicación web de Google Apps Script configurada para este proyecto.
- El código de esa aplicación está en `apps-script/Code.gs`; actualízalo en Apps Script y vuelve a desplegar la misma implementación antes de publicar cambios.

Importante:
- Los respaldos de la versión anterior se convierten automáticamente a la nueva estructura al cargarse.
- Cada carpeta de resultados se guarda como una carpeta real dentro de Drive; cada archivo admite hasta 50 MB.
- Todos los visitantes consultan y editan el mismo proyecto; el último cambio guardado prevalece si varias personas editan a la vez.
