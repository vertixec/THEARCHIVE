# KIE AI — setup

THE ARCHIVE ahora habla con **dos proveedores de generación**: FAL (el original) y
**KIE AI** (https://kie.ai), que sirve los mismos modelos a un precio bastante
menor. El proveedor lo decide el modelo, no el código: todo el pipeline
(submit, polling, webhook, referencias, cobro de créditos) pasa por
`lib/providers`.

---

## 1. Lo único que tienes que hacer

Pon tu API key y listo:

```bash
# .env.local  (y en Vercel: Settings -> Environment Variables)
KIE_API_KEY=tu_key_de_kie
```

La key se saca en https://kie.ai/api-key.

Al arrancar con esa variable puesta:

- los modelos `kie/*` aparecen automáticamente en el panel de generación,
- aparecen también en las tools MCP (`generate_image`, `generate_video`),
- el costo en créditos ya está calculado por modelo y por opción.

Sin la variable no se rompe nada: los modelos `kie/*` simplemente **no se
muestran** (ni en el panel ni en MCP), y todo sigue corriendo por FAL.
Lo mismo al revés — si un día quitas `FAL_KEY`, la app funciona solo con KIE.

### Opcional pero recomendado en producción

```bash
KIE_WEBHOOK_SECRET=una_cadena_larga_al_azar
```

KIE **no firma** sus callbacks. Con esta variable la URL de callback lleva
`?token=<secreto>` y `/api/kie/webhook` rechaza cualquier llamada que no lo
traiga. Aun sin ella el sistema es seguro: el webhook trata el payload como un
simple "poke" (solo lee `taskId`, busca *nuestra* fila y vuelve a preguntarle el
estado real a KIE), así que una llamada falsificada no puede inyectar un
resultado ni provocar un reembolso indebido.

El callback necesita `NEXT_PUBLIC_SITE_URL` con https. Sin eso (dev local) no se
manda callback y los jobs se cierran igual por polling del navegador + el cron
`/api/cron/finalize-generations`.

---

## 2. Modelos que quedaron dados de alta

| id en la app | modelo KIE | tipo | créditos (default) |
|---|---|---|---|
| `kie/nano-banana` | `google/nano-banana` (+ `google/nano-banana-edit`) | imagen | 5 |
| `kie/gpt-image-2` | `gpt-image-2-text-to-image` (+ `-image-to-image`) | imagen | 8 (1K) |
| `kie/flux-2-pro` | `flux-2/pro-text-to-image` (+ `-image-to-image`) | imagen | 8 (1K) |
| `kie/nano-banana-pro` | `nano-banana-pro` | imagen | 15 (2K) |
| `kie/kling-3` | `kling-3.0/video` | video | 65 (std, 5s) |
| `kie/seedance-2` | `bytedance/seedance-2` | video | 275 (720p, 5s) |

Comparación con los mismos modelos vía FAL: `gpt-image-2` medium cuesta 12
créditos y `nano-banana-pro` 2K cuesta 35. Por KIE son 8 y 15.

---

## 3. Precios: léelo antes de la próxima pasada de pricing

Los créditos salen de `lib/modelOptions.ts`, calibrados a **~$0.02 retail por
crédito con ~4.5x sobre el costo real** (`créditos ≈ usd * 225`). Cada entrada
dice de qué precio salió.

- **Imágenes KIE**: usan las tarifas publicadas de KIE (agosto 2026).
- **Videos KIE** (`kie/kling-3`, `kie/seedance-2`): están puestos a propósito
  **al precio de FAL** como placeholder conservador. No pude confirmar la tarifa
  por segundo real de KIE (kie.ai/pricing bloquea el acceso automatizado). Como
  KIE es más barato, el margen solo puede salir a favor — pero **conviene
  bajarlos** cuando verifiques los precios reales en https://kie.ai/pricing.

Para calibrar con datos reales: cada task completado de KIE devuelve
`creditsConsumed`, y el provider lo escribe en los logs como
`KIE task cost: { taskId, model, creditsConsumed }`. Con unas cuantas
generaciones reales tienes el costo exacto por modelo/opción.

---

## 4. Cómo está armado (por si hay que tocarlo)

```
lib/modelCatalog.ts     qué modelos existen, de quién son, y a qué endpoint van
lib/modelOptions.ts     controles (formato/calidad/duración) y precio en créditos
lib/providers/types.ts  el contrato: submit / poll / uploadImage / hostsUrl
lib/providers/fal.ts    implementación FAL (@fal-ai/client, queue API)
lib/providers/kie.ts    implementación KIE (fetch a api.kie.ai, sin SDK)
lib/providers/index.ts  registro + encoding del endpoint guardado en la BD
app/api/kie/webhook     callback de KIE (espejo de /api/fal/webhook)
```

**Sin migración de base de datos.** Las columnas son `fal_request_id` y
`fal_endpoint` desde antes. Los jobs de KIE guardan el endpoint con prefijo:
`kie:google/nano-banana`. Los endpoints de FAL nunca llevan `:`, así que las
filas viejas se siguen leyendo como FAL sin tocar nada.

### Cambios de una línea

- **Agregar un modelo KIE**: una entrada en `MODEL_CATALOG` + una en
  `MODEL_OPTIONS` (el test `lib/providers/providers.test.ts` falla si olvidas
  una de las dos). Los strings de modelo salen de `docs.kie.ai/market/*` — ojo
  que KIE no los nombra de forma consistente (`google/nano-banana` vs
  `nano-banana-pro` vs `kling-3.0/video`), hay que copiarlos literales.
- **Cambiar el modelo por defecto a KIE**: `DEFAULT_MODEL` en
  `lib/modelCatalog.ts`.
- **Pasar las Tools (Ads / Style transfer) a KIE**: `TOOL_IMAGE_MODEL` en
  `lib/modelCatalog.ts` (por ejemplo a `kie/gpt-image-2`). Endpoint, provider,
  costo y campo de referencias se derivan solos.

### Detalles de la integración

- **Referencias**: se suben al proveedor del modelo elegido. Cada uno usa un
  campo distinto (`image_urls`, `image_url`, `input_urls`, `image_input`) y eso
  vive en el catálogo. Los archivos subidos a KIE se borran a los 3 días — no
  importa, solo tienen que sobrevivir la generación.
- **Resultados**: se copian a nuestro bucket de Supabase antes de marcar el job
  completo, igual que con FAL (el CDN de KIE tampoco es permanente).
- **Rate limit de KIE**: 20 requests nuevos por cada 10s por cuenta. El límite
  nuestro (10 generaciones/minuto por usuario) queda muy por debajo.
- **Sin créditos en KIE**: `createTask` devuelve 402 y el usuario ve un mensaje
  genérico ("el servicio no está disponible"), con el detalle en logs. Los
  créditos reservados se devuelven automáticamente.
