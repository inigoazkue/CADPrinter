# CAD Printer

Servidor de impresión virtual para AutoCAD. Recibe PDFs desde una impresora virtual CUPS en Ubuntu, los identifica por usuario de dominio Windows, los agrupa en trabajos con múltiples hojas y capas, genera vistas previas combinadas y exporta el resultado final como PDF listo para imprimir.

---

## Arquitectura

```
Windows (AutoCAD) — usuario EITB\azkue_inigo
    │  imprime a "CADPrinter" via IPP (puerto 631)
    ▼
Ubuntu Server — CUPS + cups-pdf
    │  genera PDF en /var/spool/cups-pdf/ANONYMOUS/
    │  ejecuta PostProcessing: cad-pdf-route.sh
    │    lee usuario de dominio del log de cups-pdf
    │    mueve PDF a /var/spool/cups-pdf/azkue_inigo/
    ▼
watcher.py (systemd) — vigila /var/spool/cups-pdf/ recursivamente
    │  on_created: ficheros que quedan en ANONYMOUS → trabajo global
    │  on_moved:   ficheros movidos a carpeta de usuario → trabajo del usuario
    │  copia PDF a data/prints/, llama API, borra spool
    ▼
FastAPI (backend/main.py, systemd) — puerto 8080
    │  enruta por source_user: cada usuario tiene su trabajo activo
    │  gestiona jobs/sheets/prints en SQLite
    │  genera previews PNG con PyMuPDF
    ▼
Navegador web (frontend vanilla JS)
    │  sidebar agrupado por usuario de dominio
    ←→ SSE (Server-Sent Events) para actualizaciones en tiempo real
```

### Componentes

| Componente | Tecnología | Función |
|---|---|---|
| Backend API | FastAPI + uvicorn | REST API + SSE + ficheros estáticos |
| Base de datos | SQLite (sqlite3) | Jobs, hojas, capas, usuario activo por usuario |
| PDF | PyMuPDF (pymupdf) | Previews PNG, overlay, exportación |
| Impresora virtual | CUPS + cups-pdf | Recibe impresiones desde Windows vía IPP |
| PostProcessing | cad-pdf-route.sh | Enruta PDFs a carpeta por usuario de dominio |
| Monitor spool | watchdog | Detecta PDFs nuevos, los procesa por usuario |
| Frontend | Vanilla JS + HTML/CSS | Sin frameworks, drag & drop nativo |

### Modelo de datos

```
jobs
  ├── id, name, format (A3/A4), is_current, source_user, created_at
  └── sheets (1..N)
        ├── id, job_id, name, order_num
        └── prints (0..N)
              ├── id, sheet_id, job_id, source_user
              ├── filename, original_name, preview_path
              ├── format (A3/A4 detectado)
              ├── enabled (1/0)
              └── received_at

user_active_jobs
  └── source_user (PK), job_id (FK → jobs)
```

El campo `source_user` contiene el nombre de usuario limpio extraído del dominio Windows (`EITB\azkue_inigo` → `azkue_inigo`). Cada usuario tiene su propio trabajo activo independiente en `user_active_jobs`.

---

## Funcionalidad multi-usuario (v2.0.0)

Varios usuarios de Windows pueden imprimir simultáneamente a la misma impresora `CADPrinter`. Las impresiones se enrutan automáticamente al trabajo activo de cada usuario, sin contraseñas ni configuración adicional por usuario.

### Cómo funciona la detección de usuario

1. Windows envía la impresión a `CADPrinter` con el nombre de usuario de dominio (`EITB\azkue_inigo`) como atributo IPP.
2. cups-pdf no puede resolver el usuario de dominio contra `/etc/passwd`, lo registra en su log y crea el PDF en `ANONYMOUS/`.
3. El script PostProcessing (`cad-pdf-route.sh`) lee el log de cups-pdf donde el nombre de usuario con backslash está preservado (`eitb\azkue_inigo`), extrae la parte después del `\` (`azkue_inigo`) y mueve el PDF a `/var/spool/cups-pdf/azkue_inigo/`.
4. El watcher detecta el movimiento vía `on_moved` y notifica al backend con `source_user = "azkue_inigo"`.
5. El backend busca el trabajo activo de ese usuario en `user_active_jobs`. Si no existe, crea uno automáticamente.
6. El sidebar de la web muestra los trabajos agrupados por nombre de usuario.

> **Nota técnica**: el argumento `$3` que cups-pdf pasa al script PostProcessing sufre parsing de shell que elimina el backslash (`eitb\azkue_inigo` → `eitbazkue_inigo`). Por eso el script lee el nombre de usuario directamente del fichero de log de cups-pdf, donde el backslash está preservado.

---

## Requisitos

- Ubuntu 24.04 o superior
- Python 3.12+
- CUPS
- cups-pdf o printer-driver-cups-pdf
- ghostscript
- python3-pymupdf (vía apt)
- apparmor-utils (`sudo apt install apparmor-utils`)
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

### 3. Configuración post-instalación (multi-usuario)

Estos pasos deben realizarse manualmente una sola vez tras la instalación:

#### 3a. Permisos del spool de CUPS

cups-pdf crea el PDF como usuario `nobody`. Para que pueda crear subdirectorios por usuario:

```bash
sudo chmod 1777 /var/spool/cups-pdf/
```

#### 3b. Script de enrutamiento PostProcessing

```bash
sudo cp setup/cups-pdf-route.sh /usr/local/bin/cad-pdf-route.sh
sudo chmod +x /usr/local/bin/cad-pdf-route.sh
```

Añadir al final de `/etc/cups/cups-pdf.conf`:

```
PostProcessing /usr/local/bin/cad-pdf-route.sh
```

#### 3c. Permisos del log de cups-pdf

El script PostProcessing necesita leer el log de cups-pdf (que corre como `nobody`) para extraer el nombre de usuario de dominio:

```bash
sudo chmod o+r /var/log/cups/cups-pdf-CADPrinter_log
```

Para que sea persistente tras rotación de logs:

```bash
sudo tee /etc/logrotate.d/cups-pdf-cad << 'EOF'
/var/log/cups/cups-pdf*_log {
    rotate 4
    monthly
    compress
    missingok
    notifempty
    create 644 root adm
}
EOF
```

#### 3d. AppArmor — permitir ejecución del script PostProcessing

El perfil AppArmor de cups-pdf bloquea por defecto la ejecución de scripts externos. Poner cups-pdf en modo permisivo (solo registra, no bloquea):

```bash
sudo apt install apparmor-utils -y
sudo aa-complain /usr/lib/cups/backend/cups-pdf
```

#### 3e. Reiniciar servicios

```bash
sudo systemctl restart cups cad-printer cad-watcher
```

### 4. Añadir la impresora en Windows

Todos los usuarios comparten la misma impresora. En cada PC Windows:

1. Panel de control → Dispositivos e impresoras → Agregar impresora
2. "La impresora que quiero no está en la lista"
3. "Seleccionar una impresora compartida por nombre"
4. URL: `http://<IP-del-servidor>:631/printers/CADPrinter`
5. Instalar driver genérico si se solicita

Las impresiones de cada usuario se enrutan automáticamente a su trabajo activo en la aplicación web.

---

## Acceso a la aplicación

```
http://<IP-del-servidor>:8080
```

---

## Estructura del proyecto

```
CADPrinter/
├── backend/
│   ├── __init__.py
│   ├── main.py          # FastAPI app: rutas REST, SSE, ficheros estáticos
│   ├── database.py      # SQLite: schema, init, helpers, user_active_jobs
│   ├── pdf_utils.py     # PyMuPDF: previews, overlay, exportación, detección formato
│   └── watcher.py       # watchdog: monitoriza spool CUPS, enruta por usuario
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   ├── js/app.js
│   └── img/
├── setup/
│   ├── install.sh
│   ├── cups-setup.sh
│   ├── cups-pdf-route.sh   # PostProcessing: enruta PDFs por usuario de dominio
│   ├── cad-printer.service
│   └── cad-watcher.service
├── data/                # generado en tiempo de ejecución (no en git)
│   ├── prints/          # PDFs recibidos
│   ├── previews/        # miniaturas PNG
│   └── cad_printer.db   # base de datos SQLite
├── requirements.txt
├── CHANGELOG.md
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
| GET | `/api/jobs` | Listar trabajos + mapa user→job activo |
| POST | `/api/jobs` | Crear trabajo |
| GET | `/api/jobs/{id}` | Trabajo completo (con hojas y capas) |
| PATCH | `/api/jobs/{id}` | Renombrar, cambiar formato |
| DELETE | `/api/jobs/{id}` | Borrar trabajo y sus PDFs |
| POST | `/api/jobs/{id}/activate` | Marcar como trabajo activo global |
| POST | `/api/users/{user}/jobs/{id}/activate` | Marcar como trabajo activo de un usuario |
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
