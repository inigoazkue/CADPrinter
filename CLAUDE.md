# CAD Printer — contexto para Claude Code

## Qué es este proyecto

Aplicación web para EITB que recibe PDFs desde AutoCAD (vía impresora virtual CUPS en Ubuntu), los agrupa en trabajos con hojas y capas, genera vistas previas y exporta el resultado final. Se ejecuta en un servidor Ubuntu en red local corporativa.

## Stack técnico

- **Backend**: FastAPI + uvicorn, Python 3.12+, SQLite (sqlite3 directo, sin ORM)
- **PDF**: `import pymupdf as fitz` — PyMuPDF ≥1.24 renombró el módulo de `fitz` a `pymupdf`
- **Frontend**: Vanilla JS, HTML/CSS — sin frameworks, sin bundler
- **Impresora virtual**: CUPS + cups-pdf, expuesto por IPP en puerto 631
- **Monitor spool**: watchdog, servicio systemd separado (`cad-watcher`)
- **Reverse proxy**: nginx con `proxy_buffering off` para SSE

## Archivos clave

| Archivo | Rol |
|---|---|
| `backend/main.py` | FastAPI app: todas las rutas REST, SSE, ficheros estáticos |
| `backend/database.py` | Schema SQLite, init con migración, helpers de consulta |
| `backend/pdf_utils.py` | PyMuPDF: preview PNG, overlay combinado, detección formato A3/A4, exportación |
| `backend/watcher.py` | watchdog sobre `/var/spool/cups-pdf/ANONYMOUS/`, notifica API, borra spool tras éxito |
| `frontend/js/app.js` | Estado, API calls, render, drag & drop, SSE |
| `frontend/css/style.css` | Estética Allbirds: fondo crema `#F8F5F1`, charcoal `#212A2F`, botones pill |
| `setup/install.sh` | Instalador completo: apt, venv, pip, CUPS, systemd |

## Convenciones importantes

- Los imports del backend usan `from backend import database as db` y `from backend import pdf_utils` porque uvicorn carga `backend.main:app` con `PYTHONPATH` apuntando a la raíz del proyecto.
- No hay ORM: todas las consultas son SQL directo con `sqlite3.Row` como row_factory.
- El ID de cada print se genera como timestamp en ms (`int(time.time() * 1000) % (2**31)`), no autoincrement.
- SSE: `_sse_queues` es una lista global de `asyncio.Queue`. `broadcast()` empuja a todas. nginx necesita `proxy_buffering off`.
- PyMuPDF se instala vía apt (`python3-pymupdf`) para evitar compilación con proxy SSL corporativo. El venv usa `--system-site-packages`.
- El campo `is_current` en `jobs` determina qué trabajo recibe las impresiones entrantes del spool.
- Al borrar un print se eliminan físicamente el PDF y la preview del disco.
- El watcher borra el PDF del spool de CUPS solo si el servidor responde 201 correctamente.

## Estructura de datos

```
jobs (id, name, format A3/A4, is_current, created_at)
  └── sheets (id, job_id, name, order_num)
        └── prints (id, sheet_id, job_id, filename, original_name,
                    preview_path, format, enabled, order_num, received_at)
```

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

- Si cambias el schema de `prints`, añade la columna también en la migración dentro de `init_db()` en `database.py` (patrón `PRAGMA table_info` + `ALTER TABLE`).
- El endpoint `/api/jobs/{id}/export` genera el PDF en `/tmp/` y lo sirve con `FileResponse`. No se cachea en disco.
- Los toasts del frontend desaparecen solos a los 3 segundos; no bloquean la UI.
- `renderSheet()` en `app.js` recibe `fmt` (formato del trabajo) y lo pasa a `renderPrint()` para mostrar el badge de aviso si el PDF tiene formato diferente.
- El layout de cada hoja es dos columnas: capas (grid flex-wrap) a la izquierda, preview combinada a la derecha.
- Los tres botones de cada job card en el sidebar (imprimir, renombrar, borrar) aparecen al hacer hover via CSS `opacity: 0` → `1`.
