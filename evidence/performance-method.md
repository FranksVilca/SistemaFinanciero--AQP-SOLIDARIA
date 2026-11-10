# Rendimiento y comprobación negativa con k6

Requisito CA-NF05.1: con 50 proyectos publicados, p95 de GET ≤ 1.500 ms excluyendo cold start, desde un cliente
cercano a la región. CA-NF05.2 exige documentar herramienta, método y condiciones.

Se usa k6 OSS 1.3.0 en Docker. No requiere una cuenta de Grafana Cloud ni servicios nuevos en AWS.

## Dos ejecuciones con propósitos distintos

| Perfil | Solicitudes | Criterio |
|---|---|---|
| `public-reads.js` | Catálogo, detalle y estadísticas públicos | Cada ruta tiene su propio p95 ≤ 1.500 ms; todas las respuestas deben ser 200. |
| `unauthenticated.js` | Historial privado, revisiones y auditoría sin token | Las 15 solicitudes deben devolver 401. No usa los percentiles del perfil público. |

El segundo perfil comprueba rechazo básico, no sustituye T01–T14. BOLA, RBAC, revocación, MFA e IAM se verifican
con las suites dedicadas. Tampoco se demuestra resistencia a DDoS ni funcionamiento bajo alta concurrencia.

## Resultado local del 2026-11-09

Comando: `npm run test:performance:local`. 50 proyectos publicados creados por la API de Floci, k6 1.3.0 en
Docker Desktop, 1 usuario virtual y 100 iteraciones. Sin llamadas a AWS. El proceso terminó con código 0.

| Ruta | Muestras medidas | Mediana | p95 | Máximo |
|---|---:|---:|---:|---:|
| Catálogo | 100 | 22 ms | 39,20 ms | 112 ms |
| Detalle | 100 | 18 ms | 36,25 ms | 203 ms |
| Estadísticas | 100 | 18 ms | 39,10 ms | 52 ms |

Los 300 checks de GET 200 pasaron y la tasa de fallos HTTP fue cero. Las tres consultas de calentamiento no se
incluyeron en esas 300 muestras. El perfil negativo pasó 15/15 comprobaciones de 401 sin token.
Resúmenes de esta pasada conservados en `.local/performance/full-run-100/`: `public-reads-summary.json`,
`public-reads-k6.json` y `unauthenticated-k6.json`. Son artefactos locales ignorados por Git. El comando documentado
regenera los resúmenes de la última ejecución en `.local/performance/`.
Estos números validan el ensayo y sus umbrales en Floci; **la aceptación de CA-NF05.1 en AWS sigue pendiente**.

## Método del perfil público

- `setup` exige al menos 50 proyectos y toma 50 identificadores del catálogo.
- Calienta los tres handlers con una consulta a cada ruta. Esas consultas quedan en la salida cruda y no entran
  en la métrica personalizada `read_duration_ms`.
- 1 usuario virtual, 100 iteraciones por defecto: 100 consultas por ruta, 300 medidas. Los identificadores rotan
  entre los 50 proyectos. Pausa de 0,5 s tras cada GET, para mantener una carga moderada.
- La métrica personalizada mide el tiempo observado alrededor de `http.get`, incluyendo establecimiento de
  conexión cuando corresponde. Se conservan también las métricas HTTP nativas de k6.
- Un error rápido no mejora una ejecución válida: checks exigen 200 y la tasa de fallo HTTP debe ser cero.
- Se conservan todas las mediciones después del calentamiento. En AWS hay que correlacionar los logs de Lambda
  para identificar arranques en frío posteriores; no se excluyen muestras solo por ser lentas. Sin esa correlación,
  reportar el resultado como “posterior al calentamiento”, sin afirmar exclusión completa de cold starts.

## Ensayo local reproducible

```powershell
docker compose -f backend/test/floci/docker-compose.lambda.yml up -d
npm run test:performance:local
```

El comando despliega un stack exclusivo en el emulador, prepara 50 proyectos mediante la API con el gestor de
prueba, ejecuta ambos perfiles y elimina el stack en `finally`. No ejecutarlo mientras otra suite use Floci.
Los resultados quedan en `.local/performance/`. `PERF_ITERATIONS` permite un ensayo corto; no confundirlo con
la ejecución de 100 iteraciones documentada. La opción que omite verificación TLS solo se usa en este ensayo.

El workflow `QA Performance Smoke` ejecuta un ensayo corto (10 iteraciones, 30 GET medidos, mismo dataset de 50
proyectos y 15 rechazos) en los PR que cambien estos scripts, y permite ejecución manual. Conserva los JSON como
artefactos. No usa AWS ni representa la medición regional de aceptación. Su ejecución en GitHub debe revisarse
antes de integrar; el ensayo local de 100 iteraciones no sustituye esa comprobación del runner de Linux.

Se probó también el propio comprobador contra un servidor deliberadamente incorrecto: catálogo con 49 proyectos
terminó con código 107, y rutas privadas que devolvían 200 terminaron con código 99. Así se comprobó que los
perfiles fallan ante un dataset insuficiente o una denegación ausente. Ese servidor solo existió en la máquina local.

Durante la preparación del ensayo corto, la conexión de Docker con `localhost` produjo errores: una ejecución
tuvo 6/30 GET fallidos y otra no pudo completar el calentamiento (conexión rechazada a `127.0.0.1`). El ejecutor
se corrigió para usar `host.docker.internal` explícitamente y conservar también muestras JSON por solicitud.
No se cambiaron los umbrales ni se admitieron respuestas erróneas como éxito.
Tras esa corrección, el ensayo corto terminó con código 0: 30/30 GET 200 y 15/15 denegaciones esperadas.

## Confirmación en AWS por el equipo

Con 50 proyectos sintéticos ya preparados en el entorno académico, desde un cliente próximo a la región:

```powershell
docker run --rm -v "${PWD}:/work" -w /work/evidence -e API_BASE_URL=https://API.execute-api.REGION.amazonaws.com/academic/v1 -e TEST_ENVIRONMENT=aws-academic -e CLIENT_LOCATION=REGION -e SUMMARY_PATH=aws-public-reads-summary.json grafana/k6:1.3.0 run --out json=aws-public-reads-samples.json /work/backend/test/performance/public-reads.js
docker run --rm -v "${PWD}:/work" -w /work/evidence -e API_BASE_URL=https://API.execute-api.REGION.amazonaws.com/academic/v1 grafana/k6:1.3.0 run --summary-export aws-unauthenticated-summary.json /work/backend/test/performance/unauthenticated.js
```

Sustituir URL y ubicación por sus valores reales. Registrar commit desplegado, fecha, región, origen del cliente,
dataset, k6 y parámetros; conservar JSON de muestras y resumen, errores y correlación de cold starts.
Una ejecución desde Arequipa hacia otra región no demuestra por sí sola el criterio de cliente cercano.
El equipo ejecuta y supervisa esta pasada; no se realizó ninguna llamada a AWS desde este aporte.

La medición local no determina la capacidad ni el cumplimiento de AWS. Los umbrales son comprobaciones, no una
promesa de rendimiento. No se aumenta la concurrencia ni se generan donaciones masivas en el entorno compartido.

Referencias: [thresholds de k6](https://grafana.com/docs/k6/latest/using-k6/thresholds/),
[resúmenes](https://grafana.com/docs/k6/latest/results-output/end-of-test/custom-summary/).
