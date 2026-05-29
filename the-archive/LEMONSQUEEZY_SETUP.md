# Lemon Squeezy Setup — Pasos manuales pendientes

Todo el código está listo. Para activar pagos, completa estos pasos en orden.

## 1. Crear cuenta y configurar la tienda

1. Crea cuenta en [lemonsqueezy.com](https://lemonsqueezy.com).
2. Completa el onboarding fiscal (RUC o ID personal de Ecuador + datos de payout vía Wise).
3. Crea una Store. Anota el `store_id` (lo ves en la URL del dashboard).

## 2. Crear los 3 Products

En **Products → New Product**, crea uno por uno (one-time payment, no subscription):

| Product name | Price USD | Description sugerida |
|---|---|---|
| Starter Pack | $5.00 | 50 image credits + 5 video credits |
| Creator Pack | $15.00 | 200 image credits + 20 video credits |
| Studio Pack | $30.00 | 500 image credits + 60 video credits |

Cada Product tiene un default Variant. Anota los 3 `variant_id` (los ves en la URL del variant, o en la API explorer).

## 3. Vincular los variants a los packs de la DB

Una vez tengas los 3 IDs, dime los valores y los inserto via MCP así:

```sql
update public.credit_packs set lemonsqueezy_variant_id = '<variant_id_starter>' where id = 'starter';
update public.credit_packs set lemonsqueezy_variant_id = '<variant_id_creator>' where id = 'creator';
update public.credit_packs set lemonsqueezy_variant_id = '<variant_id_studio>'  where id = 'studio';
```

Sin esto, el endpoint `/api/billing/checkout` devuelve 503 ("pack not wired to Lemon Squeezy"). Es protección intencional.

## 4. API key

**Settings → API → Create API key**. Guárdala — no la verás dos veces.

## 5. Webhook

**Settings → Webhooks → Create webhook**:

- **Callback URL**: `https://<tu-dominio>/api/billing/webhook`
  - Para dev local con ngrok: `https://<subdomain>.ngrok.io/api/billing/webhook`
  - Para Vercel preview: usa la URL del deployment de preview.
- **Eventos a suscribir** (solo estos dos por ahora):
  - `order_created`
  - `order_refunded`
- Lemon Squeezy genera un `signing secret`. Cópialo.

## 6. Variables de entorno

Agrega a `.env.local` (y a Vercel → Settings → Environment Variables):

```
LEMONSQUEEZY_API_KEY=lsk_...
LEMONSQUEEZY_STORE_ID=12345
LEMONSQUEEZY_WEBHOOK_SECRET=...
NEXT_PUBLIC_SITE_URL=https://thearchive.example.com
```

`NEXT_PUBLIC_SITE_URL` es la URL pública para los redirects de checkout. En dev puedes omitirla — el código toma `request.nextUrl.origin` como fallback.

Adicional (ya existentes, solo verifica que estén):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` ← **crítico para el webhook**. Si no está, los webhooks de Lemon Squeezy fallarán con 500.
- `FAL_API_KEY`

## 7. Test en sandbox (modo test)

1. Activa **Test mode** en el dashboard de Lemon Squeezy (toggle arriba a la derecha).
2. Crea variantes de Test mode si Lemon te lo pide.
3. Usa tarjeta de prueba `4242 4242 4242 4242`, CVC `123`, fecha futura.
4. Flujo:
   - Login en tu app → `/credits` → click "Buy for $5".
   - Redirect a Lemon Squeezy → completa pago test.
   - Redirect de vuelta a `/credits?success=1&intent=<id>`.
   - Verás banner verde "Payment received".
   - **El balance debería subir en 1-3 segundos** (depende de qué tan rápido llegue el webhook).
   - Refresca para ver el balance actualizado.

## 8. Verificar end-to-end

```sql
-- Ver el último intent (Supabase SQL editor):
select id, pack_id, amount_usd, status, provider_reference, created_at, confirmed_at
from public.payment_intents
order by created_at desc
limit 5;

-- Ver las transacciones de purchase recientes:
select amount, balance_after, credit_type, reason, payment_provider, payment_reference, created_at
from public.credit_transactions
where reason in ('purchase','refund')
order by created_at desc
limit 10;

-- Tu balance:
select credits, video_credits, updated_at
from public.user_credit_balances
where user_id = auth.uid();
```

Si el intent quedó en `pending` después del pago:
1. Lemon Squeezy → Webhooks → última entrega: ¿estado 200? Si no, lee el error.
2. Si dice 401: el `LEMONSQUEEZY_WEBHOOK_SECRET` no coincide con el del dashboard.
3. Si dice 500: probablemente `SUPABASE_SERVICE_ROLE_KEY` no está seteada en Vercel.
4. Puedes hacer "Resend" desde el dashboard para reintentar — el RPC `confirm_payment_intent` es idempotente, no duplica créditos.

## 9. Idempotencia (test crítico)

Desde el dashboard de Lemon Squeezy, después de un order test exitoso, haz **Resend** del webhook `order_created` varias veces. El balance debe quedar **igual** después del primer confirm (no duplica). Las transacciones en `credit_transactions` también deben quedar en 1 image + 1 video por order (no duplicadas).

## 10. Refund test

Desde el dashboard de Lemon Squeezy, haz **Refund** de un order test. El webhook `order_refunded` llegará y:
- `payment_intents.status` pasa de `confirmed` a `refunded`.
- El balance baja los créditos correspondientes (sin ir bajo 0).
- Se insertan transacciones con `reason='refund'` y `amount` negativo.

## 11. Producción

Cuando estés listo:
1. **Desactiva Test mode** en Lemon Squeezy.
2. Configura un webhook **separado** para producción con la URL real (`https://thearchive.com/api/billing/webhook`).
3. Usa la API key de **live mode** en Vercel (separada de la de test).
4. Considera duplicar los 3 products en live mode y actualizar los `lemonsqueezy_variant_id` en `credit_packs` con los nuevos IDs.

---

## Arquitectura — para referencia

```
User clicks "Buy"
    ↓
POST /api/billing/checkout { pack_id }
    ↓
RPC create_payment_intent → row pending en payment_intents
    ↓
Lemon Squeezy createCheckout API → checkout_url
    ↓
RPC update_payment_intent_url → guarda URL
    ↓
window.location.href = checkout_url
    ↓
Lemon Squeezy hosted checkout → user paga
    ↓
Lemon Squeezy → POST /api/billing/webhook { event: order_created }
    ↓
verifyWebhookSignature (HMAC-SHA256) → ok
    ↓
RPC confirm_payment_intent (idempotente)
    - lockea intent
    - suma image_credits + video_credits a balance
    - inserta transacciones (purchase) en ledger
    - marca intent confirmed
    ↓
Webhook responde 200
    ↓
User redirected a /credits?success=1 → ve banner verde + balance actualizado
```

Refund flow es el mirror inverso, manejado por el webhook `order_refunded`.

FAL failure refund: si `/api/generate` falla DESPUÉS de gastar créditos (en upsert de usage o insert de generation row), se llama `refund_generation_credits` automáticamente y la response incluye `refunded: true`.
