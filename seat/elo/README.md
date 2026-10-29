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

## Instalador web (a desarrollar)

Asistente moderno paso a paso (frontend web; backend Node, PowerShell o Python) que explica en cada paso qué hace y
muestra el progreso de forma visual. Primero se valida todo con una instalación manual (ver "Estado actual").

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

### Pendiente

- [ ] Probar la pila completa con la licencia ELO 25 (`elo.sh up`) y documentar tiempos, memoria y URLs reales.
- [ ] Backend del asistente (detección de requisitos, inventario, pull con progreso, generación de compose, pruebas).
- [ ] Frontend del asistente (pasos, capturas de ayuda, progreso, panel final).
- [ ] Copia local / registro local y respaldo `docker save`.
- [ ] Exposición de puertos y panel de acceso/credenciales.
- [ ] Variante Kubernetes (ECK + Helm).
