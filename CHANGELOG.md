# Changelog

## v2.5.0 — 2026-06-19

Revisión completa del flujo de split: arquitectura correcta, drag que funciona, rotación real y hoja Iturriak colapsada.

### Correcciones y mejoras

**Arquitectura del split (fix fundamental)**
- Los tiles van todos en la MISMA hoja (la original), no en hojas separadas
- La vista previa combinada muestra los tiles en rejilla (side-by-side), sin solapamiento ni ocultamiento
- El original se mueve a una hoja "Iturriak" (deshabilitada, solo para referencia)
- Cada tile guarda su posición en rejilla (`tile_col`, `tile_row`) en la base de datos
- El export genera una página separada por tile en el formato del tile (A3), no del trabajo

**Rotación real del PDF fuente**
- El botón de rotación está ahora arriba del panel de controles (siempre visible)
- La rotación recarga la preview desde el servidor con el PDF rotado de verdad
- Las líneas de corte se reposicionan correctamente tras rotar

**Drag de líneas de corte arreglado**
- Las líneas ya no se eliminan del DOM durante el arrastre — el elemento sigue capturado
- Solo se actualiza la posición CSS de la línea arrastrada y los overlays de tile
- Resultado: drag suave y fiable sin pérdida de eventos de pointer

**Hoja Iturriak colapsada**
- Se muestra con apariencia atenuada y borde discontinuo al fondo de la lista
- Solo muestra la miniatura del original (sin vista previa combinada)
- No permite añadir ni reorganizar capas (es solo para consulta)

**Eliminación del editor de offsets por capa**
- Eliminados los inputs X/Y mm por tile del modal de split
- Eliminado el botón de mover por mm en las capas del visor de hojas
- El posicionamiento es implícito por la rejilla del split

---

## v2.4.0 — 2026-06-18

Mejoras en el split interactivo: rotación del origen, líneas de corte con área de arrastre ampliada, corrección de tiles invisibles en la preview, y editor de posición X/Y por capa en la vista combinada.

### Nuevas funcionalidades

**Rotación del PDF origen en el modal de split**
- Botón "↻ Klikatu biratzeko" que cicla entre 0°, 90°, 180° y 270°
- La preview rota visualmente en el modal
- El split se aplica al PDF rotado: permite cortar en el otro sentido (horizontal/vertical)

**Editor de posición X/Y por capa**
- Cada capa (print) tiene un panel desplegable con inputs de desplazamiento en mm (X e Y)
- El desplazamiento se aplica en la preview combinada de la hoja en tiempo real (600ms debounce)
- Los offsets se guardan en la base de datos (`offset_x_mm`, `offset_y_mm`) y se aplican también en la exportación final

### Correcciones

**Líneas de corte difíciles de arrastrar**
- El área de clic de los divisores pasa de 3px a 20px (zona transparente)
- Un pseudo-elemento `::before` mantiene la línea visual de 3px
- Ahora se pueden arrastrar con normalidad

**Tile 1 invisible en la preview de hoja**
- Los tiles generados por el split se asignaban todos a la misma hoja; el tile 2 tapaba al tile 1 en el overlay
- Corrección: cada tile se crea en su propia hoja dedicada ("Panel 1", "Panel 2"…)
- El original se mueve a una hoja "Iturriak" (deshabilitado)

### Base de datos

- Columnas `offset_x_mm` y `offset_y_mm` añadidas a la tabla `prints` (con migración automática)

---

## v2.3.0 — 2026-06-19

División interactiva de PDFs grandes en tiles A3 para impresión en rotulación.

### Nuevas funcionalidades

**Botón "Zatitu" en prints de gran formato**
- Aparece automáticamente en prints detectados como A0, A1 o A2
- Número de tiles auto-sugerido por formato: A2→2, A1→4, A0→8
- Modal con vista previa del PDF dividida por líneas de corte arrastrables

**División interactiva con líneas arrastrables**
- Arrastra las líneas negras sobre la preview para mover el punto de corte
- Solapamiento configurable entre tiles (0–30 mm) para margen de corte
- Controles de pan X/Y por tile (en mm) para afinar la posición del contenido en cada A3

**Enrutamiento del original**
- El PDF original se mueve automáticamente a una nueva hoja "Iturriak" (deshabilitado)
- Los tiles nuevos se crean en la hoja original como prints independientes

**Backend**
- Nueva función `split_pdf_tiles()` en pdf_utils usando `show_pdf_page` con clip rect de PyMuPDF
- Endpoint `POST /api/prints/{id}/split` con parámetros: cols, rows, tile_format, overlap_mm, col_positions, row_positions, offsets

---

## v2.2.0 — 2026-06-19

Asignación de usuario al crear un trabajo desde la interfaz web.

### Nuevas funcionalidades

**Selector de usuario en el modal "Lan berria"**
- Al crear un trabajo se puede asignar a cualquier usuario que ya haya imprimido alguna vez
- El desplegable se puebla dinámicamente con los usuarios conocidos (extraídos de los trabajos existentes)
- Si se selecciona un usuario y la casilla "Aktibatu lan aktibo gisa" está marcada, el trabajo se convierte automáticamente en el trabajo activo de ese usuario
- La opción "Ez (lan generikoa)" mantiene el comportamiento anterior (trabajo sin usuario)

---

## v2.1.0 — 2026-06-19

Soporte completo de formatos ISO 216: A0, A1, A2, A5 y A6 añadidos además de los A3 y A4 ya existentes.

### Nuevas funcionalidades

**Formatos de papel A0–A6**
- Detección automática del formato ampliada a A0, A1, A2, A5 y A6
- Los desplegables de creación y cambio de formato incluyen todos los tamaños ISO 216
- El overlay y la exportación PDF usan las dimensiones correctas para cada formato

---

## v2.0.0 — 2026-06-19

Soporte multi-usuario: varios usuarios Windows pueden imprimir simultáneamente a la misma impresora y sus trabajos se enrutan automáticamente de forma independiente.

### Nuevas funcionalidades

**Enrutamiento por usuario de dominio Windows**
- Las impresiones se identifican automáticamente por el usuario de dominio Windows (`EITB\azkue_inigo` → `azkue_inigo`)
- Cada usuario tiene su propio trabajo activo, independiente del de otros usuarios
- No se requieren contraseñas ni configuración por usuario: basta con usar la misma impresora `CADPrinter`
- Si un usuario imprime y no tiene trabajo activo, se crea uno automáticamente

**Sidebar agrupado por usuario**
- Los trabajos se agrupan en el sidebar por nombre de usuario de dominio
- Cabeceras de grupo con indicador visual (`◎ azkue_inigo`)
- Los trabajos sin usuario (subidos manualmente) se agrupan en "Beste lanak"

**Tabla `user_active_jobs`**
- Nueva tabla SQLite que mapea cada usuario a su trabajo activo
- Endpoint `POST /api/users/{user}/jobs/{id}/activate` para cambiar el trabajo activo de un usuario concreto
- `GET /api/jobs` devuelve `{ jobs, userActiveJobs }` con el mapa usuario→job activo

**Campo `source_user` en jobs y prints**
- Todos los trabajos y capas registran el usuario de origen
- Permite filtrado y agrupación en la interfaz

### Infraestructura

**Script PostProcessing (`setup/cups-pdf-route.sh`)**
- cups-pdf llama al script tras generar cada PDF
- Lee el nombre de usuario de dominio del log de cups-pdf (donde el backslash está preservado)
- Extrae el username limpio: `eitb\azkue_inigo` → `azkue_inigo`
- Mueve el PDF de `ANONYMOUS/` a `/var/spool/cups-pdf/azkue_inigo/` con permisos 755
- PDFs sin usuario identificable permanecen en `ANONYMOUS/` y van al trabajo global

**Watcher multi-usuario**
- Vigila `/var/spool/cups-pdf/` recursivamente (antes solo `ANONYMOUS/`)
- Nuevo handler `on_moved`: detecta PDFs movidos por el PostProcessing a carpetas de usuario
- `on_created` para `ANONYMOUS/`: espera 2 segundos antes de procesar, por si el PostProcessing los mueve

**Configuración del servidor requerida (post-instalación)**
- `sudo chmod 1777 /var/spool/cups-pdf/` — permite a `nobody` crear subcarpetas de usuario
- `PostProcessing /usr/local/bin/cad-pdf-route.sh` en `cups-pdf.conf`
- `sudo chmod o+r /var/log/cups/cups-pdf-CADPrinter_log` — permite al script leer el log
- `sudo aa-complain /usr/lib/cups/backend/cups-pdf` — AppArmor en modo permisivo para cups-pdf

### Cambios de interfaz

- Eliminado el modal de gestión de colas CUPS por usuario (ya no es necesario: todos usan la misma impresora `CADPrinter`)
- Eliminado el botón ⚙ del sidebar
- Versión actualizada a v2.0.0

---

## v1.0.0 — 2026-06-18

Primera versión en producción.

### Funcionalidades

**Gestión de trabajos**
- Crear trabajos con nombre y formato (A3 / A4)
- Activar un trabajo como destino de las impresiones entrantes (indicador verde)
- Renombrar trabajos desde el sidebar (icono lapiz) o editando el título en el panel principal
- Borrar trabajos con eliminación física de todos sus PDFs y previews
- Exportar trabajo como PDF multipágina (una página por hoja)
- Abrir PDF exportado directamente en Chrome para imprimir (Ctrl+P)

**Gestión de hojas**
- Múltiples hojas por trabajo
- Renombrar hojas inline
- Borrar hoja (las capas se mueven a la primera hoja)
- Vista previa combinada siempre visible a la derecha de las capas

**Gestión de capas (PDFs)**
- Recepción automática desde impresora virtual (CUPS + cups-pdf)
- Subida manual de PDFs ("PDF bat igo eskuz")
- Habilitar / deshabilitar capas individualmente
- Reordenar y mover capas entre hojas con drag & drop
- Borrar capas individuales
- Badge de aviso naranja si el formato del PDF (A3/A4) no coincide con el trabajo

**Impresora virtual**
- Impresora `CADPrinter` accesible desde Windows vía IPP (`http://servidor:631/printers/CADPrinter`)
- Limpieza automática del spool de CUPS tras recibir cada PDF correctamente

**Infraestructura**
- Backend FastAPI + SQLite, sin ORM
- Actualizaciones en tiempo real via Server-Sent Events (SSE)
- Servicios systemd para backend y watcher
- Instalador automático `setup/install.sh` con detección de proxy corporativo
- PyMuPDF instalado vía apt para compatibilidad con proxy SSL corporativo

**Interfaz**
- Estética inspirada en Allbirds (fondo crema, tipografía limpia, botones pill)
- Logo EITB e icono de impresora
- Sidebar con lista de trabajos y acciones rápidas por hover
- Notificaciones toast
- Version badge v1.0.0
