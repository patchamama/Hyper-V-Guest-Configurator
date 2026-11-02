# ELO on Docker / Kubernetes — automated installer

Proyecto (pensado para separarse en su propio repositorio) para **crear y ejecutar entornos ELO funcionales en
contenedores** a partir de las imágenes oficiales de ELO, con un **instalador web paso a paso** que comprueba los
requisitos, lista las imágenes disponibles, pide credenciales y licencia, instala, prueba y expone los servicios.

> Las imágenes de ELO están en un registro privado y requieren cuenta de **partner/cliente de ELO**.
> Este proyecto no contiene imágenes, credenciales ni licencias (`.env`, `*.pk`, `*.txt`, `*.lic` están en `.gitignore`).

## Dónde están las imágenes

| Recurso | URL |
|---|---|
| Registro (Harbor) | https://registry.elo.com → **Login via OIDC provider** → proyecto **`eck-services`** |
| Documentación Docker (ELO 25 LTS) | https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/ |
| Documentación ELO Cloud on Kubernetes | https://docs.elo.com/ops/eck/en-us/getting-started/ |
| Listado completo generado | [elo-docker-list.md](elo-docker-list.md) |

- **Login para `docker pull`:** usuario del registro + **CLI secret** (perfil de usuario en https://registry.elo.com),
  no la contraseña: `docker login registry.elo.com -u <usuario> --password-stdin`.
- **Plataforma:** todas las imágenes son **`linux/amd64`**. **No hay imágenes para Windows**: en Windows se ejecutan con
  **WSL2 + Docker** (Docker Engine dentro de la distro, o Docker Desktop), que es lo que ELO recomienda para pruebas.
  Una instalación nativa en Windows Server sigue siendo la de *ELO Server Setup*, no contenedores.
- **Base:** las imágenes actuales de ELO 25 usan **Wolfi OS** con OpenJDK 25 (OpenJ9) y Tomcat 11; las antiguas, Debian slim.

## Imágenes disponibles

<!-- images:start -->
_Updated 2026-10-29 from https://registry.elo.com — full details per image in [elo-docker-list.md](elo-docker-list.md)._

| Image | ELO lines | Latest stable ELO 25 | Latest tag | Size | Updated | Pulls | Base | Links |
|---|---|---|---|---|---|---|---|---|
| [`ix-import`](elo-docker-list.md#ix-import) | 25, 23, 21, 20 | `v25-0.30.1` | `v25-1.0.0-beta` | 241 MB | 2026-10-16 | 13237 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/ix-import/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-ix-import.html) |
| [`search`](elo-docker-list.md#search) | 25, 23, 21, 20 | `v25-1.0` | `v25-1.0` | 1.08 GB | 2026-10-16 | 12629 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/search/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-search.html) |
| [`server`](elo-docker-list.md#server) | 25, 23, 21 | `v25-0.30.1` | `v25-1.0.0-beta` | 1.15 GB | 2026-10-16 | 12294 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/server/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-server.html) |
| [`ix-setup`](elo-docker-list.md#ix-setup) | 25, 23, 21, 20 | `v25-0.30.1` | `v25-1.0.0-beta` | 1.05 GB | 2026-10-16 | 11895 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/ix-setup/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-ix-setup.html) |
| [`flows-worker`](elo-docker-list.md#flows-worker) | 25, 23, 21 | `v25-0.30.1` | `v25-1.0.0-beta` | 354 MB | 2026-10-16 | 10792 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/flows-worker/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-flows-worker.html) |
| [`flows`](elo-docker-list.md#flows) | 25, 23, 21 | `v25-0.30.1` | `v25-1.0.0-beta` | 341 MB | 2026-10-16 | 10728 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/flows/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-flows.html) |
| [`as`](elo-docker-list.md#as) | 25, 23, 21, 20 | `v25-0.30.1` | `v25-1.0.0-beta` | 528 MB | 2026-10-16 | 9909 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/as/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-as.html) |
| [`tr2`](elo-docker-list.md#tr2) | 25, 23, 21 | `v25-0.30.1` | `v25-1.0.0-beta` | 1.94 GB | 2026-10-16 | 6849 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/tr2/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-tr2.html) |
| [`ix`](elo-docker-list.md#ix) | 25, 23, 21, 20 | `v25-0.30.1` | `v25-1.0.0-beta` | 995 MB | 2026-10-16 | 3448 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/ix/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-ix.html) |
| [`postgresql`](elo-docker-list.md#postgresql) | — | — | `nightly` | 91 MB | 2021-10-14 | 3426 |  | [registry](https://registry.elo.com/harbor/projects/2/repositories/postgresql/artifacts-tab) |
| [`ui`](elo-docker-list.md#ui) | 25, 23, 21, 20 | `v25-0.30.1` | `v25-1.0.0-beta` | 375 MB | 2026-10-16 | 3393 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/ui/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-ui.html) |
| [`busybox`](elo-docker-list.md#busybox) | — | — | `1.32.0` | 1 MB | 2021-07-12 | 1572 |  | [registry](https://registry.elo.com/harbor/projects/2/repositories/busybox/artifacts-tab) |
| [`rest`](elo-docker-list.md#rest) | 23, 21, 20 | — | `v23-0.30` | 230 MB | 2026-09-22 | 1486 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/rest/artifacts-tab) |
| [`cv`](elo-docker-list.md#cv) | 21, 20 | — | `v20-0.3` | 381 MB | 2024-04-12 | 1311 | debian:12.5-slim | [registry](https://registry.elo.com/harbor/projects/2/repositories/cv/artifacts-tab) |
| [`sl`](elo-docker-list.md#sl) | 25, 23, 21 | `v25-0.30.1` | `v25-1.0.0-beta` | 256 MB | 2026-10-16 | 903 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/sl/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-sl.html) |
| [`traefik`](elo-docker-list.md#traefik) | 2 | — | `v2.10.0` | 41 MB | 2024-01-19 | 823 |  | [registry](https://registry.elo.com/harbor/projects/2/repositories/traefik/artifacts-tab) |
| [`ocr-setup`](elo-docker-list.md#ocr-setup) | 21, 20 | — | `v20-0.3` | 231 MB | 2024-04-12 | 643 | debian:12.5-slim | [registry](https://registry.elo.com/harbor/projects/2/repositories/ocr-setup/artifacts-tab) |
| [`ocr`](elo-docker-list.md#ocr) | 21, 20 | — | `v20-0.3` | 847 MB | 2024-04-12 | 619 | debian:12.5-slim | [registry](https://registry.elo.com/harbor/projects/2/repositories/ocr/artifacts-tab) |
| [`flows-registry`](elo-docker-list.md#flows-registry) | 25, 23 | `v25-0.30.1` | `v25-1.0.0-beta` | 253 MB | 2026-10-16 | 578 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/flows-registry/artifacts-tab) |
| [`flows-worker-base`](elo-docker-list.md#flows-worker-base) | 25, 23 | `v25-0.30.1` | `v25-1.0.0-beta` | 273 MB | 2026-10-16 | 457 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/flows-worker-base/artifacts-tab) |
| [`cmis`](elo-docker-list.md#cmis) | 25, 23 | `v25-0.30.1` | `v25-1.0.0-beta` | 252 MB | 2026-10-16 | 376 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/cmis/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-cmis.html) |
| [`elo-sync`](elo-docker-list.md#elo-sync) | 25, 23 | `v25-0.30.1` | `v25-1.0.0-beta` | 236 MB | 2026-10-16 | 155 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/elo-sync/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-elo-sync.html) |
| [`model-processor`](elo-docker-list.md#model-processor) | 25 | — | `v25-1.0.0-beta` | 253 MB | 2026-10-16 | 52 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/model-processor/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/en-us/administration-docker/images/cloud-mp.html) |
| [`entity-extraction-service`](elo-docker-list.md#entity-extraction-service) | 25 | — | `v25-1.0.0-beta` | 371 MB | 2026-10-16 | 51 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/entity-extraction-service/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/en-us/administration-docker/images/cloud-ees.html) |
| [`aio`](elo-docker-list.md#aio) | 23 | — | `v23-3.2` | 2.07 GB | 2024-07-09 | 46 | debian:12.2-slim | [registry](https://registry.elo.com/harbor/projects/2/repositories/aio/artifacts-tab) |
| [`postgresql-exporter`](elo-docker-list.md#postgresql-exporter) | — | — | `12.5.0` | 43 MB | 2021-10-14 | 45 |  | [registry](https://registry.elo.com/harbor/projects/2/repositories/postgresql-exporter/artifacts-tab) |
| [`rp`](elo-docker-list.md#rp) | 21, 20 | — | `v21-3.0` | 163 MB | 2022-10-21 | 25 | debian:11.5-slim | [registry](https://registry.elo.com/harbor/projects/2/repositories/rp/artifacts-tab) |
| [`analytics`](elo-docker-list.md#analytics) | 21 | — | `v21-1.0` | 360 MB | 2021-12-16 | 20 |  | [registry](https://registry.elo.com/harbor/projects/2/repositories/analytics/artifacts-tab) |
| [`imo`](elo-docker-list.md#imo) | — | — | `20.00.002-0.1` | 149 MB | 2020-11-05 | 6 |  | [registry](https://registry.elo.com/harbor/projects/2/repositories/imo/artifacts-tab) |
| [`replication`](elo-docker-list.md#replication) | — | — | — |  |  | 1 |  | [registry](https://registry.elo.com/harbor/projects/2/repositories/replication/artifacts-tab) |
<!-- images:end -->

Para regenerar el listado (y este bloque):

```
node tools/registry-inventory.js ../../.elo-credentials.json inventory.json
node tools/inventory-md.js inventory.json elo-docker-list.md --readme README.md
```

## Estado actual (probado)

- `docker-compose.yml` + `elo.sh`: pila **ELO 25** (`v25-0.30.1`) según la guía oficial: `server` (Index Server +
  Web Client + Admin Console), `ix-setup`, `ix-import`, `as`, `search` (Elasticsearch 8), `flows`, `flows-worker`,
  `tr2` (Textreader 2 + OCR) y PostgreSQL.
  - `elo.sh env` genera un `.env` con contraseñas internas aleatorias (una vez) y usa la licencia `elo-license.lic` o
    la **clave privada `ELO_25*.pk`** (ELO descarga la licencia desde `license.services.elo.cloud`/`license.elo.com`).
  - `elo.sh pull | up | status | down`.
- `tools/registry-inventory.js`: inicia sesión en el registro (OIDC de ELO) y vuelca todas las imágenes, etiquetas,
  tamaños, fechas, SO/arquitectura y etiquetas OCI (versiones de IX, Web Client, Admin Console, plugins, JDK, Tomcat).
- `tools/inventory-md.js`: genera `elo-docker-list.md` y el bloque de imágenes de este README.

### Prueba real (ELO 25, `v25-0.30.1`, WSL2 + Docker Engine 29)

| Paso | Resultado |
|---|---|
| Descarga de 9 imágenes | 995 s, ~16 GB descomprimidas (tr2 5,4 GB, server 2,4 GB, ix-setup 2,1 GB) |
| Arranque hasta repositorio operativo | ~2 min (`ix-setup` exit 0, IX 200) |
| Licencia `.pk` | descargada del servidor de licencias por `ix-setup` |
| Index Server, Admin Console, iSearch, Textreader | OK (Elasticsearch `yellow`, normal con un nodo) |
| Login Administrador (Admin Console) | OK; EULA en el primer login |
| Web Client | bloqueado si la licencia no incluye licencias de servidor/usuario del Web Client (`Missing Webclient Server License`) |
| Memoria en uso | ~10,8 GB (search 4,8 GB, tr2 2,2 GB, server 1,5 GB, as 1 GB, flows ~1,3 GB) |

## Instalador web (`installer/`)

```
installer\start-installer.bat        # Windows (elevado; la parte Linux corre en WSL2)
installer/start-installer.sh         # Ubuntu/Debian (root; Docker nativo)
```
Abre http://localhost:3200. Backend Node (`server.js`, `exec.js`) + frontend de una página (`public/index.html`).

**¿Sin WSL?** En **Linux (Ubuntu/Debian)** el instalador funciona directamente con Docker Engine y bash (sin VM): es la
opción más eficiente. En **Windows** las imágenes de ELO (solo Linux) necesitan siempre una VM Linux: WSL2 con Docker
Engine dentro de la distro (lo que usa el instalador), Docker Desktop (también WSL2/Hyper-V) o una VM Hyper-V con Ubuntu
ejecutando el instalador en modo Linux.

Implementado y probado contra la instalación real: requisitos, login al registro (CLI secret o contraseña → CLI secret),
inventario en vivo, subida de licencia, configuración (repositorio, idioma, tipo de licencia, usuarios y contraseñas,
URL pública, servicios opcionales), instalación como trabajo en segundo plano con progreso en vivo, pruebas (contenedores,
**login en la Admin Console y aceptación automática del EULA con Playwright**, diagnóstico del Web Client), panel de acceso
y credenciales, y **administración**: memoria por servicio, parar/arrancar/reiniciar servicios (Tomcats: server, as, flows,
search, tr2…), parar/arrancar la pila o Docker, logs, copia de imágenes (`docker save`) y exposición de puertos a la red.

Además:

- **Destinos de instalación:** WSL2 + Docker Engine, Docker Desktop (descarga/instalación firmada; usa su integración
  WSL), **VM de Hyper-V**, **VM de Oracle VirtualBox** o servidor Linux **por SSH** (clave ed25519 generada por el
  instalador, `sudo` sin contraseña en la VM; los archivos de ELO se copian a `/opt/elo-docker` y el progreso se lee
  por SSH), y Linux nativo.
- **pgAdmin** (opción del asistente y de la administración): contenedor `dpage/pgadmin4` en modo escritorio (puerto
  5050), sin login de pgAdmin y con el servidor "ELO (Docker)" y su contraseña ya configurados (`servers.json` +
  passfile generados desde `.env`): abre directamente conectado a la base de datos.
- **Ayuda:** documentos del proyecto, los de `docs/` y enlaces a la documentación de ELO.
- **Imágenes instaladas:** tamaño, contenedores que las usan, copia `.tar`, restaurar desde `backup/`, borrar.
- **Licencia:** subir una nueva y aplicarla (vuelve a ejecutar `ix-setup` con ella y reinicia el servidor).
- **Enlaces:** Web Client, Admin Console, ELO WF, IX (estado / URL para Java Client y API), Tomcat manager, Automation
  Services, Flows, iSearch, pgAdmin y el propio instalador; datos para el perfil del Java Client.
- **Archivos en disco:** abrir en el explorador la carpeta de logs, el archivo de ELO (ficheros del repositorio), los
  datos de sistema del archivo y los del Index Server (volúmenes de Docker; en Windows vía `\\wsl.localhost`).

- **Interfaz:** inglés (por defecto), alemán y español; tema sistema/claro/oscuro (se recuerdan en el navegador).
- **Al abrir:** detecta una instalación existente (versión, repositorio, servicios en marcha) y ofrece ir a la administración.
- **Aprovisionamiento automático** (`provision.js`): WSL (`wsl --install`) + Ubuntu 24.04/Debian con usuario y systemd;
  Docker Desktop; Hyper-V (característica de Windows; no en ediciones Home); VirtualBox (instalador firmado de Oracle);
  y **VM Ubuntu 24.04 / Debian 13** en Hyper-V (Gen2, VHDX) o VirtualBox (VDI, NAT con puertos) a partir de la imagen
  cloud oficial convertida con `qemu-img` en WSL y configurada con cloud-init (usuario `elo`, clave SSH del instalador,
  sudo sin contraseña); la VM queda como destino SSH. Si hace falta reiniciar Windows, el asistente lo indica.
- **Pestaña Contenedores e imágenes:** todos los contenedores (estado, memoria, CPU, puertos, tamaño; arrancar, parar,
  reiniciar, eliminar) y las imágenes (copia, restaurar, borrar). La administración y esta pestaña guardan los datos
  hasta pulsar "Actualizar"; las acciones dependen del estado (Arrancar si está parado; Parar/Reiniciar si está en marcha).
- **Prueba de la API IX con curl:** página de estado del IX y login en la API JSON (`POST /<repo>/rest/IXServicePortIF/login`)
  como administrador; se muestra el comando `curl` (contraseña oculta), el código, el tiempo y la respuesta. En las
  imágenes ECK el resto de métodos de `/rest` responden 401/403 (reservados a servicios internos).

- **Versiones ordenadas:** las etiquetas `v<versión>-<major>.<minor>[.<bug>][-sufijo]` se listan de más reciente a más
  antigua (versión de ELO, major, minor, bug; la estable antes que `-beta`/`-debian`).
- **Caché local / repositorio local:** `elo.sh pull` usa primero la imagen de Docker, luego la caché `backup/*.tar`
  (`docker load`) y solo después descarga; `elo.sh cache` (y "Guardar esta versión en la caché local") guarda la pila
  completa como `.tar`. En el paso de imágenes cada versión se marca ● en Docker / ◆ en caché / ○ a descargar, con la
  disponibilidad de cada imagen; se puede instalar **sin registro** ("Usar solo imágenes locales"). Las imágenes cloud de
  las VMs también se cachean. "Contenedores e imágenes" muestra la caché y abre sus carpetas.
- **Comandos de terminal** de cada paso (desplegable al final; contraseñas enmascaradas).
- **Varias instancias de ELO a la vez** (p. ej. ELO 25 y ELO 23 en el mismo WSL/Docker): cada instancia es un proyecto de
  Compose con su nombre (`elo`, `elo23`…; `ELO_INSTANCE`), prefijo de contenedores, red, volúmenes y archivo de
  configuración propios (`.env` para `elo`, `instances/<nombre>/.env` para las demás). Los puertos del host son los
  estándar (9090, 9060, 9010, 9200/9204, 5050) y se pueden cambiar por instancia (`PORT_*`). En la configuración del
  asistente se elige nombre, puertos y, en WSL, el límite de memoria de la VM de WSL; si los puertos chocan con los de
  otra instancia (en marcha o configurada) se avisa y se ofrece un juego libre (+100, +200…). Al arrancar una instancia
  cuyos puertos están en uso se vuelve a avisar y se ofrece cambiarlos. Normalmente solo corre una pila a la vez;
  cada pila completa necesita unos 10 GB.
- **Última ejecución**: cada instalación o arranque guarda su registro en `last-run-<instancia>.log` junto a la
  instalación y lo termina con un diagnóstico por contenedor (`elo.sh diagnose`: memoria, eventos OOM del kernel, código
  de salida, "OOMKilled", puertos) y un resumen (correcta / con problemas / fallida). Se muestra al terminar la
  instalación y siempre en Administración ("Última ejecución"). `elo.sh pull` reintenta las descargas.
- **Eliminar instalaciones** (Administración → Eliminar): instancias de Docker (contenedores, volúmenes, configuración
  y, si se pide, imágenes que nadie más usa), VMs de Hyper-V/VirtualBox **creadas por el instalador** (VM y archivos) y
  los contenedores de ELO en Docker Desktop. Las VMs ajenas nunca se pueden borrar desde aquí.
- **Dónde está en disco**: cada fila tiene una sección con enlaces (📁) a las carpetas: volúmenes de Docker
  (`\\wsl.localhost\<distro>\var\lib\docker\volumes`), configuración, discos de la VM, datos de Docker Desktop.
- **Instalaciones de ELO en este equipo** (Administración): Docker en WSL/Linux, Docker Desktop, VMs de Hyper-V
  (marcando las creadas por el instalador), VMs de VirtualBox y el servidor SSH, con Arrancar/Parar según el estado.
  Los servicios de larga duración tienen `restart: unless-stopped`, así ELO arranca con la VM.
  Cada fila muestra RAM, IP y **espacio en disco** (discos virtuales de la VM, datos de Docker / Docker Desktop) y, si
  está en marcha, una fila desplegable con los **servicios** (contenedores ELO con estado y puertos) y los **puertos
  abiertos** (prueba TCP: SSH, RDP, WinRM, puertos de ELO, pgAdmin, PostgreSQL…; en VirtualBox, las redirecciones NAT).
  **Visor**: al arrancar (opcional) o con el botón, se abre la consola de Hyper-V (`vmconnect`), la ventana de
  VirtualBox (VM arrancada en modo `separate`), Docker Desktop o el ELO Web Client (Docker en WSL/SSH).
- **WSL** (Administración): memoria usada (vmmemWSL y dentro de Linux) y **Apagar WSL** (`wsl --shutdown` del usuario
  conectado) para liberar memoria; la tabla no arranca WSL solo para consultarlo.
- **Fuentes de caché** (Contenedores e imágenes → Configuración): carpetas, recursos de red (`\\servidor\recurso`,
  montados con drvfs) o URLs FTP/HTTP(S) con los `.tar` de las imágenes (mismos nombres que `backup/`). Se buscan tras la
  caché local y antes del registro; lo encontrado se copia a la caché local. `elo.sh sources` lista qué tiene cada fuente.
- **VM con Windows Server 2022/2025 (Hyper-V):** ISO de evaluación (180 días, en caché) o ISO propia, edición
  Standard/Datacenter con o sin escritorio, clave opcional. La imagen se aplica al VHDX con DISM + `unattend.xml` (hay
  que aceptar los términos de licencia de Microsoft en el asistente). Dentro: WSL2 (virtualización anidada) + Ubuntu
  24.04 con el usuario `elo` y la clave del instalador; una tarea de inicio redirige SSH y los puertos de ELO de la VM a
  Ubuntu, así los pasos siguientes instalan Docker y ELO como en cualquier Linux.
  Versiones: **2025, 2022** (con WSL2 → Docker + ELO) y **2019, 2016** (sin WSL2: la VM se crea solo con Windows).
  La tabla "ISOs de Windows Server" muestra siempre qué ISO está en caché (`C:\ProgramData\hvc-vms\cache`), permite
  descargarla a la caché, abrir la carpeta y guardarla desde el navegador (`/isos/<archivo>`); también se puede usar
  una ISO propia de esa carpeta u otra ruta. Volver a crear una VM con el mismo nombre la reanuda (p. ej. si no había
  RAM libre para arrancarla: la memoria estática que exige la virtualización anidada se comprueba antes de arrancar).
- **"Esta máquina Linux"** está deshabilitada cuando el instalador corre en Windows.
- **VirtualBox con Hyper-V activo:** VirtualBox usa entonces la capa NEM de Hyper-V y un invitado Linux puede quedarse
  colgado al arrancar (bloqueos RCU en el kernel). La VM se crea bien (puertos libres detectados, 2 puertos SATA), pero en
  este equipo no llegó a SSH; en un equipo sin Hyper-V funciona normal.

**Prueba de VM en Hyper-V (asistente):** Ubuntu 24.04.5, Gen2 + Secure Boot, 2 CPU / 8 GB / 40 GB, IP por el Default
Switch, SSH con la clave del instalador: **195 s** (imagen ya en caché). Docker instalado en la VM como trabajo remoto
por SSH en 33 s; parada/arranque desde la tabla de instalaciones correctos. La VM de prueba se eliminó después.

Diseño de los pasos (referencia):

### Pasos del asistente

1. **Bienvenida y destino** — Docker (WSL2 en Windows / Docker en Linux) o **Kubernetes** (operador ECK + Helm).
2. **Requisitos del sistema** — comprobar y, si falta, ofrecer instalar:
   - Programas: WSL2 + distro Linux (Windows), Docker Engine + compose (o Docker Desktop), `kubectl`/`helm` para K8s.
   - **Memoria libre** (la pila completa de ELO 25 necesita ~16 GB; Elasticsearch, TR2 con `shm_size: 5g`).
   - **Espacio en disco** (imágenes ~6 GB + volúmenes de datos).
   - `vm.max_map_count ≥ 262144` (Elasticsearch), puertos libres (9090, 9060, 9010, 9200, 9204…).
   - Acceso a `registry.elo.com` y a los servidores de licencias de ELO.
3. **Credenciales del registro** — usuario y **CLI secret**, con capturas de pantalla de dónde obtenerlo
   (registry.elo.com → perfil de usuario → *CLI secret*). Opcional: obtenerlo automáticamente con el login OIDC.
4. **Elegir imágenes** — el asistente **siempre lista en vivo** las imágenes y etiquetas del registro (como
   `registry-inventory.js`): línea ELO (20/21/23/25), estable/beta, tamaño, fecha, SO base, versiones de componentes.
   Selección de una versión coherente para toda la pila (p. ej. `v25-0.30.1`) y de los servicios opcionales
   (CMIS, Smart Link, ELO Sync, AI model processor, entity extraction, REST).
5. **Licencia** — subir el archivo (`.pk` clave privada para el servidor de licencias, o licencia en texto); validar
   formato y versión (licencia ELO 25 para imágenes v25).
6. **Configuración** — nombre del repositorio, idioma/locales, base de datos (PostgreSQL de prueba incluido o externo:
   PostgreSQL / MS SQL / Oracle), contraseñas generadas o propias, recursos (JVM, memoria por servicio).
7. **Descarga** — `docker pull` con progreso por imagen; **copia local** opcional (ver abajo).
8. **Instalación** — generar `docker-compose.yml`/`.env` (o manifiestos/valores de Helm), arrancar, seguir el
   `ix-setup` hasta que el repositorio esté creado.
9. **Pruebas** — comprobaciones automáticas: estado de cada contenedor, `ix?cmd=status`, Web Client, Admin Console,
   Elasticsearch `_cluster/health`, Textreader, login con el Administrador de ELO.
10. **Acceso y credenciales** — panel final (ver "Acceso desde fuera").

### Copia local y respaldo de imágenes

- Descargar las imágenes seleccionadas y **guardarlas en local** para usarlas como fuente aunque se borren del servidor:
  - `docker save` a archivos `.tar` (respaldo/offline; `docker load` para restaurar), y/o
  - **registro local** (`registry:2` o Harbor propio) con `docker tag` + `docker push`, usable como fuente alternativa
    en el asistente ("origen: registry.elo.com | registro local | archivos").
- Inventario local con las mismas columnas que el remoto y marca de "solo en local" si desaparecen del registro.

### Acceso desde fuera (como en el Hyper-V Configurator)

- Exponer los servicios del contenedor en la red del host (Docker publica los puertos; en WSL2, `portproxy` + firewall
  del host como ya hace el configurador para las VMs).
- Panel con enlaces y estado:
  - **Web Client** `http://<host>:9090/<repo>/plugin/de.elo.ix.plugin.proxy/web/`
  - **Admin Console** `http://<host>:9090/<repo>/plugin/de.elo.ix.plugin.proxy/ac/`
  - **Index Server / API** `http://<host>:9090/<repo>/ix?cmd=status`, REST (`eck-services/rest`)
  - Automation Services (`:9060`), Flows (`:9010`), Elasticsearch (`:9200`), Textreader
  - **ELO Java Client** (descarga/configuración apuntando al IX expuesto)
- **Credenciales de cada servicio** (desde `.env`, solo en el panel local): Administrador de ELO, usuario de servicio,
  usuario/contraseña de la base de datos, Tomcat, Karaf.
- Lanzar herramientas internas: logs por servicio, `ix-setup`/`ix-import` de nuevo, consola en el contenedor, pgAdmin
  contra la base de datos.

### Kubernetes

- Operador **ECK** (Helm chart de ELO) y recurso de repositorio; multitenencia (tenant + repositorio).
- El operador desactiva *scripting* y *plugins* por defecto: permitirlo explícitamente si se usan Business Solutions.
- Para pruebas locales: k3s/kind/Minikube o el Kubernetes de Docker Desktop.

### Enlaces ELO (escritorio y navegadores de las máquinas)

Panel **"Enlaces ELO"** dentro de "Acceso" de cada máquina (`installer/elolinks.js`, `/api/elolinks/{status,scan,apply}`).
Al abrir una máquina se comprueba sola y el botón **"Añadir enlaces ELO"** solo aparece si falta algo; es idempotente (lo
que ya existe no se duplica) y la simulación (`dryRun`) no toca nada.

| Máquina | Cómo llega | Escritorio | Navegadores |
|---|---|---|---|
| **Windows** (Hyper-V por PowerShell Direct; VirtualBox por guest control) | usuario/contraseña de la VM (se piden si no están guardados) | `.lnk`/`.url` en `C:\Users\Public\Desktop` para ELO Application Servers (`setup.bat --status`), Server Setup, Admin Console, Web Client, Workflow Client, Java Client, Dropzone, Desktop… solo lo que **se detecta** (carpeta `ELO` en cualquier unidad, puertos de `conf\server.xml`) | Carpeta **ELO** en la barra de marcadores de Chrome y Edge (edita `Bookmarks`, con copia `.bak-elo-installer`; con el navegador abierto se omite salvo "cerrar navegadores"); Firefox por `distribution\policies.json` |
| **Linux** (SSH: VM Hyper-V/VirtualBox, WSL) | SSH + `sudo`, requiere `python3` | `.desktop` en `~/Desktop` y en el menú de aplicaciones, URLs por instancia (`elo.sh`, `instances/*/.env`, o contenedores `eck-services/server` en ejecución) | Firefox: `/etc/firefox/policies/policies.json`; Chrome / Chromium: política gestionada `ManagedBookmarks` (carpeta "ELO") |

**Todos los marcadores van en una única carpeta "ELO"** de la barra de marcadores de cada navegador (Chrome/Edge: carpeta
`ELO`; Firefox: carpeta `ELO` en la barra de herramientas; Chrome/Chromium en Linux: carpeta gestionada "ELO").

**Requisitos (Linux):** el panel muestra qué hay (`python3`, módulo `venv`, `xdg-open`, `gio`) y, si falta algo, ofrece
**"Instalar requisitos"**: instala los paquetes con el gestor de la máquina (`apt-get`, `dnf`, `zypper` o `pacman`) y crea un
**venv privado** en `/opt/elo-installer/venv`, desde el que se ejecutan los scripts (solo biblioteca estándar); el python del
sistema no se toca. "Añadir enlaces" también los prepara solos si faltan. En Windows no hace falta instalar nada
(PowerShell Direct / guest control).

Probado: `Contelo 25` (Windows Server, ELO 25 nativo, Chrome + Edge) y WSL Ubuntu (ELO 23 en Docker, Firefox).

Pendiente de esta función:

- [ ] **Barra de tareas / panel:** anclar los accesos a la barra de tareas de Windows (Windows 10/11 no permite anclar por
      script de forma soportada; valorar un `LayoutModification.xml` para usuarios nuevos o la carpeta del menú Inicio) y a
      los paneles de Xfce / LXQt / GNOME (lanzadores del panel y favoritos de GNOME).
- [ ] Linux: comprobar la política de Firefox en Debian (`firefox-esr`) y en Snap, y en Chrome/Chromium con perfiles ya
      sincronizados; ampliar a Brave/Vivaldi.
- [ ] Hosts sin máquina virtual (Windows o Linux con ELO en Docker local): ofrecer lo mismo para el propio equipo.
- [ ] Contenedores con escritorio (`ctr:`): solo se admiten máquinas con SSH o Windows; añadir escritorios en contenedores.
- [ ] Windows invitado dentro de WSL no existe: lo que se ofrece en WSL es el escritorio **Linux** (Xfce/LXQt/GNOME). Si se
      quiere un Windows desde Linux hay que usar una VM Hyper-V/VirtualBox; valorar si se instala el escritorio automáticamente
      cuando una máquina Linux no lo tiene.
- [ ] Linux: detectar si no hay escritorio y ofrecer instalarlo antes de crear los lanzadores (hoy solo avisa).
- [ ] Certificados: las URLs `https://` de ELO con certificado propio muestran aviso en el navegador; valorar importar la CA.
- [ ] Pruebas automáticas (scripts de scan/apply con `testDir` ya soportado en Windows).

### Pendiente

- [ ] Probar la pila completa con la licencia ELO 25 (`elo.sh up`) y documentar tiempos, memoria y URLs reales.
- [ ] Backend del asistente (detección de requisitos, inventario, pull con progreso, generación de compose, pruebas).
- [ ] Frontend del asistente (pasos, capturas de ayuda, progreso, panel final).
- [ ] Copia local / registro local y respaldo `docker save`.
- [ ] Exposición de puertos y panel de acceso/credenciales.
- [ ] Variante Kubernetes (ECK + Helm).
