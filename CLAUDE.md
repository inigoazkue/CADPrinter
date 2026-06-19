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
| `backend/pdf_utils.py` | PyMuPDF: preview PNG, overlay combinado, detección formato A3/A4, exportación |
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
jobs (id, name, format A3/A4, is_current, source_user, created_at)
  └── sheets (id, job_id, name, order_num)
        └── prints (id, sheet_id, job_id, filename, original_name,
                    preview_path, format, enabled, order_num, source_user, received_at)

user_active_jobs (source_user PK, job_id FK → jobs)
```

- `source_user`: nombre de usuario limpio extraído del dominio Windows (`EITB\azkue_inigo` → `azkue_inigo`). NULL para trabajos sin usuario.
- `user_active_jobs`: tabla que mapea cada usuario a su trabajo activo. Independiente de `is_current`.
- `GET /api/jobs` devuelve `{"jobs": [...], "userActiveJobs": {user: job_id}}`.

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

- Si cambias el schema de `prints` o `jobs`, añade la columna también en la migración dentro de `init_db()` en `database.py` (patrón `PRAGMA table_info` + `ALTER TABLE`).
- El endpoint `/api/jobs/{id}/export` genera el PDF en `/tmp/` y lo sirve con `FileResponse`. No se cachea en disco.
- Los toasts del frontend desaparecen solos a los 3 segundos; no bloquean la UI.
- `renderSheet()` en `app.js` recibe `fmt` (formato del trabajo) y lo pasa a `renderPrint()` para mostrar el badge de aviso si el PDF tiene formato diferente.
- El layout de cada hoja es dos columnas: capas (grid flex-wrap) a la izquierda, preview combinada a la derecha.
- Los tres botones de cada job card en el sidebar (imprimir, renombrar, borrar) aparecen al hacer hover via CSS `opacity: 0` → `1`.
- El watcher tiene `on_created` (para ficheros en ANONYMOUS, espera 2s por si PostProcessing los mueve) y `on_moved` (para ficheros movidos a carpetas de usuario).
