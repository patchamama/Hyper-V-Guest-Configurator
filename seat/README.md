# Dedicated Seat — puestos de trabajo multi-seat

Asigna un **teclado y un ratón dedicados** a una sesión concreta (una VM, un navegador en modo kiosk, un escritorio…),
de forma que esos dispositivos solo controlen esa sesión mientras el resto del equipo sigue usando los suyos.
El objetivo final es un proyecto **universal e independiente** (Windows, Linux y macOS) que convierta un solo equipo en
varios puestos de trabajo: **una pantalla + un teclado + un ratón por puesto**, cada uno con el modo que se elija.

Hoy vive dentro del Hyper-V Configurator (`/api/seat`, página `/seat/`), pero la carpeta `seat/` es autónoma y está
pensada para separarse en su propio repositorio.

## Estado actual (Windows + WSL)

Funciona y está probado con un ratón USB y un teclado USB:

1. **usbipd-win** desconecta los dispositivos USB elegidos de Windows y los conecta a la distro WSL del usuario.
2. En WSL, `seat.sh` arranca un **Xorg sobre una pantalla virtual** (`dummy`) cuya **única entrada** son esos
   dispositivos (`libinput`, `AutoAddDevices off`).
3. Dentro corre una **sesión RDP** a una VM (`xfreerdp3`), un **navegador en modo kiosk** (Firefox; Chrome/Edge opcionales)
   o, en modo Docker, un **contenedor con escritorio** (Ubuntu + XFCE) que recibe solo esos dispositivos.
4. La imagen se muestra en el escritorio de Windows con un **visor VNC de solo lectura** (x11vnc + TigerVNC vía WSLg),
   así que el teclado y el ratón de Windows no pueden actuar sobre ella. El cursor se pinta en la imagen.
5. Al detener el puesto, los dispositivos vuelven a Windows.

| Archivo | Función |
|---|---|
| `seat.sh` | Puesto dentro de WSL: `start`, `stop`, `status`, `devices`, `check`, `logs`. Se instala en WSL como `hvc-seat`. |
| `setup.sh` | Paquetes de Linux: Xorg dummy + libinput, x11vnc, TigerVNC, openbox, FreeRDP 3, Firefox (`.deb` de Mozilla), opcionales Chrome/Edge. |
| `seat-lib.js` | Lado Windows: usbipd (bind/attach/detach), órdenes en la WSL del usuario interactivo mediante una tarea programada, preparar/iniciar/detener, y rutas Express. |
| `app.js`, `start-seat.bat` | App independiente en `http://localhost:3100` (requiere administrador). |
| `public/index.html` | Interfaz: requisitos, dispositivos, modo (RDP / navegador), iniciar/detener. |

### Uso

```
cd seat
npm install
start-seat.bat          # pide elevación y abre http://localhost:3100
```

La página puede abrirse con datos ya rellenados: `/?target=host:13389&user=SRV01%5Cusuario&pass=...`
(`host` = este Windows visto desde WSL).

### Limitaciones conocidas

- **Solo dispositivos USB.** usbipd no puede pasar un dispositivo Bluetooth suelto, solo el adaptador entero, y el kernel
  de WSL no trae el driver de adaptadores MediaTek (`BT_HCIBTUSB_MTK`). Los teclados/ratones internos del portátil
  tampoco se pueden pasar.
- **WSL en modo `mirrored`** no puede alcanzar el servicio usbipd del host en este equipo (VPN); `prepare` cambia a `nat`
  (con copia `.wslconfig.bak-hvc`).
- **Cada usuario de Windows tiene su propia VM de WSL**: los comandos se ejecutan como el usuario con sesión iniciada
  mediante una tarea programada, aunque la app corra elevada con otra cuenta. Cada operación tarda 10-30 s por ello.
- **Rendimiento:** la imagen pasa por VNC local; en modo navegador con Guacamole hay doble escritorio remoto. Para VMs
  conviene el modo RDP directo.
- **Fallos transitorios:** en algún momento las órdenes lanzadas como el usuario interactivo no devolvieron salida; los
  permisos de `C:\ProgramData\hvc-run` son correctos y volvió a funcionar sin cambios. Si se repite, reintentar.

## Pendiente / hoja de ruta

### 1. Puestos en Windows sin software de terceros (descartado MouseMux)

Se evaluó **MouseMux V3** (un cursor y foco por pareja ratón/teclado, bloqueo por ventana o pantalla). Se **descartó**:
es software comercial (aviso de compra y 3 días de prueba; el bloqueo por ventana es función Pro) y no se quiere depender
de él. Se desinstaló.

La alternativa propia para Windows, sin WSL y con soporte de **Bluetooth**, es un enrutador de entrada con Raw Input
(ver "Universal" más abajo):

- [ ] Leer la entrada con Raw Input (`RegisterRawInputDevices` + `WM_INPUT`), que identifica el dispositivo de cada evento.
- [ ] Ventana a pantalla completa por puesto que reciba solo los eventos de sus dispositivos (un cliente RDP/VNC o un
      navegador embebido dibujando en ella).
- [ ] Limitación a resolver: Windows sigue entregando esa entrada también al sistema; habría que filtrarla con un hook de
      bajo nivel (`WH_KEYBOARD_LL` / `WH_MOUSE_LL`, que no indica el dispositivo) o con un driver de filtro.

Proyectos libres para capturar y redirigir la entrada por dispositivo (a evaluar):

| Plataforma | Proyecto | Uso |
|---|---|---|
| Windows | `oblitum/Interception` | Driver de filtro + librería: identifica cada teclado/ratón, bloquea sus eventos y permite reenviarlos. Licencia gratuita no comercial (comercial aparte). |
| Windows | `evilC/AutoHotInterception` | AutoHotkey sobre Interception: suscribirse a un dispositivo, bloquearlo y enviar a una ventana (`ControlSend`/`ControlClick`). |
| Windows | LuaMacros | Distingue teclados por dispositivo (macros); limitado con ratones. |
| Linux | interception-tools, evsieve, keyd | Captura exclusiva (`EVIOCGRAB`) y reemisión por `uinput`. |
| macOS | Karabiner-Elements | Reglas por dispositivo (open source). |
| Multiplataforma | Kanata | Remapeo por dispositivo (en Windows con el driver Interception). |
| Entre equipos | Input Leap (antes Barrier) | Compartir teclado/ratón entre máquinas. |

### 2. Varios puestos con varias pantallas

Si se detectan varias pantallas, cada una puede ser un puesto:

- [ ] Detectar monitores y dispositivos de entrada; asistente: **pantalla → teclado + ratón → modo**.
- [ ] Cada pantalla muestra su terminal **a pantalla completa en modo kiosk** (sin barra de tareas ni marcos).
- [ ] Modos por puesto:
  - **WSL** — puesto Xorg actual; el visor a pantalla completa en el monitor elegido
    (`xtigervncviewer -FullScreen -FullScreenMode=Selected -FullScreenSelectedMonitors=N`).
  - **Docker** — contenedor con Xorg/escritorio (p. ej. `linuxserver/webtop`) recibiendo los dispositivos (`--device`) en
    la misma VM de WSL del usuario (Docker dentro de su Ubuntu).
  - **Escritorio nativo de Windows** — enrutador de entrada propio (Raw Input) limitado a ese monitor.
  - **Navegador** — Chrome/Edge/Firefox en `--kiosk` en ese monitor (Windows nativo o WSL).
  - **VM de Hyper-V** — RDP/VMConnect a pantalla completa en ese monitor (RDP con contraseña cifrada para el usuario, sesión
    nueva o existente).
  - **VM de VirtualBox** — `VBoxManage startvm --type gui` a pantalla completa; VirtualBox permite **filtros USB** para
    pasar el teclado/ratón a la VM de forma exclusiva, sin usbipd.
- [ ] Guardar configuraciones de puestos y arrancarlas juntas (perfil "aula" / "oficina").

### 3. Universal: Linux y macOS

- [ ] **Linux nativo:** multi-seat real con `systemd-logind` (`loginctl attach seatN <dispositivo>`), un compositor por
      puesto (p. ej. `cage` o Weston en kiosk) con su salida de vídeo y su entrada filtrada por libinput. Con una sola GPU y
      varias salidas: un compositor por salida (o Xorg con un `ServerLayout` por pantalla) en lugar de seats de logind.
- [ ] **macOS:** no tiene multi-seat. Alternativa: app que **capture en exclusiva** un teclado/ratón concretos con IOKit
      (`IOHIDManager` + `kIOHIDOptionsTypeSeizeDevice`) y los reenvíe a una sesión que dibuja a pantalla completa en un
      monitor (cliente RDP/VNC/navegador embebido).
- [ ] **Windows sin WSL:** enrutador de entrada propio con Raw Input (identifica el dispositivo de cada evento) y una
      ventana a pantalla completa por monitor.
- [ ] Núcleo común multiplataforma (Node/Electron o Tauri) con "backends" por sistema: `wsl`, `docker`, `native`,
      `browser`, `hyperv`, `virtualbox`, `logind`, `iokit`.

### 4. Contenedores

- [x] Docker Engine dentro de la Ubuntu del usuario (no Docker Desktop de otra cuenta: cada usuario de Windows tiene su
      propia VM de WSL y solo esa ve los USB conectados con usbipd). Incompatible con activar a la vez la integración de
      Docker Desktop para esa distro.
- [x] **Puesto de escritorio en Docker** (`docker/`): imagen `hvc-seat-desktop` (Ubuntu 24.04 + XFCE) con Xorg dummy que solo
      usa los dispositivos pasados con `--device` y VNC de solo lectura en `VNC_PORT`:
      ```
      docker build -t hvc-seat-desktop seat/docker
      docker run -d --name hvc-seat-docker --network host --device /dev/input/event0 --device /dev/input/event1 \
        -v /run/udev:/run/udev:ro -e MOUSE=event0 -e KBD=event1 -e DISPLAY_NUM=3 -e VNC_PORT=5903 hvc-seat-desktop
      DISPLAY=:0 xtigervncviewer -ViewOnly -PreferredEncoding=Raw -AutoSelect=0 127.0.0.1:5903
      ```
- [x] Modo Docker integrado en la interfaz ("Desktop container (Docker)"): al iniciar comprueba Docker Engine y la imagen
      en la distro y, si falta algo, instala Docker Engine (repositorio oficial) y construye la imagen antes de arrancar
      el contenedor `hvc-seat-<display>`; al detener se elimina el contenedor y los dispositivos vuelven a Windows.
      También instalable desde "Install / repair requirements" (`setup.sh docker=<contexto>`).
- [ ] Contenedor con escritorio accesible por navegador (`linuxserver/webtop`) como alternativa sin dispositivos dedicados.
- [ ] Averiguar si existe una imagen de **ELO sobre Ubuntu**; si no, crear una.

### 5. Separar el proyecto

- [ ] Mover `seat/` a su propio repositorio, con `package.json` propio (ya incluido) y sin dependencias del configurador.
- [ ] Instalador/arranque elevado por plataforma y documentación de requisitos.
