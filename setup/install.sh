#!/usr/bin/env bash
# install.sh — Instala CAD Printer en Ubuntu (sin Docker)
# Ejecutar como root desde la carpeta raíz del proyecto:
#   sudo bash setup/install.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SERVICE_USER="${SUDO_USER:-$USER}"

echo "==> CAD Printer — instalación"
echo "    Proyecto: $PROJECT_DIR"
echo "    Usuario:  $SERVICE_USER"
echo ""

# ── Sistema ──────────────────────────────────────────────────────────────────
echo "[1/6] Instalando paquetes del sistema..."
apt-get update -q
apt-get install -y python3 python3-pip python3-venv cups ghostscript

# cups-pdf se llama diferente según la versión de Ubuntu
if apt-get install -y cups-pdf 2>/dev/null; then
  echo "      cups-pdf instalado"
elif apt-get install -y printer-driver-cups-pdf 2>/dev/null; then
  echo "      printer-driver-cups-pdf instalado"
else
  echo "AVISO: No se encontró cups-pdf. Instálalo manualmente:"
  echo "       apt-cache search cups | grep -i pdf"
fi

# ── Entorno Python ────────────────────────────────────────────────────────────
echo "[2/6] Creando entorno virtual Python..."
python3 -m venv "$PROJECT_DIR/venv"
"$PROJECT_DIR/venv/bin/pip" install --quiet --upgrade pip
"$PROJECT_DIR/venv/bin/pip" install --quiet -r "$PROJECT_DIR/requirements.txt"
echo "      OK"

# ── Directorios de datos ──────────────────────────────────────────────────────
echo "[3/6] Creando directorios de datos..."
mkdir -p "$PROJECT_DIR/data/prints"
mkdir -p "$PROJECT_DIR/data/previews"
chown -R "$SERVICE_USER:$SERVICE_USER" "$PROJECT_DIR/data"

# ── CUPS ──────────────────────────────────────────────────────────────────────
echo "[4/6] Configurando CUPS..."
bash "$SCRIPT_DIR/cups-setup.sh" "$PROJECT_DIR" "$SERVICE_USER"

# ── Servicios systemd ─────────────────────────────────────────────────────────
echo "[5/6] Instalando servicios systemd..."
# Sustituir placeholders en los archivos de servicio
sed "s|__PROJECT_DIR__|$PROJECT_DIR|g; s|__SERVICE_USER__|$SERVICE_USER|g" \
  "$SCRIPT_DIR/cad-printer.service" > /etc/systemd/system/cad-printer.service

sed "s|__PROJECT_DIR__|$PROJECT_DIR|g; s|__SERVICE_USER__|$SERVICE_USER|g" \
  "$SCRIPT_DIR/cad-watcher.service" > /etc/systemd/system/cad-watcher.service

systemctl daemon-reload
systemctl enable cad-printer cad-watcher
systemctl restart cad-printer cad-watcher
echo "      Servicios activos"

# ── Resultado ─────────────────────────────────────────────────────────────────
echo "[6/6] Listo."
IP=$(hostname -I | awk '{print $1}')
echo ""
echo "  ✓ Web UI:      http://$IP:8080"
echo "  ✓ CUPS admin:  http://$IP:631"
echo ""
echo "  Configura la impresora en Windows:"
echo "  Dispositivos e impresoras → Agregar impresora → Impresora de red"
echo "  URL: http://$IP:631/printers/CADPrinter"
echo ""
echo "  Para ver logs:"
echo "    journalctl -fu cad-printer"
echo "    journalctl -fu cad-watcher"
