# PayPal — Setup de pagos (THE ARCHIVE)

Reemplaza a Lemon Squeezy. La lógica de créditos (RPCs de Supabase) NO cambió:
el pago solo dispara `confirm_payment_intent` / `refund_payment_intent`.

## Arquitectura del flujo

```
Usuario click "Buy" 
  → POST /api/billing/checkout      (crea payment_intent + orden PayPal, custom_id = intent_id)
  → redirect a approveUrl de PayPal (el usuario paga)
  → PayPal redirige a /api/billing/capture?token=<orderId>
  → capture route: captureOrder() → confirm_payment_intent() → /pricing?success=1
  → (red de seguridad) webhook PAYMENT.CAPTURE.COMPLETED vuelve a confirmar (idempotente)
```

Refunds/chargebacks llegan por webhook: `PAYMENT.CAPTURE.REFUNDED` / `PAYMENT.CAPTURE.REVERSED`.

## 1. Crear la REST App y sacar credenciales

1. Entra a **https://developer.paypal.com/dashboard/** con tu cuenta Business.
2. Arriba a la derecha, toggle **Sandbox** (para pruebas) / **Live** (para cobrar de verdad).
3. **Apps & Credentials → Create App** → nombre `THE ARCHIVE` → Merchant.
4. Copia **Client ID** y **Secret**. (Hay un set para Sandbox y otro para Live.)

## 2. Crear el Webhook

1. Dentro de la App → sección **Webhooks → Add Webhook**.
2. URL: `https://TU-DOMINIO/api/billing/webhook`
   (en sandbox usa la URL de tu deploy de Vercel preview/prod — no funciona con localhost).
3. Marca estos eventos:
   - `Payment capture completed`
   - `Payment capture refunded`
   - `Payment capture reversed`
4. Guarda y copia el **Webhook ID** que PayPal te da.

## 3. Variables de entorno (Vercel → Project → Settings → Environment Variables)

```
PAYPAL_ENV=sandbox            # cambiar a "live" cuando salgas a producción
PAYPAL_CLIENT_ID=...          # de la REST App
PAYPAL_CLIENT_SECRET=...      # de la REST App
PAYPAL_WEBHOOK_ID=...         # del webhook creado en el paso 2
BILLING_ENABLED=true          # ya existente: habilita el checkout
NEXT_PUBLIC_SITE_URL=https://TU-DOMINIO   # canónico, para return_url/redirects
SUPABASE_SERVICE_ROLE_KEY=... # ya debería existir (lo usa el admin client)
```

> Sandbox y Live tienen credenciales distintas. Al pasar a producción cambias
> los 3 valores de PayPal + `PAYPAL_ENV=live` y recreas el webhook en modo Live.

## 4. Aplicar la migración SQL

Correr `supabase/paypal_migration.sql` contra el proyecto (vía Supabase MCP
`apply_migration` o el SQL editor). Es idempotente y no toca el cálculo de créditos.

## 5. Probar en Sandbox

1. En el dashboard de PayPal, **Sandbox → Accounts**: usa la cuenta "Personal"
   de prueba (email + password sandbox) como comprador.
2. Compra un pack en el sitio → te manda al checkout sandbox de PayPal →
   inicia sesión con la cuenta personal de prueba → paga.
3. Verifica: vuelves a `/pricing?success=1` y los créditos aparecen en el balance.
4. Revisa en Supabase `payment_intents` (status=confirmed) y `credit_transactions`.

## Notas

- PayPal NO necesita pre-crear productos: el precio sale de `credit_packs.price_usd`.
- Ecuador opera en **USD**, así que no hay conversión de moneda.
- La columna `credit_packs.lemonsqueezy_variant_id` quedó sin uso (se puede
  borrar luego; no estorba).
- Archivos legacy que ya no se importan: `lib/lemonsqueezy.ts` (eliminable).
- La membresía mensual (Skool, 800/mo) sigue por su endpoint aparte; esto es
  solo para packs de créditos.
