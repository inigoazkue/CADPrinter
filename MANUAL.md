# Manual de usuario — CAD Printer

CAD Printer es una herramienta para gestionar impresiones de AutoCAD que no caben en un solo folio. Permite recibir PDFs desde AutoCAD, agruparlos en capas, combinarlos y obtener un PDF final listo para imprimir.

---

## Acceso a la aplicación

Abre el navegador y ve a:

```
http://<IP-del-servidor>:8080
```

Pregunta la IP del servidor a tu administrador. La aplicación funciona en red local y no requiere contraseña.

---

## Conceptos básicos

| Concepto | Descripción |
|---|---|
| **Lan** (Trabajo) | Agrupa todo lo relacionado con un rótulo o panel. Genera un PDF final. |
| **Orri** (Hoja) | Una página del PDF final. Un trabajo puede tener varias hojas. |
| **Geruza** (Capa) | Un PDF recibido desde AutoCAD o subido manualmente. Varias capas se superponen en una hoja. |
| **Lan aktiboa** (Trabajo activo) | El trabajo marcado con el punto verde. Las impresiones que llegan desde AutoCAD van aquí automáticamente. |

---

## Configurar la impresora en Windows

Esto solo hay que hacerlo una vez por equipo.

### Pasos

1. Abre **Panel de control** → **Dispositivos e impresoras**
2. Haz clic en **Agregar una impresora**
3. Selecciona **"La impresora deseada no está en la lista"**
4. Elige **"Seleccionar una impresora compartida por nombre"**
5. Escribe la dirección del servidor (sustituye la IP por la de tu servidor):

   ```
   http://<IP-del-servidor>:631/printers/CADPrinter
   ```

   Ejemplo: `http://192.168.1.50:631/printers/CADPrinter`

6. Haz clic en **Siguiente**
7. Cuando pida el driver, elige:
   - Fabricante: **Generic**
   - Impresora: **MS Publisher Imagesetter**
8. Completa el asistente. Puedes dejar el nombre como "CADPrinter".

Desde este momento, "CADPrinter" aparecerá como impresora disponible en AutoCAD y cualquier otra aplicación.

> En Windows en euskera, el asistente puede aparecer como "Gehitu inprimagailua". Los pasos son los mismos.

---

## Flujo de trabajo habitual

### 1. Crear un trabajo nuevo

En la barra lateral izquierda, pulsa el botón **+** (esquina superior derecha del sidebar).

- Escribe el nombre del trabajo (por ejemplo: `Panel-CC-01`)
- Selecciona el formato: **A3** o **A4**
- Deja marcada la opción "Aktibatu lan aktibo gisa"
- Pulsa **Sortu**

El trabajo nuevo aparece en la lista y se marca como activo (punto verde).

### 2. Imprimir desde AutoCAD

En AutoCAD, imprime normalmente (`Ctrl+P`) y selecciona la impresora **CADPrinter**.

- Configura el tamaño de papel (A3 o A4) según corresponda
- Pulsa **Aceptar**

En unos segundos, el PDF aparece automáticamente en el trabajo activo dentro de la aplicación web. Si tienes el navegador abierto, se actualiza solo.

### 3. Organizar las capas

Cada PDF recibido aparece como una miniatura en la primera hoja del trabajo activo.

**Para mover una capa a otra hoja:** arrastra la miniatura y suéltala en la hoja de destino.

**Para habilitar o deshabilitar una capa:** pasa el ratón sobre la miniatura y pulsa el botón **✓** (activa) o **○** (desactivada). Las capas desactivadas no aparecen en el PDF final ni en la vista previa.

**Para eliminar una capa:** pasa el ratón sobre la miniatura y pulsa **✕**.

**Aviso de formato:** si una capa tiene un formato diferente al del trabajo (por ejemplo, un PDF A4 en un trabajo A3), aparece un badge naranja **⚠ A4** sobre la miniatura. Al exportar, la capa se escalará automáticamente al formato del trabajo.

### 4. Añadir una hoja nueva

En el panel principal del trabajo, pulsa **+ Orri berria** al final de la lista.

### 5. Subir un PDF manualmente

Dentro de cualquier hoja, pulsa **⬆ PDF bat igo eskuz** y selecciona el fichero PDF desde tu equipo.

### 6. Imprimir el resultado final

Cuando todas las capas estén organizadas, pulsa el botón **🖨 Inprimatu** en la cabecera del trabajo.

Se abre el PDF combinado en una nueva pestaña del navegador. Desde ahí, usa **Ctrl+P** para imprimir en la impresora física.

---

## Gestión de trabajos desde el sidebar

Al pasar el ratón sobre un trabajo en la lista, aparecen tres botones:

| Botón | Acción |
|---|---|
| Icono impresora | Imprime directamente el trabajo (abre PDF en nueva pestaña) |
| Icono lápiz | Renombra el trabajo |
| Icono papelera | Borra el trabajo y todos sus PDFs |

---

## Gestión de hojas

En la cabecera de cada hoja:

- **Nombre de la hoja**: haz clic sobre él para editarlo directamente
- **Icono papelera** (junto al nombre): borra la hoja. Sus capas pasan a la primera hoja del trabajo.
- **⬆ PDF bat igo eskuz**: sube un PDF manualmente a esa hoja

---

## Vista previa

A la derecha de cada hoja se muestra la **vista previa combinada** de todas las capas activas superpuestas. Se actualiza automáticamente cuando cambias las capas.

---

## Cambiar el formato de un trabajo

En la cabecera del trabajo, pulsa **Formatua** y selecciona A3 o A4. Si alguna capa tiene un formato distinto al nuevo formato del trabajo, aparecerá el aviso naranja automáticamente.

---

## Preguntas frecuentes

**Las impresiones no llegan a la aplicación**
- Comprueba que la impresora CADPrinter está seleccionada en AutoCAD
- Verifica que el servidor está encendido y accesible en `http://<IP>:8080`
- Consulta con el administrador: `journalctl -fu cad-watcher`

**El PDF exportado está en blanco**
- Asegúrate de que al menos una capa está habilitada (botón ✓ activo)

**Aparece un aviso naranja ⚠ en una miniatura**
- El PDF tiene un formato diferente al del trabajo (A4 en un trabajo A3, o viceversa). Puedes dejarlo igualmente; se escalará al tamaño del trabajo al exportar.

**¿Se borran los PDFs al cerrar la aplicación?**
- No. Los PDFs se guardan en el servidor hasta que borras la capa o el trabajo manualmente.

**¿Puedo usar la aplicación desde varios ordenadores a la vez?**
- Sí. La aplicación se actualiza en tiempo real en todos los navegadores abiertos.
