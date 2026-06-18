# Changelog

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
- Reverse proxy nginx con soporte SSE
- Instalador automático `setup/install.sh` con detección de proxy corporativo
- PyMuPDF instalado vía apt para compatibilidad con proxy SSL corporativo

**Interfaz**
- Estética inspirada en Allbirds (fondo crema, tipografía limpia, botones pill)
- Logo EITB e icono de impresora
- Sidebar con lista de trabajos y acciones rápidas por hover
- Notificaciones toast
- Version badge v1.0.0
