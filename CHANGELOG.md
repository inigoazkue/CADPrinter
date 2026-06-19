# Changelog

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
