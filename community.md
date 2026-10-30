# ELO Community: acceso a publicaciones recientes

## Alcance

Este repositorio contiene un extractor para la **ELO Community** (`community.elo.com`), en particular el Knowledge Board `COMMUNITY`. En este contexto, “noticias” significa publicaciones y anuncios del board; no son noticias públicas generales ni los paquetes de descarga de `partner.elo.com`.

`hyperv-web-configurator.ps1` no consulta ELO por sí solo. Se ejecuta como administrador, comprueba Node.js, npm y Playwright/Chromium, instala lo que falte, y arranca `web/server.js` en el puerto 3000. La extracción la hacen `web/community-scraper.js` y la configuración de `community-config.json`.

## Qué puede extraerse

- El extractor recorre las secciones definidas en `community-config.json` (por ejemplo, `Important announcements`, `Known Issues`, `Installation & Updates`, `ELO Cloud`, `Server` y otras).
- Inicia sesión en `https://community.elo.com/`, obtiene cookies de sesión y llama por HTTPS al API REST de Knowledge Board.
- Solicita publicaciones con `orderBy: objxdate DESC` (modificación más reciente primero), guardando título, fechas, autor, tipo, etiquetas, texto, respuestas y estado resuelto cuando están disponibles.
- En una ejecución de actualización, evita duplicados por ID ELO y se detiene cuando encuentra una página cuyos elementos ya estaban descargados. La configuración actual no sobrescribe artículos existentes; para novedades, esto es adecuado, pero no garantiza refrescar el contenido de publicaciones antiguas que hayan cambiado.
- Los resultados se guardan bajo `community/<sección>/...` en Markdown y `metadata.json`. La sesión autenticada se guarda en `community/.session.json` para reusarla mientras siga válida.

## Procedimiento para obtener las publicaciones más recientes

1. Ejecuta PowerShell **como administrador** y desde la raíz del repositorio:

   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   .\hyperv-web-configurator.ps1
   ```

   Abre `http://127.0.0.1:3000`.

2. En la sección **Community**, inicia el scrape e introduce las credenciales de una cuenta autorizada de ELO Community cuando la interfaz las solicite. Si el autologin no funciona, el scraper abre Chromium visible y permite iniciar sesión manualmente. Espera el evento de finalización (`done`) y revisa los errores: un login fallido o errores de API significan que no hay una actualización fiable.

3. Construye o reconstruye el índice local con **Build Local Index**. El backend es `POST /api/community/build-db` y transmite eventos SSE. Sin este paso, la búsqueda local puede dar resultados antiguos o indicar que el índice no está construido.

4. Para recuperar novedades, usa la búsqueda de Community con consulta vacía (sin filtros) o filtra por secciones de anuncios. El backend `GET /api/community/search-db` ordena resultados sin consulta por `date DESC` y limita la respuesta a 100; el resultado incluye `title`, `date`, `author`, `section`, `url`, `dir` y `excerpt`. Para leer el artículo completo, usa el endpoint `GET /api/community/article?section=<slug>&dir=<directorio>` (la ruta `dir` puede incluir un subdirectorio de respuesta). Prioriza `Important announcements`, `Installation & Updates` y `Known Issues` si el usuario busca avisos de producto.

5. Ordena y presenta las fechas como fechas, no como prueba de publicación si el dato no está disponible: los metadatos usan `XDateIso` o, en su defecto, `IDateIso`; el API ordena por fecha de modificación (`objxdate`). Indica siempre la fecha de actualización de la extracción y enlaza el `url` original cuando exista.

Para comprobar la frescura del conjunto antes de responder, consulta `GET /api/community/status` (conteos, configuración y estado de scrape; `lastUpdate` puede venir del índice JSON) y `GET /api/community/db-stats`. Estos estados no sustituyen revisar la fecha más reciente de cada artículo.

## Uso por una IA o automatización

La IA necesita acceso de red al configurador local y credenciales de ELO válidas para iniciar/renovar la sesión. La contraseña se envía en el cuerpo JSON de `POST /api/community/scrape` (`{ "username": "...", "password": "..." }`); el endpoint mantiene una respuesta SSE mientras se procesa. Después debe llamar a `POST /api/community/build-db` y consultar `/api/community/search-db?q=`. No incluyas secretos en prompts, argumentos de línea de comandos, logs, archivos Markdown, historial de shell ni repositorio. Solicita las credenciales en un almacén de secretos o entrada protegida en tiempo de ejecución y no las imprimas.

Si la sesión guardada sigue válida, el scraper la verifica y la reutiliza. Si caduca, se necesita iniciar sesión otra vez; el archivo de cookies es una credencial equivalente y debe tratarse como secreto. En esta copia del proyecto no encontré un archivo de sesión `community/.session.json`, y `community-config.json` no contiene usuario ni contraseña de ELO. Los scripts `analyze-with-your-login.js` y `inspect-elo-login.js` son flujos de inspección/interacción del login, no un almacén de credenciales. Por tanto, las credenciales deben proporcionarse por un canal seguro al ejecutar el scrape; no se deben inferir ni recuperar del código.

## Límites y seguridad

- El servidor escucha en `0.0.0.0:3000` (todas las interfaces) y las rutas de Community no implementan autenticación propia. Aunque el launcher muestra `127.0.0.1`, otros equipos con acceso de red podrían alcanzar endpoints; no expongas el puerto a Internet ni a redes no confiables. Para uso automatizado, restringe el acceso con firewall/túnel local y no publiques credenciales en URLs.
- La sesión reutilizable vive en `community/.session.json`; protege ese archivo y no lo compartas. El scraper no puede acceder al contenido restringido de la cuenta sin autorización válida.
- La base y los archivos locales representan una copia tomada durante el último scrape, no un feed en vivo. Un artículo presente en disco no prueba que esté actualizado.
- El scrape total recorre todas las secciones y puede tardar. Un scrape interrumpido o con errores no debe describirse como sincronización completa.
- El índice Elasticsearch está desactivado en la configuración actual; la búsqueda prevista es la base SQLite local.

## Archivos y puntos de entrada

| Archivo | Función |
|---|---|
| `hyperv-web-configurator.ps1` | Launcher del servidor web; requiere administrador. |
| `web/server.js` | API HTTP, scrape SSE, índice SQLite, búsqueda y lectura de artículos. |
| `web/community-scraper.js` | Login, sesión, consultas al API de ELO y escritura de artículos. |
| `community-config.json` | URL, secciones, parámetros de salida y opciones de indexación. No contiene las credenciales ELO. |
| `web/community-db.js` | Construcción de SQLite FTS y búsqueda local ordenada por fecha para consultas vacías. |
| `community/` | Artículos, metadatos, índice/base locales y, tras autenticar, archivo de sesión. |

