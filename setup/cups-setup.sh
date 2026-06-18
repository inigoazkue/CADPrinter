#!/usr/bin/env bash
# cups-setup.sh — Configura CUPS + cups-pdf para CAD Printer
# Llamado por install.sh con los argumentos correctos

PROJECT_DIR="${1:-/opt/cad-printer}"
SERVICE_USER="${2:-$USER}"
PRINTER_NAME="CADPrinter"
CUPS_PDF_OUTPUT="/var/spool/cups-pdf/ANONYMOUS"

echo "    Configurando CUPS..."

# Habilitar CUPS para escuchar en red local
sed -i 's|Listen localhost:631|Listen 0.0.0.0:631|' /etc/cups/cupsd.conf 2>/dev/null || true

# Añadir permisos de administración y de compartir impresoras
grep -q "ServerAlias \*" /etc/cups/cupsd.conf || \
  sed -i '/<\/Browsing>/a ServerAlias *' /etc/cups/cupsd.conf

# Política: permitir acceso desde red local
if ! grep -q "Allow @LOCAL" /etc/cups/cupsd.conf; then
cat >> /etc/cups/cupsd.conf <<'EOF'

<Location />
  Order allow,deny
  Allow @LOCAL
</Location>

<Location /admin>
  Order allow,deny
  Allow @LOCAL
</Location>

<Location /admin/conf>
  AuthType Default
  Require user @SYSTEM
  Order allow,deny
  Allow @LOCAL
</Location>
EOF
fi

# Configurar cups-pdf para guardar en directorio accesible
CUPS_PDF_CONF="/etc/cups/cups-pdf.conf"
if [ -f "$CUPS_PDF_CONF" ]; then
  sed -i "s|^#*Out .*|Out \${HOME}|" "$CUPS_PDF_CONF"
  # Usar directorio ANONYMOUS para impresiones sin autenticar
  sed -i "s|^#*AnonDirName .*|AnonDirName /var/spool/cups-pdf/ANONYMOUS|" "$CUPS_PDF_CONF"
fi

# Crear directorio de salida de cups-pdf
mkdir -p "$CUPS_PDF_OUTPUT"
chmod 777 "$CUPS_PDF_OUTPUT"

# Reiniciar CUPS
systemctl enable cups
systemctl restart cups

# Instalar la impresora virtual PDF
sleep 2  # esperar a que CUPS arranque
lpadmin -p "$PRINTER_NAME" \
        -E \
        -v "cups-pdf:/" \
        -m "CUPS-PDF.ppd" \
        -D "CAD Printer Virtual" \
        -L "CAD Printer" \
        2>/dev/null || \
lpadmin -p "$PRINTER_NAME" \
        -E \
        -v "cups-pdf:/" \
        -P "/usr/share/ppd/cups-pdf/CUPS-PDF_opt.ppd" \
        -D "CAD Printer Virtual" \
        -L "CAD Printer" \
        2>/dev/null || \
echo "      AVISO: No se pudo configurar la impresora automáticamente."
echo "             Hazlo manualmente en http://localhost:631"

# Compartir la impresora
cupsctl --share-printers 2>/dev/null || true
cupsenable "$PRINTER_NAME" 2>/dev/null || true

echo "    CUPS OK — impresora: $PRINTER_NAME"
echo "    Los PDFs se guardan en: $CUPS_PDF_OUTPUT"
