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

- [x] Detectar monitores (`seat.sh monitors`: los monitores de Windows tal como los expone WSLg) y elegir por puesto
      **"Screen"**: ventana 1280×800 o **pantalla completa en un monitor**, con la pantalla virtual del puesto a la
      resolución de ese monitor (modeline con `cvt`; también en el contenedor vía `SEAT_W`/`SEAT_H`).
- [x] **Varios puestos a la vez** (Seat 2-5, display `:N`; los contenedores usan `:N+20`), cada uno con sus dispositivos;
      un dispositivo solo puede pertenecer a un puesto. Detener por puesto.
- [ ] Verificar con el usuario en qué monitor físico aparece cada índice de WSLg (la numeración de WSLg no coincide con
      la de Windows) y etiquetarlos mejor.
- [ ] Asistente guiado: **pantalla → teclado + ratón → modo** y perfiles guardados para arrancar varios puestos juntos.
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

- [ ] **Máquinas virtuales invitadas de cualquier sistema** como contenido de un puesto, no solo Windows:
  - Windows (probado con WSL/RDP), **distros Linux** (Ubuntu, Debian, Fedora, openSUSE…; acceso por RDP/VNC/SPICE o
    consola de la VM a pantalla completa) y **macOS** (solo sobre hardware Apple por la licencia de Apple; en otros
    equipos queda fuera del alcance).
  - Hipervisores objetivo: Hyper-V, VirtualBox, KVM/QEMU (libvirt), VMware y WSL/Docker. Un `backend` por hipervisor con la
    misma interfaz: `listVMs`, `start`, `stop`, `attachInput(dispositivos)`, `showFullscreen(monitor)`.
- [ ] **Detección del invitado:** al elegir una VM, reconocer su SO y ofrecer el modo adecuado (RDP para Windows, SPICE/VNC
      para Linux, consola de VirtualBox/KVM para el resto).

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
- [x] **Elección de escritorio** en el modo Docker: cada escritorio es una etiqueta `hvc-seat-desktop:<desktop>`
      (`--build-arg DESKTOP=`), construida la primera vez que se usa:
      | Tipo | Escritorios |
      |---|---|
      | Completos | XFCE, MATE, KDE Plasma, GNOME Flashback (GNOME Shell requiere 3D y la pantalla virtual no lo tiene) |
      | Ligeros | LXQt, LXDE |
      | Gestores de ventanas (muy ligeros) | Openbox + tint2, IceWM, Fluxbox, JWM, i3 (mosaico, por teclado) |
      También se puede indicar una **imagen propia** (debe existir en la distro y usar el mismo contrato: `MOUSE`, `KBD`,
      `DISPLAY_NUM`, `VNC_PORT`, `SEAT_W`, `SEAT_H`).
- [ ] Contenedor con escritorio accesible por navegador (`linuxserver/webtop`) como alternativa sin dispositivos dedicados.
- [x] **ELO en contenedores:** resuelto, pero **no pertenece a este proyecto**. Vive en `seat/elo/` (asistente web para
      instalar ELO en Docker, Hyper-V, VirtualBox y WSL) y se publica como repositorio propio. Aquí solo queda la idea de
      que un puesto pueda ser "una VM/contenedor con ELO" como cualquier otro.

### 5. Multi-seat en red

Un puesto no tiene por qué estar en la misma máquina física que el servidor. Objetivo: que el servidor reparta puestos a
clientes de la red con el mismo modelo de "una pantalla + un teclado + un ratón = una máquina aparte".

- [ ] **Puesto remoto:** cliente ligero (PC viejo, Raspberry Pi, portátil) que se conecta a un puesto del servidor por
      RDP / VNC / SPICE / Sunshine+Moonlight y envía **solo su** teclado y ratón. El servidor no mezcla esa entrada con la de
      los puestos locales.
- [ ] **USB/IP:** exportar los dispositivos de un cliente al servidor (`usbip` en Linux, `usbipd-win` en Windows) para que
      ese ratón/teclado remoto se comporte como local y pueda asignarse a un puesto.
- [ ] **Modelo de acceso "permisible":** lista de dispositivos y clientes autorizados por puesto (por MAC/ID de
      dispositivo o clave), con modos **exclusivo** (solo ese dispositivo manda en el puesto) e **inclusivo/compartido** (varios
      dispositivos controlan el mismo puesto, p. ej. un puesto con ratón local y otro remoto).
- [ ] **Seguridad:** autenticación de clientes (clave o certificado), cifrado (SSH/TLS/WireGuard), nada expuesto por
      defecto; la interfaz web solo en `localhost` o tras autenticación.
- [ ] **Descubrimiento:** anunciar los puestos libres en la LAN (mDNS) y permitir reservarlos desde el cliente.
- [ ] **Varios monitores como puestos independientes** (un monitor + su teclado/ratón = una máquina) combinado con
      puestos remotos, sin que un puesto vea ni controle a otro.

### 6. Separar el proyecto

- [ ] Publicar `seat/` (sin `seat/elo/`) como repositorio propio, con `package.json` propio (ya incluido) y sin
      dependencias del Hyper-V Configurator. Para conservar el historial: `git filter-repo --path seat/ --path-rename seat/:`
      en un clon nuevo (o copiar los archivos y empezar historial limpio).
- [ ] Quitar de la interfaz las rutas `/api/seat` del configurador cuando el repositorio ya sea independiente.
- [ ] Instalador/arranque elevado por plataforma y documentación de requisitos.
- [ ] CI básica (lint + comprobación de sintaxis de `seat.sh`/`setup.sh` con `shellcheck`) y licencia del repositorio.
- [ ] Nota sobre Interception y otros componentes con licencia no comercial antes de elegir la licencia del proyecto.
