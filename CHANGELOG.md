# Changelog

## v2.6.5 — 2026-06-26

Transparencia del blanco en el editor, contorno al borde real, nombres de trabajo y formato según el corte.

### Editor

- **Blanco = transparente**: la aurrebista de alta resolución del editor trata todo el blanco como transparente (keying con numpy, umbral RGB≥245, con _fallback_ si no hay numpy), de modo que el **fantasma de las demás capas se ve a través** de las zonas blancas de la capa que estás colocando. `#split-zoom` lleva fondo blanco (papel).
- **Contorno = borde real del papel**: la línea discontinua del modo posición ya no queda metida hacia dentro de una línea continua. Se quitó el borde sólido de `.folio-box` y el contorno se dibuja con `outline` + `outline-offset:-1.5px`, **exactamente en el borde del folio**, para que los datos que caigan sobre la línea (zona útil) sí se impriman.

### Trabajos y formato

- **Nombres automáticos en euskera**: los trabajos creados automáticamente (al llegar un PDF sin trabajo activo) se nombran **"1. lana", "2. lana"…** en lugar de "Lana 1".
- **Formato según el tile más grande**: tras un corte (split), el formato del trabajo pasa al del **tile más grande** producido en ese trabajo (menor número A; se conserva el mayor entre varios cortes). El original queda en "Iturriak" y deja de imponer su formato. Añadir páginas no cambia el formato; **solo los cortes lo hacen automáticamente**.

### Requisitos

- Añadido **numpy** a `requirements.txt` (necesario para el keying del blanco; con _fallback_ a fondo transparente si falta).

---

## v2.6.4 — 2026-06-26

Rotación de salida manual, numeración de hojas y contornos en el editor.

### Rotación

- **La aurrebista no se auto-orienta**: la orientación de la salida es 100% manual. La aurrebista tiene su propio botón **↻** (por hoja, `sheets.rotation`) que rota la página final como unidad y se aplica también al export. Rotar una capa solo gira el contenido de esa capa (y su miniatura), nunca la aurrebista.

### Hojas y conteos

- **Numeración secuencial de hojas**: las hojas se nombran **"1. orria", "2. orria"…** (euskera), numerando solo las hojas sin nombre. Corrige el salto de número que provocaba la hoja de referencia "Iturriak".
- **Conteos del sidebar en euskera**: singular con el número detrás (`orri 1`, `geruza 1`), plural delante (`2 orri`, `3 geruza`). Los conteos **excluyen la hoja "Iturriak"** (no es una hoja de salida real).

### Editor

- **Contorno de página**: en el modo posición, el recuadro de la hoja se dibuja en **línea discontinua por encima** de la imagen, para ver si el contenido se sale de la hoja al arrastrar.

---

## v2.6.3 — 2026-06-26

Zoom y desplazamiento (pan) en el editor para colocar los cortes con precisión.

### Nuevas funcionalidades

- **Zoom en el editor**: botones **−**, **▢** (vista inicial) y **+**, y zoom con la **rueda del ratón** (hacia el punto del cursor, 1× a 8×). Permite afinar el punto exacto del corte.
- **Navegación (pan)**: con zoom aplicado, se arrastra con el ratón (click + arrastrar) para desplazarse por el plano.
- La imagen y las líneas de corte escalan juntas; el arrastre de las líneas y el de la capa (modo posición) siguen siendo precisos a cualquier nivel de zoom.

---

## v2.6.2 — 2026-06-25

Correcciones del editor y de las miniaturas: marco DIN fiable, giro reflejado y tamaño coherente.

### Correcciones

- **Marco de edición DIN fiable**: el recuadro del modo posición usa ahora `aspect-ratio` CSS, así que adopta de forma fiable las proporciones de la hoja (A3, A4…) en lugar de verse cuadrado.
- **CSS siempre fresco**: `style.css` se carga con token dinámico (como `app.js`), para que un CSS rancio en caché no vuelva a romper el diseño tras un deploy. (Era la causa de que el marco se viera cuadrado.)
- **Giro reflejado en la miniatura**: al girar una capa, su miniatura se regenera (token anti-caché en `?placed=1`) y muestra la nueva orientación al instante, igual que la aurrebista.
- **El recuadro de la miniatura se reforma al girar**: ya no tiene proporción vertical fija; toma la proporción real del folio orientado, de modo que la tarjeta (caja, caption y botones) pasa de vertical a apaisada al girar.
- **Tamaño coherente horizontal/vertical**: la miniatura mantiene el **lado largo constante**, así una capa apaisada se ve igual de grande que una vertical (antes la apaisada salía más pequeña).

---

## v2.6.1 — 2026-06-25

Ayuda en euskera, recordatorio de impresión 1:1 y marco de edición con proporciones DIN.

### Nuevas funcionalidades

- **Recordatorio al imprimir**: al pulsar «Inprimatu» aparece un aviso (en euskera) recordando imprimir a **«Tamaño real / 100%»** y márgenes a cero, con casilla **«Ez berriro erakutsi»** que se recuerda (localStorage).
- **Botón de ayuda (?)**: arriba a la derecha; abre una ventana con la explicación estructurada en euskera de cómo funciona la app (lanak, geruzak, editar, aurrebista) e incluye el tema de la impresión 1:1.
- **Marco de edición con proporciones DIN**: en el modo posición del editor, el recuadro del preview toma las proporciones de la hoja (A3, A4… según orientación) y la capa se escala relativa al folio, para ver de un vistazo si el contenido cabe dentro al arrastrarlo.

---

## v2.6.0 — 2026-06-25

Editor unificado de capas, split a escala 1:1 real y correcciones de caché/escala.

### Editor unificado de capa

- Al hacer clic en la miniatura de cualquier capa se abre un editor con dos modos automáticos:
  - **Posición** (defecto en A3/A4 y en piezas ya creadas): arrastrar la imagen para recolocar la capa sobre la hoja.
  - **Split** (defecto en A0/A1/A2): líneas de corte arrastrables para dividir.
- Botón **↻ Biratu** en el editor (0/90/180/270°) y también un botón **↻** directo en cada miniatura para rotar 90° de un clic.
- El preview del modal escala para caber y los controles son siempre accesibles (scroll de seguridad).

### Split: piezas a escala 1:1

- Las piezas de un split se colocan a su **tamaño real (1:1)**, centradas, en una página orientada a la pieza — ya **no se estiran** para llenar el A3 (eso deformaba y cambiaba la escala).
- Las piezas van como capas normales sobre la misma hoja, transparentes, y se **superponen/componen** arrastrándolas (no se ponen lado a lado). El original pasa a una hoja "Iturriak" de solo consulta (colapsada al fondo).
- La miniatura de cada capa muestra la capa **colocada en su folio** (rotada + en su posición).

### Escala y orientación

- La aurrebista y la exportación colocan cada capa a **tamaño nativo** (sin estirar) y el folio toma la **orientación del contenido** (al rotar, gira el folio entero manteniendo la escala).

### Caché de estáticos

- El frontend se sirve con `Cache-Control: no-cache` y `index.html` carga `app.js` con un token por carga, para que el navegador/proxy no sirvan versiones rancias tras un deploy.

### Documentación

- **README**: nueva sección sobre imprimir a **escala real (1:1)** — hay que poner el diálogo de impresión en "Tamaño real / 100%" (no "Ajustar a la página"), que era lo que encogía la impresión al ~94%.

---

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
