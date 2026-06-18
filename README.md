# CAD Printer

Servidor de impresión virtual para AutoCAD. Recibe PDFs desde una impresora virtual CUPS en Ubuntu, los agrupa en trabajos con múltiples hojas y capas, genera vistas previas combinadas y exporta el resultado final como PDF listo para imprimir.

---

## Arquitectura

```
Windows (AutoCAD)
    │  imprime a "CADPrinter" via IPP
    ▼
Ubuntu Server — CUPS + cups-pdf
    │  genera PDF en /var/spool/cups-pdf/ANONYMOUS/
    ▼
watcher.py (systemd)
    │  detecta el fichero, lo copia a data/prints/, llama API
    ▼
FastAPI (backend/main.py, systemd)  →  puerto 8080
    │  gestiona jobs/sheets/prints en SQLite
    │  genera previews PNG con PyMuPDF
    ▼
Navegador web (frontend vanilla JS)
    ←→ SSE (Server-Sent Events) para actualizaciones en tiempo real
```

### Componentes

| Componente | Tecnología | Función |
|---|---|---|
| Backend API | FastAPI + uvicorn | REST API + SSE + ficheros estáticos |
| Base de datos | SQLite (sqlite3) | Jobs, hojas, capas |
| PDF | PyMuPDF (pymupdf) | Previews PNG, overlay, exportación |
| Impresora virtual | CUPS + cups-pdf | Recibe impresiones desde Windows vía IPP |
| Monitor spool | watchdog | Detecta PDFs nuevos en el spool de CUPS |
| Frontend | Vanilla JS + HTML/CSS | Sin frameworks, drag & drop nativo |

### Modelo de datos

```
jobs
  ├── id, name, format (A3/A4), is_current, created_at
  └── sheets (1..N)
        ├── id, job_id, name, order_num
        └── prints (0..N)
              ├── id, sheet_id, job_id
              ├── filename, original_name, preview_path
              ├── format (A3/A4 detectado)
              ├── enabled (1/0)
              └── received_at
```

El campo `is_current` en `jobs` indica el trabajo activo — las impresiones entrantes del spool van automáticamente a su primera hoja.

---

## Requisitos

- Ubuntu 24.04 o superior
- Python 3.12+
- CUPS
- cups-pdf o printer-driver-cups-pdf
- ghostscript
- python3-pymupdf (vía apt)
- Red local (los clientes Windows acceden por IPP a puerto 631)

---

## Instalación

### 1. Clonar el repositorio

```bash
git clone https://github.com/inigoazkue/CADPrinter.git /srv/SW/CADPrinter
cd /srv/SW/CADPrinter
```

### 2. Ejecutar el instalador

```bash
sudo bash setup/install.sh
```

Si el servidor está detrás de un proxy corporativo:

```bash
sudo http_proxy="http://proxy.empresa.lan:80" \
     https_proxy="http://proxy.empresa.lan:80" \
     bash setup/install.sh
```

El instalador realiza automáticamente:
- Instalación de paquetes del sistema (Python, CUPS, ghostscript, PyMuPDF)
- Configuración de CUPS para escuchar en red local
- Creación de la impresora virtual `CADPrinter` en CUPS
- Creación del entorno virtual Python (`venv/`) con `--system-site-packages`
- Instalación de dependencias pip (fastapi, uvicorn, watchdog, etc.)
- Creación de directorios de datos (`data/prints/`, `data/previews/`)
- Registro e inicio de servicios systemd (`cad-printer`, `cad-watcher`)

### 3. Añadir la impresora en Windows

Ver [MANUAL.md](MANUAL.md) — sección "Configurar impresora en Windows".

---

## Acceso a la aplicación

Una vez instalado, la interfaz web es accesible en:

```
http://<IP-del-servidor>:8080
```

Ejemplo: `http://192.168.1.50:8080`

---

## Estructura del proyecto

```
CADPrinter/
├── backend/
│   ├── __init__.py
│   ├── main.py          # FastAPI app: rutas REST, SSE, ficheros estáticos
│   ├── database.py      # SQLite: schema, init, helpers
│   ├── pdf_utils.py     # PyMuPDF: previews, overlay, exportación, detección formato
│   └── watcher.py       # watchdog: monitoriza spool CUPS, notifica API
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   ├── js/app.js
│   └── img/
│       ├── Eitb_corp.svg.png
│       └── impresora.png
├── setup/
│   ├── install.sh
│   ├── cups-setup.sh
│   ├── cad-printer.service
│   └── cad-watcher.service
├── data/                # generado en tiempo de ejecución (no en git)
│   ├── prints/          # PDFs recibidos
│   ├── previews/        # miniaturas PNG
│   └── cad_printer.db   # base de datos SQLite
├── requirements.txt
└── README.md
```

---

## Servicios systemd

| Servicio | Descripción |
|---|---|
| `cad-printer` | Servidor FastAPI en puerto 8080 |
| `cad-watcher` | Monitor del spool de CUPS |

```bash
# Ver estado
systemctl status cad-printer cad-watcher

# Ver logs en tiempo real
journalctl -fu cad-printer
journalctl -fu cad-watcher

# Reiniciar tras actualización
sudo systemctl restart cad-printer cad-watcher
```

---

## Actualizar

```bash
cd /srv/SW/CADPrinter
git pull
sudo systemctl restart cad-printer cad-watcher
```

No es necesario reinstalar dependencias salvo que cambie `requirements.txt`.

---

## API REST (resumen)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/jobs` | Listar trabajos |
| POST | `/api/jobs` | Crear trabajo |
| GET | `/api/jobs/{id}` | Trabajo completo (con hojas y capas) |
| PATCH | `/api/jobs/{id}` | Renombrar, cambiar formato |
| DELETE | `/api/jobs/{id}` | Borrar trabajo y sus PDFs |
| POST | `/api/jobs/{id}/activate` | Marcar como trabajo activo |
| GET | `/api/jobs/{id}/export` | Exportar trabajo como PDF multipágina |
| POST | `/api/jobs/{id}/sheets` | Añadir hoja |
| PATCH | `/api/sheets/{id}` | Renombrar hoja |
| DELETE | `/api/sheets/{id}` | Borrar hoja |
| GET | `/api/sheets/{id}/preview` | Vista previa PNG combinada |
| POST | `/api/sheets/{id}/prints` | Subir PDF manualmente |
| PATCH | `/api/prints/{id}` | Habilitar/deshabilitar, mover de hoja |
| DELETE | `/api/prints/{id}` | Borrar capa |
| GET | `/api/events` | SSE: eventos en tiempo real |
| POST | `/api/internal/new-print` | Llamado por watcher (interno) |

---

## Puertos

| Puerto | Servicio | Acceso |
|---|---|---|
| 8080 | uvicorn (UI web + API) | Red local |
| 631 | CUPS (IPP) | Red local (impresoras Windows) |

---

## Proxy SSL corporativo

Si `pip install` falla por certificados SSL del proxy, el instalador lo gestiona automáticamente pasando `--trusted-host` a pip. PyMuPDF se instala vía `apt` (`python3-pymupdf`) para evitar compilación desde fuente.
