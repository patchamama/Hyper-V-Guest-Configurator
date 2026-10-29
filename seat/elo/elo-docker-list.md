# ELO container images (registry.elo.com)

Generated 2026-10-29 20:03 UTC from https://registry.elo.com (Harbor v2.7.4-8693b25a) with
`tools/registry-inventory.js` + `tools/inventory-md.js`. Requires an ELO partner/customer login; the list may change.

- **Registry web UI:** https://registry.elo.com → "Login via OIDC provider" → project **eck-services**
- **Pull:** `docker login registry.elo.com -u <user> --password-stdin` (CLI secret from the registry user profile), then `docker pull registry.elo.com/eck-services/<image>:<tag>`
- **Docs:** https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/ (ELO login)
- **Platform:** all images are `linux/amd64` (no Windows images); base distro shown per image (Wolfi OS for current ELO 25).

## Project `eck-services` — 30 images

| Image | ELO lines | Latest stable ELO 25 | Latest tag | Size | Updated | Pulls | Base | Links |
|---|---|---|---|---|---|---|---|---|
| [`ix-import`](#ix-import) | 25, 23, 21, 20 | `v25-0.30.1` | `v25-1.0.0-beta` | 241 MB | 2026-10-16 | 13237 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/ix-import/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-ix-import.html) |
| [`search`](#search) | 25, 23, 21, 20 | `v25-1.0` | `v25-1.0` | 1.08 GB | 2026-10-16 | 12629 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/search/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-search.html) |
| [`server`](#server) | 25, 23, 21 | `v25-0.30.1` | `v25-1.0.0-beta` | 1.15 GB | 2026-10-16 | 12294 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/server/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-server.html) |
| [`ix-setup`](#ix-setup) | 25, 23, 21, 20 | `v25-0.30.1` | `v25-1.0.0-beta` | 1.05 GB | 2026-10-16 | 11895 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/ix-setup/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-ix-setup.html) |
| [`flows-worker`](#flows-worker) | 25, 23, 21 | `v25-0.30.1` | `v25-1.0.0-beta` | 354 MB | 2026-10-16 | 10792 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/flows-worker/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-flows-worker.html) |
| [`flows`](#flows) | 25, 23, 21 | `v25-0.30.1` | `v25-1.0.0-beta` | 341 MB | 2026-10-16 | 10728 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/flows/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-flows.html) |
| [`as`](#as) | 25, 23, 21, 20 | `v25-0.30.1` | `v25-1.0.0-beta` | 528 MB | 2026-10-16 | 9909 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/as/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-as.html) |
| [`tr2`](#tr2) | 25, 23, 21 | `v25-0.30.1` | `v25-1.0.0-beta` | 1.94 GB | 2026-10-16 | 6849 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/tr2/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-tr2.html) |
| [`ix`](#ix) | 25, 23, 21, 20 | `v25-0.30.1` | `v25-1.0.0-beta` | 995 MB | 2026-10-16 | 3448 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/ix/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-ix.html) |
| [`postgresql`](#postgresql) | — | — | `nightly` | 91 MB | 2021-10-14 | 3426 |  | [registry](https://registry.elo.com/harbor/projects/2/repositories/postgresql/artifacts-tab) |
| [`ui`](#ui) | 25, 23, 21, 20 | `v25-0.30.1` | `v25-1.0.0-beta` | 375 MB | 2026-10-16 | 3393 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/ui/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-ui.html) |
| [`busybox`](#busybox) | — | — | `1.32.0` | 1 MB | 2021-07-12 | 1572 |  | [registry](https://registry.elo.com/harbor/projects/2/repositories/busybox/artifacts-tab) |
| [`rest`](#rest) | 23, 21, 20 | — | `v23-0.30` | 230 MB | 2026-09-22 | 1486 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/rest/artifacts-tab) |
| [`cv`](#cv) | 21, 20 | — | `v20-0.3` | 381 MB | 2024-04-12 | 1311 | debian:12.5-slim | [registry](https://registry.elo.com/harbor/projects/2/repositories/cv/artifacts-tab) |
| [`sl`](#sl) | 25, 23, 21 | `v25-0.30.1` | `v25-1.0.0-beta` | 256 MB | 2026-10-16 | 903 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/sl/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-sl.html) |
| [`traefik`](#traefik) | 2 | — | `v2.10.0` | 41 MB | 2024-01-19 | 823 |  | [registry](https://registry.elo.com/harbor/projects/2/repositories/traefik/artifacts-tab) |
| [`ocr-setup`](#ocr-setup) | 21, 20 | — | `v20-0.3` | 231 MB | 2024-04-12 | 643 | debian:12.5-slim | [registry](https://registry.elo.com/harbor/projects/2/repositories/ocr-setup/artifacts-tab) |
| [`ocr`](#ocr) | 21, 20 | — | `v20-0.3` | 847 MB | 2024-04-12 | 619 | debian:12.5-slim | [registry](https://registry.elo.com/harbor/projects/2/repositories/ocr/artifacts-tab) |
| [`flows-registry`](#flows-registry) | 25, 23 | `v25-0.30.1` | `v25-1.0.0-beta` | 253 MB | 2026-10-16 | 578 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/flows-registry/artifacts-tab) |
| [`flows-worker-base`](#flows-worker-base) | 25, 23 | `v25-0.30.1` | `v25-1.0.0-beta` | 273 MB | 2026-10-16 | 457 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/flows-worker-base/artifacts-tab) |
| [`cmis`](#cmis) | 25, 23 | `v25-0.30.1` | `v25-1.0.0-beta` | 252 MB | 2026-10-16 | 376 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/cmis/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-cmis.html) |
| [`elo-sync`](#elo-sync) | 25, 23 | `v25-0.30.1` | `v25-1.0.0-beta` | 236 MB | 2026-10-16 | 155 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/elo-sync/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-elo-sync.html) |
| [`model-processor`](#model-processor) | 25 | — | `v25-1.0.0-beta` | 253 MB | 2026-10-16 | 52 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/model-processor/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/en-us/administration-docker/images/cloud-mp.html) |
| [`entity-extraction-service`](#entity-extraction-service) | 25 | — | `v25-1.0.0-beta` | 371 MB | 2026-10-16 | 51 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/entity-extraction-service/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/en-us/administration-docker/images/cloud-ees.html) |
| [`aio`](#aio) | 23 | — | `v23-3.2` | 2.07 GB | 2024-07-09 | 46 | debian:12.2-slim | [registry](https://registry.elo.com/harbor/projects/2/repositories/aio/artifacts-tab) |
| [`postgresql-exporter`](#postgresql-exporter) | — | — | `12.5.0` | 43 MB | 2021-10-14 | 45 |  | [registry](https://registry.elo.com/harbor/projects/2/repositories/postgresql-exporter/artifacts-tab) |
| [`rp`](#rp) | 21, 20 | — | `v21-3.0` | 163 MB | 2022-10-21 | 25 | debian:11.5-slim | [registry](https://registry.elo.com/harbor/projects/2/repositories/rp/artifacts-tab) |
| [`analytics`](#analytics) | 21 | — | `v21-1.0` | 360 MB | 2021-12-16 | 20 |  | [registry](https://registry.elo.com/harbor/projects/2/repositories/analytics/artifacts-tab) |
| [`imo`](#imo) | — | — | `20.00.002-0.1` | 149 MB | 2020-11-05 | 6 |  | [registry](https://registry.elo.com/harbor/projects/2/repositories/imo/artifacts-tab) |
| [`replication`](#replication) | — | — | — |  |  | 1 |  | [registry](https://registry.elo.com/harbor/projects/2/repositories/replication/artifacts-tab) |

### ix-import

`registry.elo.com/eck-services/ix-import` · 138 tagged versions · 13237 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/ix-import/artifacts-tab) · [ELO docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-ix-import.html)

Import routine for the Index Server: imports thesaurus and dropzone.

Latest `v25-1.0.0-beta` (2026-10-16, 241 MB): OS/arch: linux/amd64 · base: wolfiOS · OpenJDK 25.0.4 (openj9) · locales: 7

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `v25-1.0.0-beta` | 241 MB | 2026-10-16 |  |
| `v25-0.30.1` | 221 MB | 2026-09-22 |  |
| `v25-0.30.0` | 219 MB | 2026-08-14 |  |
| `v25-0.3.2` | 219 MB | 2026-07-20 |  |
| `v23-0.34` | 214 MB | 2026-09-22 |  |
| `v23-0.34-debian` | 223 MB | 2026-09-22 |  |
| `v23-0.33-debian` | 210 MB | 2026-08-14 |  |
| `v23-0.33` | 212 MB | 2026-08-14 |  |
| `v21-4.4` | 159 MB | 2023-02-22 |  |
| `v21-4.3` | 159 MB | 2023-02-22 |  |
| `v21-4.2` | 159 MB | 2023-02-14 |  |
| `v21-4.1` | 159 MB | 2023-01-18 |  |
| `v20-0.9` | 189 MB | 2024-04-12 |  |
| `v20-0.8` | 171 MB | 2023-01-11 |  |
| `v20-0.7` | 155 MB | 2022-05-10 |  |
| `v20-0.6` | 157 MB | 2022-03-07 |  |

### search

`registry.elo.com/eck-services/search` · 76 tagged versions · 12629 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/search/artifacts-tab) · [ELO docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-search.html)

ELO iSearch (Elasticsearch 8 from v25): full-text and other search functions. Needs vm.max_map_count ≥ 262144.

Latest `v25-1.0` (2026-10-16, 1.08 GB): OS/arch: linux/amd64 · base: wolfiOS · OpenJDK 25.0.4 (openj9) · locales: 7

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `20-0.0.0` | 172 MB | 2021-02-04 |  |
| `20-0.0` | 172 MB | 2021-02-04 |  |
| `20.00.000-0.4` | 172 MB | 2021-01-18 |  |
| `20.00.000-0.1` | 160 MB | 2020-10-01 |  |
| `v25-1.0` | 1.08 GB | 2026-10-16 |  |
| `v25-0.7` | 584 MB | 2026-09-22 |  |
| `v25-0.6` | 583 MB | 2026-08-14 |  |
| `v25-0.5` | 582 MB | 2026-04-27 |  |
| `v23-0.22` | 380 MB | 2026-09-22 |  |
| `v23-0.21` | 378 MB | 2026-08-14 |  |
| `v23-0.20` | 376 MB | 2026-05-18 |  |
| `v23-0.19` | 374 MB | 2026-04-07 |  |
| `v21-4.5` | 322 MB | 2023-06-07 |  |
| `v21-4.4` | 319 MB | 2023-03-24 |  |
| `v21-4.3` | 367 MB | 2023-03-08 |  |
| `v21-4.2` | 367 MB | 2023-01-23 |  |
| `v20-0.9` | 191 MB | 2022-07-21 |  |
| `v20-0.8` | 191 MB | 2022-07-21 |  |
| `v20-0.7` | 176 MB | 2022-05-10 |  |
| `v20-0.6` | 176 MB | 2022-02-02 |  |

### server

`registry.elo.com/eck-services/server` · 118 tagged versions · 12294 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/server/artifacts-tab) · [ELO docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-server.html)

ELO Index Server + Admin Console + Web Client + Web Forms Services; frontend for all connections, API calls and web services. Replaces `ix` and `ui` (from 21-3).

Latest `v25-1.0.0-beta` (2026-10-16, 1.15 GB): OS/arch: linux/amd64 · base: wolfiOS · OpenJDK 25.0.4 (openj9) · Tomcat 11.0.27 · AC 25.01.000.671748 · IX 25.01.000.687862 · WEB 25.01.002.2487 · WF 25.01.001.8061-bfecbd55 · locales: 7

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `v25-1.0.0-beta` | 1.15 GB | 2026-10-16 | 25.01.000.687862 |
| `v25-0.30.1` | 1.03 GB | 2026-09-22 | 25.00.032.665955 |
| `v25-0.30.0` | 1.04 GB | 2026-08-14 | 25.00.030.637444 |
| `v25-0.3.2` | 1.04 GB | 2026-07-20 | 25.00.023.615397 |
| `v23-0.34` | 700 MB | 2026-09-22 | 23.00.032.665716 |
| `v23-0.34-debian` | 709 MB | 2026-09-22 | 23.00.032.665716 |
| `v23-0.33-debian` | 710 MB | 2026-08-14 | 23.00.030.637445 |
| `v23-0.33` | 711 MB | 2026-08-14 | 23.00.030.637445 |
| `v21-4.4` | 595 MB | 2023-02-22 | 21.04.001.562495 |
| `v21-4.3` | 595 MB | 2023-02-22 | 21.04.001.562495 |
| `v21-4.2` | 645 MB | 2023-02-14 | 21.04.000.510365 |
| `v21-4.1` | 645 MB | 2023-01-18 | 21.04.000.510365 |

### ix-setup

`registry.elo.com/eck-services/ix-setup` · 143 tagged versions · 11895 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/ix-setup/artifacts-tab) · [ELO docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-ix-setup.html)

Setup routine for the Index Server; init container that creates/updates the repository (PostgreSQL or MS SQL Server). Takes the ELO license.

Latest `v25-1.0.0-beta` (2026-10-16, 1.05 GB): OS/arch: linux/amd64 · base: wolfiOS · OpenJDK 25.0.4 (openj9) · Tomcat 11.0.27 · IX 25.01.000.687862 · locales: 7

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `20.01.000-0.4-hot` | 367 MB | 2021-01-18 |  |
| `20.01.000-0.4` | 367 MB | 2021-01-18 |  |
| `20.01.000-latest-hot` | 361 MB | 2020-10-01 |  |
| `20.01.000-0.1-hot` | 361 MB | 2020-10-01 |  |
| `v25-1.0.0-beta` | 1.05 GB | 2026-10-16 | 25.01.000.687862 |
| `v25-0.30.1` | 923 MB | 2026-09-22 | 25.00.032.665955 |
| `v25-0.30.0` | 941 MB | 2026-08-14 | 25.00.030.637444 |
| `v25-0.3.2` | 940 MB | 2026-07-20 | 25.00.023.615397 |
| `v23-0.34` | 597 MB | 2026-09-22 | 23.00.032.665716 |
| `v23-0.34-debian` | 606 MB | 2026-09-22 | 23.00.032.665716 |
| `v23-0.33-debian` | 607 MB | 2026-08-14 | 23.00.030.637445 |
| `v23-0.33` | 608 MB | 2026-08-14 | 23.00.030.637445 |
| `v21-4.4` | 511 MB | 2023-02-22 | 21.04.001.562495 |
| `v21-4.3` | 511 MB | 2023-02-22 | 21.04.001.562495 |
| `v21-4.2` | 560 MB | 2023-02-14 | 21.04.000.510365 |
| `v21-4.1` | 560 MB | 2023-01-18 | 21.04.000.510365 |
| `v20-0.9` | 486 MB | 2024-04-12 |  |
| `v20-0.8` | 456 MB | 2023-01-11 |  |
| `v20-0.7` | 419 MB | 2022-05-10 |  |
| `v20-0.6` | 420 MB | 2022-03-07 |  |

### flows-worker

`registry.elo.com/eck-services/flows-worker` · 110 tagged versions · 10792 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/flows-worker/artifacts-tab) · [ELO docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-flows-worker.html)

ELO Flows worker (Karaf).

Latest `v25-1.0.0-beta` (2026-10-16, 354 MB): OS/arch: linux/amd64 · base: wolfiOS · OpenJDK 25.0.4 (openj9) · locales: 7

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `v25-1.0.0-beta` | 354 MB | 2026-10-16 |  |
| `v25-0.30.1` | 306 MB | 2026-09-22 |  |
| `v25-0.30.0` | 305 MB | 2026-08-14 |  |
| `v25-0.3.3` | 305 MB | 2026-07-20 |  |
| `v23-0.29` | 242 MB | 2026-09-22 |  |
| `v23-0.29-debian` | 252 MB | 2026-09-22 |  |
| `v23-0.28-debian` | 239 MB | 2026-08-14 |  |
| `v23-0.28` | 240 MB | 2026-08-14 |  |
| `v21-4.2` | 472 MB | 2023-02-22 |  |
| `v21-4.1` | 473 MB | 2022-12-22 |  |
| `v21-3.0` | 470 MB | 2022-10-21 |  |
| `v21-2.4` | 169 MB | 2022-07-06 |  |

### flows

`registry.elo.com/eck-services/flows` · 110 tagged versions · 10728 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/flows/artifacts-tab) · [ELO docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-flows.html)

ELO Flows manager and service.

Latest `v25-1.0.0-beta` (2026-10-16, 341 MB): OS/arch: linux/amd64 · base: wolfiOS · OpenJDK 25.0.4 (openj9) · Tomcat 11.0.27 · locales: 7

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `v25-1.0.0-beta` | 341 MB | 2026-10-16 |  |
| `v25-0.30.1` | 322 MB | 2026-09-22 |  |
| `v25-0.30.0` | 320 MB | 2026-08-14 |  |
| `v25-0.3.3` | 320 MB | 2026-07-20 |  |
| `v23-0.29` | 284 MB | 2026-09-22 |  |
| `v23-0.29-debian` | 293 MB | 2026-09-22 |  |
| `v23-0.28-debian` | 280 MB | 2026-08-14 |  |
| `v23-0.28` | 282 MB | 2026-08-14 |  |
| `v21-4.1` | 209 MB | 2023-02-22 |  |
| `v21-4.0` | 209 MB | 2022-12-21 |  |
| `v21-3.0` | 209 MB | 2022-10-21 |  |
| `v21-2.4` | 198 MB | 2022-07-06 |  |

### as

`registry.elo.com/eck-services/as` · 118 tagged versions · 9909 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/as/artifacts-tab) · [ELO docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-as.html)

ELO Automation Services: build automated tasks in ELO.

Latest `v25-1.0.0-beta` (2026-10-16, 528 MB): OS/arch: linux/amd64 · base: wolfiOS · OpenJDK 25.0.4 (openj9) · Tomcat 11.0.27 · locales: 7

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `20.00.000-0.4-hot` | 372 MB | 2021-01-18 |  |
| `20.00.000-0.4` | 354 MB | 2021-01-18 |  |
| `latest` | 353 MB | 2020-10-01 |  |
| `20.00.000-latest` | 353 MB | 2020-10-01 |  |
| `v25-1.0.0-beta` | 528 MB | 2026-10-16 |  |
| `v25-0.30.1` | 509 MB | 2026-09-22 |  |
| `v25-0.30.0` | 508 MB | 2026-08-14 |  |
| `v25-0.3.2` | 508 MB | 2026-07-20 |  |
| `v23-0.29` | 476 MB | 2026-09-22 |  |
| `v23-0.29-debian` | 485 MB | 2026-09-22 |  |
| `v23-0.28-debian` | 473 MB | 2026-08-14 |  |
| `v23-0.28` | 474 MB | 2026-08-14 |  |
| `v21-4.1` | 389 MB | 2023-02-22 |  |
| `v21-4.0` | 388 MB | 2022-12-21 |  |
| `v21-3.0` | 391 MB | 2022-10-21 |  |
| `v21-2.4` | 385 MB | 2022-07-06 |  |
| `v20-0.4` | 416 MB | 2024-04-12 |  |
| `v20-0.3` | 375 MB | 2022-06-03 |  |
| `v20-0.2` | 372 MB | 2022-05-10 |  |
| `v20.lts-1.0.0` | 354 MB | 2021-12-16 |  |

### tr2

`registry.elo.com/eck-services/tr2` · 100 tagged versions · 6849 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/tr2/artifacts-tab) · [ELO docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-tr2.html)

Textreader 2 + OCR: analyzes documents for full-text extraction (replaces cv, ocr, ocr-setup from 21-4).

Latest `v25-1.0.0-beta` (2026-10-16, 1.94 GB): OS/arch: linux/amd64 · base: wolfiOS · OpenJDK 25.0.4 (openj9) · locales: 7

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `v25-1.0.0-beta` | 1.94 GB | 2026-10-16 |  |
| `v25-0.30.1` | 1.93 GB | 2026-09-22 |  |
| `v25-0.30.0` | 1.93 GB | 2026-08-14 |  |
| `v25-0.3.2` | 1.92 GB | 2026-07-20 |  |
| `v23-0.30` | 1.92 GB | 2026-09-22 |  |
| `v23-0.30-debian` | 1.94 GB | 2026-09-22 |  |
| `v23-0.29-debian` | 1.93 GB | 2026-08-14 |  |
| `v23-0.29` | 1.92 GB | 2026-08-14 |  |
| `v21-4.2` | 887 MB | 2023-02-22 |  |
| `v21-4.1` | 887 MB | 2023-01-18 |  |
| `v21-4.0` | 891 MB | 2022-12-21 |  |

### ix

`registry.elo.com/eck-services/ix` · 144 tagged versions · 3448 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/ix/artifacts-tab) · [ELO docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-ix.html)

ELO Index Server; frontend for connections, API calls and ELO web services (older split setup; superseded by `server`).

Latest `v25-1.0.0-beta` (2026-10-16, 995 MB): OS/arch: linux/amd64 · base: wolfiOS · OpenJDK 25.0.4 (openj9) · Tomcat 11.0.27 · IX 25.01.000.687862 · locales: 7

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `20.01.000-0.4-hot` | 326 MB | 2021-01-18 |  |
| `20.01.000-0.4` | 326 MB | 2021-01-18 |  |
| `20.01.000-0.1-hot` | 324 MB | 2020-10-01 |  |
| `20.01.000-0.1` | 324 MB | 2020-10-01 |  |
| `v25-1.0.0-beta` | 995 MB | 2026-10-16 | 25.01.000.687862 |
| `v25-0.30.1` | 870 MB | 2026-09-22 | 25.00.032.665955 |
| `v25-0.30.0` | 889 MB | 2026-08-14 | 25.00.030.637444 |
| `v25-0.3.2` | 888 MB | 2026-07-20 | 25.00.023.615397 |
| `v23-0.34-debian` | 555 MB | 2026-09-22 | 23.00.032.665716 |
| `v23-0.34` | 545 MB | 2026-09-22 | 23.00.032.665716 |
| `v23-0.33-debian` | 556 MB | 2026-08-14 | 23.00.030.637445 |
| `v23-0.33` | 557 MB | 2026-08-14 | 23.00.030.637445 |
| `v21-4.4` | 466 MB | 2023-02-22 | 21.04.001.562495 |
| `v21-4.3` | 466 MB | 2023-02-22 | 21.04.001.562495 |
| `v21-4.2` | 515 MB | 2023-02-14 | 21.04.000.510365 |
| `v21-4.1` | 515 MB | 2023-01-18 | 21.04.000.510365 |
| `v20-0.9` | 441 MB | 2024-04-12 |  |
| `v20-0.8` | 413 MB | 2023-01-11 |  |
| `v20-0.7` | 376 MB | 2022-05-10 |  |
| `v20-0.6` | 379 MB | 2022-03-07 |  |

### postgresql

`registry.elo.com/eck-services/postgresql` · 7 tagged versions · 3426 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/postgresql/artifacts-tab)

Standard PostgreSQL image, for testing only.

Latest `nightly` (2021-10-14, 91 MB): OS/arch: linux/amd64

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `nightly` | 91 MB | 2021-10-14 |  |
| `12.5.0` | 91 MB | 2021-10-14 |  |
| `12.5.0-nightly` | 89 MB | 2021-01-13 |  |
| `nightly-MosbachN-master-patch-47176` | 89 MB | 2021-01-13 |  |

### ui

`registry.elo.com/eck-services/ui` · 126 tagged versions · 3393 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/ui/artifacts-tab) · [ELO docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-ui.html)

ELO user interface: Web Client, ELO WF and Administration Console (older split setup; superseded by `server`).

Latest `v25-1.0.0-beta` (2026-10-16, 375 MB): OS/arch: linux/amd64 · base: wolfiOS · OpenJDK 25.0.4 (openj9) · Tomcat 11.0.27 · AC 25.01.000.671748 · WEB 25.01.002.2487 · WF 25.01.001.8061-bfecbd55 · locales: 7

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `20.01.000-0.4-hot` | 306 MB | 2021-01-18 |  |
| `20.01.000-0.4` | 280 MB | 2021-01-18 |  |
| `20.00.000-0.1-hot` | 270 MB | 2020-10-01 |  |
| `20.00.000-0.1` | 244 MB | 2020-10-01 |  |
| `v25-1.0.0-beta` | 375 MB | 2026-10-16 |  |
| `v25-0.30.1` | 358 MB | 2026-09-22 |  |
| `v25-0.30.0` | 356 MB | 2026-08-14 |  |
| `v25-0.3.2` | 354 MB | 2026-07-20 |  |
| `v23-0.31-debian` | 360 MB | 2026-09-22 |  |
| `v23-0.31` | 351 MB | 2026-09-22 |  |
| `v23-0.30-debian` | 347 MB | 2026-08-14 |  |
| `v23-0.30` | 349 MB | 2026-08-14 |  |
| `v21-4.2` | 265 MB | 2023-02-22 |  |
| `v21-4.1` | 265 MB | 2023-01-18 |  |
| `v21-4.0` | 265 MB | 2022-12-21 |  |
| `v21-3.0` | 263 MB | 2022-10-21 |  |
| `v20-0.6` | 326 MB | 2024-04-12 |  |
| `v20-0.5` | 288 MB | 2022-06-03 |  |
| `v20-0.4` | 289 MB | 2022-05-10 |  |
| `v20-0.3` | 289 MB | 2022-03-07 |  |

### busybox

`registry.elo.com/eck-services/busybox` · 1 tagged versions · 1572 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/busybox/artifacts-tab)

BusyBox helper image.

Latest `1.32.0`, `1.32.0-967177ed` (2021-07-12, 1 MB): OS/arch: linux/amd64

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `1.32.0` | 1 MB | 2021-07-12 |  |
| `1.32.0-967177ed` | 1 MB | 2021-07-12 |  |

### rest

`registry.elo.com/eck-services/rest` · 91 tagged versions · 1486 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/rest/artifacts-tab)

ELO REST service.

Latest `v23-0.30` (2026-09-22, 230 MB): OS/arch: linux/amd64 · base: wolfiOS · OpenJDK 17.0.20 (openj9) · Tomcat 10.1.60 · locales: 7

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `v23-0.30` | 230 MB | 2026-09-22 |  |
| `v23-0.30-debian` | 239 MB | 2026-09-22 |  |
| `v23-0.29-debian` | 226 MB | 2026-08-14 |  |
| `v23-0.29` | 228 MB | 2026-08-14 |  |
| `v21-4.0` | 164 MB | 2022-12-21 |  |
| `v21-3.0` | 163 MB | 2022-10-21 |  |
| `v21-2.3` | 158 MB | 2022-07-06 |  |
| `v21-2.2` | 154 MB | 2022-05-10 |  |
| `v20-0.4` | 192 MB | 2024-04-12 |  |
| `v20-0.3` | 154 MB | 2022-05-10 |  |
| `v20-0.2` | 155 MB | 2022-04-05 |  |
| `v20-0.1` | 154 MB | 2022-02-02 |  |

### cv

`registry.elo.com/eck-services/cv` · 14 tagged versions · 1311 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/cv/artifacts-tab)

Content viewer/converter (legacy; replaced by tr2 from 21-4).

Latest `v20-0.3` (2024-04-12, 381 MB): OS/arch: linux/amd64 · base: debian:12.5-slim · OpenJDK 17.0.10 (openj9) · locales: 7

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `20.00.002-0.4` | 312 MB | 2021-01-18 |  |
| `20.00.002-0.1` | 313 MB | 2020-10-01 |  |
| `v21-3.0` | 371 MB | 2022-10-21 |  |
| `v21-2.4` | 374 MB | 2022-09-09 |  |
| `v21-2.3` | 374 MB | 2022-09-08 |  |
| `v21-2.2` | 355 MB | 2022-05-10 |  |
| `v20-0.3` | 381 MB | 2024-04-12 |  |
| `v20-0.2` | 341 MB | 2022-05-10 |  |
| `v20-0.1` | 342 MB | 2021-07-29 |  |
| `v20-0.0` | 324 MB | 2021-06-30 |  |

### sl

`registry.elo.com/eck-services/sl` · 98 tagged versions · 903 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/sl/artifacts-tab) · [ELO docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-sl.html)

ELO Smart Link service.

Latest `v25-1.0.0-beta` (2026-10-16, 256 MB): OS/arch: linux/amd64 · base: wolfiOS · OpenJDK 25.0.4 (openj9) · Tomcat 11.0.27 · locales: 7

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `v25-1.0.0-beta` | 256 MB | 2026-10-16 |  |
| `v25-0.30.1` | 240 MB | 2026-09-22 |  |
| `v25-0.30.0` | 236 MB | 2026-08-14 |  |
| `v25-0.3.2` | 241 MB | 2026-07-20 |  |
| `v23-0.29-debian` | 243 MB | 2026-09-22 |  |
| `v23-0.29` | 234 MB | 2026-09-22 |  |
| `v23-0.28-debian` | 229 MB | 2026-08-14 |  |
| `v23-0.28` | 230 MB | 2026-08-14 |  |
| `v21-4.1` | 185 MB | 2023-02-22 |  |
| `v21-4.0` | 185 MB | 2023-01-18 |  |
| `v21-3.0` | 184 MB | 2022-10-21 |  |

### traefik

`registry.elo.com/eck-services/traefik` · 7 tagged versions · 823 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/traefik/artifacts-tab)

Traefik reverse proxy / ingress used by ECK.

Latest `v2.10.0` (2024-01-19, 41 MB): OS/arch: linux/amd64

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `v2.10.0` | 41 MB | 2024-01-19 |  |
| `v2.10.1` | 41 MB | 2024-01-19 |  |
| `v2.10.3` | 41 MB | 2024-01-19 |  |
| `v2.10.4` | 42 MB | 2024-01-19 |  |

### ocr-setup

`registry.elo.com/eck-services/ocr-setup` · 13 tagged versions · 643 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/ocr-setup/artifacts-tab)

OCR setup (legacy; replaced by tr2 from 21-4).

Latest `v20-0.3` (2024-04-12, 231 MB): OS/arch: linux/amd64 · base: debian:12.5-slim · OpenJDK 17.0.10 (openj9) · locales: 7

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `20.00.000-0.4` | 172 MB | 2021-01-18 |  |
| `20.00.000-0.1` | 912 MB | 2020-11-17 |  |
| `v21-3.0` | 205 MB | 2022-10-21 |  |
| `v21-2.3` | 203 MB | 2022-07-06 |  |
| `v21-2.2` | 199 MB | 2022-05-10 |  |
| `v21-2.1` | 198 MB | 2022-04-20 |  |
| `v20-0.3` | 231 MB | 2024-04-12 |  |
| `v20-0.2` | 198 MB | 2022-05-10 |  |
| `v20-0.1` | 177 MB | 2021-07-29 |  |
| `v20-0.0` | 163 MB | 2021-06-30 |  |

### ocr

`registry.elo.com/eck-services/ocr` · 13 tagged versions · 619 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/ocr/artifacts-tab)

OCR service (legacy; replaced by tr2 from 21-4).

Latest `v20-0.3` (2024-04-12, 847 MB): OS/arch: linux/amd64 · base: debian:12.5-slim · OpenJDK 17.0.10 (openj9) · locales: 7

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `20.02.000-0.4` | 788 MB | 2021-01-18 |  |
| `20.00.000-0.1` | 786 MB | 2020-11-17 |  |
| `v21-3.0` | 846 MB | 2022-10-21 |  |
| `v21-2.3` | 812 MB | 2022-07-06 |  |
| `v21-2.2` | 808 MB | 2022-05-10 |  |
| `v21-2.1` | 807 MB | 2022-04-20 |  |
| `v20-0.3` | 847 MB | 2024-04-12 |  |
| `v20-0.2` | 807 MB | 2022-05-10 |  |
| `v20-0.1` | 804 MB | 2021-08-06 |  |
| `v20-0.0` | 743 MB | 2021-06-30 |  |

### flows-registry

`registry.elo.com/eck-services/flows-registry` · 50 tagged versions · 578 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/flows-registry/artifacts-tab)

Registry for ELO Flows components.

Latest `v25-1.0.0-beta` (2026-10-16, 253 MB): OS/arch: linux/amd64 · base: wolfiOS · OpenJDK 25.0.4 (openj9) · Tomcat 11.0.27 · locales: 7

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `v25-1.0.0-beta` | 253 MB | 2026-10-16 |  |
| `v25-0.30.1` | 234 MB | 2026-09-22 |  |
| `v25-0.30.0` | 232 MB | 2026-08-14 |  |
| `v25-0.3.3` | 232 MB | 2026-07-20 |  |
| `v23-6.6` | 217 MB | 2025-10-22 |  |
| `v23-6.5` | 212 MB | 2025-09-09 |  |
| `v23-6.4` | 211 MB | 2025-07-22 |  |
| `v23-6.3` | 211 MB | 2025-06-03 |  |

### flows-worker-base

`registry.elo.com/eck-services/flows-worker-base` · 50 tagged versions · 457 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/flows-worker-base/artifacts-tab)

Base image for ELO Flows workers.

Latest `v25-1.0.0-beta` (2026-10-16, 273 MB): OS/arch: linux/amd64 · base: wolfiOS · OpenJDK 25.0.4 (openj9) · locales: 7

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `v25-1.0.0-beta` | 273 MB | 2026-10-16 |  |
| `v25-0.30.1` | 256 MB | 2026-09-22 |  |
| `v25-0.30.0` | 254 MB | 2026-08-14 |  |
| `v25-0.3.3` | 254 MB | 2026-07-20 |  |
| `v23-6.6` | 234 MB | 2025-10-22 |  |
| `v23-6.5` | 228 MB | 2025-09-09 |  |
| `v23-6.4` | 228 MB | 2025-07-22 |  |
| `v23-6.3` | 227 MB | 2025-06-03 |  |

### cmis

`registry.elo.com/eck-services/cmis` · 55 tagged versions · 376 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/cmis/artifacts-tab) · [ELO docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-cmis.html)

ELO CMIS service (CMIS interface).

Latest `v25-1.0.0-beta` (2026-10-16, 252 MB): OS/arch: linux/amd64 · base: wolfiOS · OpenJDK 25.0.4 (openj9) · Tomcat 11.0.27 · locales: 7

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `v25-1.0.0-beta` | 252 MB | 2026-10-16 |  |
| `v25-0.30.1` | 234 MB | 2026-09-22 |  |
| `v25-0.30.0` | 232 MB | 2026-08-14 |  |
| `v25-0.3.2` | 232 MB | 2026-07-20 |  |
| `v23-0.14-debian` | 237 MB | 2026-09-22 |  |
| `v23-0.14` | 228 MB | 2026-09-22 |  |
| `v23-0.13-debian` | 224 MB | 2026-08-14 |  |
| `v23-0.13` | 225 MB | 2026-08-14 |  |

### elo-sync

`registry.elo.com/eck-services/elo-sync` · 28 tagged versions · 155 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/elo-sync/artifacts-tab) · [ELO docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-elo-sync.html)

ELO Sync: synchronization between ELO and third-party systems (e.g. Microsoft 365). Not yet runnable with docker-compose per ELO docs.

Latest `v25-1.0.0-beta` (2026-10-16, 236 MB): OS/arch: linux/amd64 · base: wolfiOS · locales: 7

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `v25-1.0.0-beta` | 236 MB | 2026-10-16 |  |
| `v25-0.30.1` | 246 MB | 2026-09-22 |  |
| `v25-0.30.0` | 245 MB | 2026-08-14 |  |
| `v25-0.3.2` | 253 MB | 2026-07-20 |  |
| `v23-6.6` | 205 MB | 2025-10-22 |  |
| `v23-6.5` | 210 MB | 2025-09-09 |  |
| `v23-6.4` | 204 MB | 2025-07-22 |  |
| `v23-6.3` | 203 MB | 2025-06-03 |  |

### model-processor

`registry.elo.com/eck-services/model-processor` · 1 tagged versions · 52 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/model-processor/artifacts-tab) · [ELO docs](https://docs.elo.com/ops/eck-images/en-us/administration-docker/images/cloud-mp.html)

ELO AI model processor (recommended 2 GiB heap / 3 GiB container).

Latest `v25-1.0.0-beta` (2026-10-16, 253 MB): OS/arch: linux/amd64 · base: wolfiOS · OpenJDK 25.0.4 (openj9) · Tomcat 11.0.27 · locales: 7

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `v25-1.0.0-beta` | 253 MB | 2026-10-16 |  |

### entity-extraction-service

`registry.elo.com/eck-services/entity-extraction-service` · 1 tagged versions · 51 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/entity-extraction-service/artifacts-tab) · [ELO docs](https://docs.elo.com/ops/eck-images/en-us/administration-docker/images/cloud-ees.html)

ELO Entity Extraction Service (recommended 3 GiB heap / 4 GiB container).

Latest `v25-1.0.0-beta` (2026-10-16, 371 MB): OS/arch: linux/amd64 · base: wolfiOS · OpenJDK 25.0.4 (openj9) · Tomcat 11.0.27 · locales: 7

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `v25-1.0.0-beta` | 371 MB | 2026-10-16 |  |

### aio

`registry.elo.com/eck-services/aio` · 3 tagged versions · 46 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/aio/artifacts-tab)

All-in-one image (ELO 23 only).

Latest `v23-3.2` (2024-07-09, 2.07 GB): OS/arch: linux/amd64 · base: debian:12.2-slim · OpenJDK 21.0.1 (openj9) · AC 23.03.000.181762 · IX 23.03.000.178704 · WEB 23.03.000.2887-50c730f3 · WF 23.03.000.2441-278f5a1a

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `v23-3.2` | 2.07 GB | 2024-07-09 | 23.03.000.178704 |
| `v23-3.1` | 2.07 GB | 2024-06-22 | 23.03.000.178704 |
| `v23-3.0` | 2.07 GB | 2024-03-05 | 23.03.000.178704 |

### postgresql-exporter

`registry.elo.com/eck-services/postgresql-exporter` · 1 tagged versions · 45 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/postgresql-exporter/artifacts-tab)

PostgreSQL metrics exporter (Prometheus).

Latest `12.5.0` (2021-10-14, 43 MB): OS/arch: linux/amd64

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `12.5.0` | 43 MB | 2021-10-14 |  |

### rp

`registry.elo.com/eck-services/rp` · 8 tagged versions · 25 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/rp/artifacts-tab)

ELO rp service.

Latest `v21-3.0` (2022-10-21, 163 MB): OS/arch: linux/amd64 · base: debian:11.5-slim · OpenJDK 17.0.5 (openj9)

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `20.00.000-0.1` | 146 MB | 2020-11-05 |  |
| `v21-3.0` | 163 MB | 2022-10-21 |  |
| `v21-2.1` | 152 MB | 2022-04-20 |  |
| `v21-2.0` | 152 MB | 2022-04-07 |  |
| `v21-1.0` | 153 MB | 2021-12-16 |  |
| `v20-0.1` | 156 MB | 2022-05-10 |  |
| `v20-0.0` | 156 MB | 2021-12-08 |  |

### analytics

`registry.elo.com/eck-services/analytics` · 2 tagged versions · 20 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/analytics/artifacts-tab)

ELO Analytics.

Latest `v21-1.0` (2021-12-16, 360 MB): OS/arch: linux/amd64

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `20.00.234-0.1` | 374 MB | 2020-11-05 |  |
| `v21-1.0` | 360 MB | 2021-12-16 |  |

### imo

`registry.elo.com/eck-services/imo` · 1 tagged versions · 6 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/imo/artifacts-tab)

ELO imo service.

Latest `20.00.002-0.1` (2020-11-05, 149 MB): OS/arch: linux/amd64

| Tag | Size | Pushed | ELO IX version |
|---|---|---|---|
| `20.00.002-0.1` | 149 MB | 2020-11-05 |  |

### replication

`registry.elo.com/eck-services/replication` · 0 tagged versions · 1 pulls · [registry](https://registry.elo.com/harbor/projects/2/repositories/replication/artifacts-tab)

ELO replication (no tagged versions).

