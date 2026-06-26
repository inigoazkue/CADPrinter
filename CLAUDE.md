# CAD Printer — contexto para Claude Code

## Qué es este proyecto

Aplicación web para EITB que recibe PDFs desde AutoCAD (vía impresora virtual CUPS en Ubuntu), los enruta por usuario de dominio Windows, los agrupa en trabajos con hojas y capas, genera vistas previas y exporta el resultado final. Se ejecuta en un servidor Ubuntu en red local corporativa.

## Stack técnico

- **Backend**: FastAPI + uvicorn, Python 3.12+, SQLite (sqlite3 directo, sin ORM)
- **PDF**: `import pymupdf as fitz` — PyMuPDF ≥1.24 renombró el módulo de `fitz` a `pymupdf`
- **Frontend**: Vanilla JS, HTML/CSS — sin frameworks, sin bundler
- **Impresora virtual**: CUPS + cups-pdf, expuesto por IPP en puerto 631
- **Monitor spool**: watchdog, servicio systemd separado (`cad-watcher`)
- **PostProcessing**: script bash `cad-pdf-route.sh` llamado por cups-pdf tras generar cada PDF

## Archivos clave

| Archivo | Rol |
|---|---|
| `backend/main.py` | FastAPI app: todas las rutas REST, SSE, ficheros estáticos |
| `backend/database.py` | Schema SQLite, init con migración, helpers de consulta |
| `backend/pdf_utils.py` | PyMuPDF: preview PNG, overlay combinado, detección formato A0–A6, exportación |
| `backend/watcher.py` | watchdog sobre `/var/spool/cups-pdf/` (recursivo), on_created + on_moved, notifica API |
| `frontend/js/app.js` | Estado, API calls, render, drag & drop, SSE |
| `frontend/css/style.css` | Estética Allbirds: fondo crema `#F8F5F1`, charcoal `#212A2F`, botones pill |
| `setup/install.sh` | Instalador completo: apt, venv, pip, CUPS, systemd |
| `setup/cups-pdf-route.sh` | PostProcessing hook: lee usuario del log cups-pdf, mueve PDF a carpeta de usuario |

## Convenciones importantes

- Los imports del backend usan `from backend import database as db` y `from backend import pdf_utils` porque uvicorn carga `backend.main:app` con `PYTHONPATH` apuntando a la raíz del proyecto.
- No hay ORM: todas las consultas son SQL directo con `sqlite3.Row` como row_factory.
- El ID de cada print se genera como timestamp en ms (`int(time.time() * 1000) % (2**31)`), no autoincrement.
- SSE: `_sse_queues` es una lista global de `asyncio.Queue`. `broadcast()` empuja a todas.
- PyMuPDF se instala vía apt (`python3-pymupdf`) para evitar compilación con proxy SSL corporativo. El venv usa `--system-site-packages`.
- El campo `is_current` en `jobs` determina el trabajo global activo. Para trabajos de usuario, se usa `user_active_jobs`.
- Al borrar un print se eliminan físicamente el PDF y la preview del disco.
- El watcher borra el PDF del spool de CUPS solo si el servidor responde 201 correctamente.
- AppArmor: cups-pdf está en modo `complain` (`sudo aa-complain /usr/lib/cups/backend/cups-pdf`) para permitir que ejecute el script PostProcessing.
- El log de cups-pdf (`/var/log/cups/cups-pdf-CADPrinter_log`) debe ser legible por `nobody` (`chmod o+r`). El script PostProcessing lee ahí el usuario de dominio con backslash preservado.
- `/var/spool/cups-pdf/` tiene permisos `1777` para que `nobody` pueda crear subcarpetas de usuario.

## Estructura de datos

```
jobs (id, name, format A0–A6, is_current, source_user, created_at)
  └── sheets (id, job_id, name, order_num, rotation)
        └── prints (id, sheet_id, job_id, filename, original_name,
                    preview_path, format, enabled, order_num, source_user, received_at,
                    offset_x_mm, offset_y_mm, tile_col, tile_row)

user_active_jobs (source_user PK, job_id FK → jobs)
```

- `source_user`: nombre de usuario limpio extraído del dominio Windows (`EITB\azkue_inigo` → `azkue_inigo`). NULL para trabajos sin usuario.
- `user_active_jobs`: tabla que mapea cada usuario a su trabajo activo. Independiente de `is_current`.
- `GET /api/jobs` devuelve `{"jobs": [...], "userActiveJobs": {user: job_id}}`.
- **Editor unificado de geruza (capa)**: al hacer clic en la miniatura de cualquier print se abre el modal `#modal-split`, que es un editor con DOS modos según `cols`/`rows`:
  - **Modo posición** (`cols==1 && rows==1`, defecto para A3/A4… y para tiles ya creados): se arrastra la imagen del preview para reposicionar la capa sobre la hoja. La conversión px→mm usa `PAGE_SIZES_MM[refFmt]` (el ancho mostrado ↔ ancho de hoja en mm). Para tiles, `refFmt` es el formato del tile (no el del trabajo), porque la aurrebista de esa hoja se renderiza en formato tile. Al guardar llama a `POST /api/prints/{id}/edit`.
  - **Modo split** (`cols>1 || rows>1`, defecto para A0/A1/A2 vía `autoTiles()`): líneas de corte arrastrables; al guardar llama a `POST /api/prints/{id}/split`.
  - El botón ↻ (rotar) cicla 0/90/180/270° en ambos modos; recarga el preview vía `GET /prints/{id}/preview?rotation=N`. El botón de submit cambia de etiqueta: "Gorde" (posición) / "Zatitu" (split).
  - El preview del modal escala para caber (`max-height: 60vh`) y el contenedor `.split-preview-wrap` usa `width: fit-content` para que las líneas de corte sigan cuadradas con la imagen; `.split-modal-body` y `.split-right` tienen `overflow-y: auto` como red de seguridad para que los controles (biraketa arriba) siempre sean accesibles aunque la pieza sea muy alta.
  - **Zoom y pan**: el preview vive en un contenedor `#split-zoom` (dentro del viewport `.split-preview-wrap`, tamaño fijo `56vh`/`overflow:hidden`) al que se le aplica `transform: translate(pan) scale(zoom)`. Botones `−`/`▢`/`+` (`zoom-out`/`zoom-reset`/`zoom-in`), rueda del ratón (zoom hacia el cursor, `zoomAt`), y **arrastrar** para navegar (`startPan`). Zoom 1..8; al volver a 1 se recentra. La imagen y las líneas de corte van dentro de `#split-zoom`, así escalan juntas; el arrastre de líneas (`makeDraggable`) calcula la fracción con `getBoundingClientRect()` del contenedor (a prueba de zoom/pan).
  - En **modo posición**, `#split-zoom` toma la clase `.folio-box` y se dimensiona con las **proporciones DIN de la hoja** (`fitRect` con el folio orientado al contenido, centrado en el viewport); la imagen de la capa se escala relativa al folio (`layerFmt`/`jobFmt`, serie A → misma proporción) y se arrastra dentro (`startLayerDrag`, dividiendo el delta por el zoom). Así se ve si la capa cabe en la hoja. En **modo split**, `#split-zoom` se ajusta a la imagen fuente (`fitRect` del aspecto natural) y muestra las líneas de corte.
- **Botón de ayuda (?)**: botón flotante `#btn-help` (`.help-fab`) arriba a la derecha abre `#modal-help` con la explicación en euskera del funcionamiento (lanak, geruzak, editatu, aurrebista, inprimatu 1:1).
- **Recordatorio de impresión**: al pulsar Inprimatu (`btn-export-job` o el del sidebar) se pasa por `requestExport()`, que muestra `#modal-print-reminder` (recordando imprimir a «Tamaño real / 100%» y márgenes a cero) con un check «Ez berriro erakutsi» persistido en `localStorage` (`cadprinter_hide_print_reminder`). Si está marcado, exporta directo.
- **Botón ↻ en cada miniatura**: además del editor, cada print tiene un botón ↻ en sus controles (junto a habilitar/borrar) que rota 90° de un clic — llama a `POST /api/prints/{id}/edit` con `rotation=90` (hornea la rotación acumulativa, 4 clics = vuelta al origen) preservando los offsets.
- **Miniatura adaptable**: la `<img>` de la miniatura usa `width:100%; height:auto` (sin `aspect-ratio` fijo) para tomar la proporción real del folio orientado, de modo que la tarjeta se reforma (vertical↔apaisada) al girar. Además, `renderPrint` fija el **lado largo constante** (`THUMB_LONG=170` px) vía JS al cargar la imagen (`thumb.style.width`), para que apaisado y vertical se vean igual de grandes. `.prints-grid` usa `align-items: flex-start`.
- `POST /api/prints/{id}/edit` (modelo `PrintEdit`: `rotation`, `offset_x_mm`, `offset_y_mm`): si `rotation≠0` hornea la rotación en el PDF con `pdf_utils.apply_rotation_to_pdf()` (reescribe el fichero rotado vía `show_pdf_page(rotate=)` a temp + `os.replace`), regenera el preview y re-detecta el formato. Guarda los offsets. Broadcast `job_updated`.
- `split_pdf_tiles` coloca cada trozo a **escala 1:1** (tamaño real en puntos, centrado, página orientada al trozo) — NO estira el recorte para llenar el A3 (eso deformaba y cambiaba la escala). Si el trozo es mayor que el formato tile, se recorta (límite físico: hay que cortar en más piezas o en el otro sentido).
- `POST /api/prints/{id}/split` divide un print grande en piezas. Parámetros: `cols`, `rows`, `tile_format`, `overlap_mm`, `col_positions` (norm. 0..1), `row_positions`, `rotation`. **Las piezas NO se ponen lado a lado: se SUPERPONEN.** Se crean todas en la hoja original como capas normales habilitadas (`tile_col`/`tile_row` se guardan como metadato, `offset_x_mm/y=0` al inicio → empiezan apiladas). El original pasa a una hoja "Iturriak" (disabled). La aurrebista de esa hoja se genera con `pdf_utils.generate_sheet_preview()` en **formato tile** (p.ej. A3), superponiendo las piezas con sus offsets. El usuario arrastra cada pieza (modo posición del editor) para componer un único A3.
- La hoja "Iturriak" se renderiza colapsada (atenuada, borde discontinuo) al fondo: solo muestra la miniatura del original como referencia, sin aurrebista combinada ni botones de edición.
- `GET /api/prints/{id}/preview?rotation=N` sirve un PNG rotado en vivo (sin tocar el fichero) vía `generate_rotated_preview()`. `?placed=1` renderiza la capa **colocada en su folio** (lienzo orientado al contenido, en su offset) reutilizando `generate_sheet_preview([path], fmt, ...)` → la miniatura de cada capa muestra rotación + posición tal como queda en la hoja (la miniatura del job usa `?placed=1&t=Date.now()` —el token evita caché de navegador/proxy para que el giro/movimiento se refleje al instante—; la de "Iturriak" usa el preview crudo). Sin parámetros sirve el preview cacheado con `Cache-Control: no-cache` (revalida por `Last-Modified`). El fichero placed es `previews/placed_{id}.png` y se borra al eliminar el print.
- El export (`/api/jobs/{id}/export`): cada hoja es **una página**, superponiendo todas sus capas habilitadas con sus offsets. Una hoja con piezas de split usa el formato del tile para esa página (`sheet_formats` en `export_job_pdf`); las hojas normales usan el formato del trabajo.
- **Escala (folio)**: tanto la aurrebista (`generate_sheet_preview`) como el export colocan cada capa a su **tamaño nativo** (sin estirar) en su offset vía `_compose_sheet()`.
- **Rotación de hoja (100% manual)**: la aurrebista y el export se componen SIEMPRE con `auto_orient=False`, es decir, el lienzo NO depende de las capas (base vertical del formato). La orientación de la salida la controla EXCLUSIVAMENTE la rotación manual de la hoja: cada `sheet` tiene columna `rotation` (0/90/180/270, con migración) y la aurrebista tiene su botón ↻ (`renderSheet` → `PATCH /api/sheets/{id}` con `rotation`, modelo `SheetUpdate`). `_compose_sheet(rotation=N)` rota la página entera (contenido+papel) como unidad; el export usa `sheet_rotations`. Rotar una capa solo gira su propio contenido (no afecta a la aurrebista). `_oriented_canvas()` (auto-orientación a la capa de mayor área) solo se usa ya en la miniatura por capa (`?placed=1`, `auto_orient=True`), para que la miniatura refleje el giro de esa capa.
- **Caché de estáticos**: el frontend se sirve con `NoCacheStaticFiles` (subclase de `StaticFiles`) que añade `Cache-Control: no-cache` a todo (revalida por ETag/Last-Modified → 304 si no cambia). Además, `index.html` carga **tanto `app.js` como `style.css` con un token dinámico** (`?t=Date.now()` vía `document.write`/`<script>`) para que ni el navegador ni un proxy corporativo puedan servir versiones rancias: una vez que llega este `index.html`, JS y CSS se auto-refrescan siempre.
- `POST /api/jobs` acepta `source_user` (opcional) y `activate` (bool). Si se pasa `source_user`, el trabajo se crea sin activar globalmente y se asigna como activo del usuario si `activate=true`.
- El modal "Lan berria" puebla dinámicamente un desplegable de usuarios con los `source_user` distintos de los trabajos existentes.

## Flujo multi-usuario

1. Windows imprime a `CADPrinter` con usuario de dominio `EITB\azkue_inigo`
2. cups-pdf genera PDF en `ANONYMOUS/`, llama a `cad-pdf-route.sh`
3. Script lee el log de cups-pdf → extrae `azkue_inigo` → mueve PDF a `/var/spool/cups-pdf/azkue_inigo/` con chmod 755
4. Watcher detecta el movimiento vía `on_moved` → llama API con `source_user="azkue_inigo"`
5. Backend busca trabajo activo en `user_active_jobs`. Si no existe, crea uno nuevo.
6. Sidebar agrupa trabajos por `source_user` con cabeceras de grupo.

## Cómo ejecutar en desarrollo (desde Windows)

El backend corre en Ubuntu. Para desarrollo local en Ubuntu:

```bash
cd /srv/SW/CADPrinter
source venv/bin/activate
PYTHONPATH=/srv/SW/CADPrinter uvicorn backend.main:app --reload --port 8080
```

El watcher en otra terminal:
```bash
PYTHONPATH=/srv/SW/CADPrinter python backend/watcher.py
```

## Cosas a tener en cuenta al modificar

- **Mantén este CLAUDE.md actualizado en cada cambio.** Instrucción permanente del usuario (azkue_inigo): cada vez que se modifique comportamiento, endpoints, schema o flujo de la UI, refleja el cambio aquí en el mismo turno.
- Si cambias el schema de `prints` o `jobs`, añade la columna también en la migración dentro de `init_db()` en `database.py` (patrón `PRAGMA table_info` + `ALTER TABLE`).
- El endpoint `/api/jobs/{id}/export` genera el PDF en `/tmp/` y lo sirve con `FileResponse`. No se cachea en disco.
- Los toasts del frontend desaparecen solos a los 3 segundos; no bloquean la UI.
- `renderSheet()` en `app.js` recibe `fmt` (formato del trabajo) y lo pasa a `renderPrint()` para mostrar el badge de aviso si el PDF tiene formato diferente.
- El layout de cada hoja es dos columnas: capas (grid flex-wrap) a la izquierda, preview combinada a la derecha.
- Los tres botones de cada job card en el sidebar (imprimir, renombrar, borrar) aparecen al hacer hover via CSS `opacity: 0` → `1`.
- El watcher tiene `on_created` (para ficheros en ANONYMOUS, espera 2s por si PostProcessing los mueve) y `on_moved` (para ficheros movidos a carpetas de usuario).
