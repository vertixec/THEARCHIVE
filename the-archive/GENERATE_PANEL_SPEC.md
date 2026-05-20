# SPEC: Generate Panel — The Archive

## Objetivo

Agregar un panel lateral de generación de imágenes/videos a The Archive. Los usuarios pueden:
- Usar prompts de las cards del archivo como punto de partida
- Usar visuales del archivo como referencia de imagen
- Generar imágenes y videos directamente en la plataforma
- Ver y guardar sus resultados

---

## Decisiones técnicas

### API de generación: FAL.ai
- Proveedor único que incluye GPT Image 2, Nano Banana Pro, Flux 2, Kling, Seedance, y más
- Una sola API key para imagen y video
- SDK: `@fal-ai/client`
- Instalar: `npm install @fal-ai/client`

### Modelo de costos: Platform-owned key + límite mensual
- La API key de FAL.ai vive en el servidor (env var), los usuarios NO la ven
- Cada usuario tiene **10 imágenes/mes** y **2 videos/mes** incluidos en la membresía
- El límite se trackea en Supabase y se resetea el 1 de cada mes
- Si se agota el límite, el usuario ve un mensaje claro (no crash)

### Variable de entorno a agregar
```
FAL_API_KEY=tu_api_key_de_fal_aqui
```
Agregar en `.env.local` para desarrollo y en las variables de entorno de Vercel para producción.

---

## Base de datos (Supabase)

Ejecutar este SQL en el SQL Editor de Supabase:

```sql
-- Control de uso mensual por usuario
CREATE TABLE user_generation_usage (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  year_month text NOT NULL, -- formato "2026-05"
  image_count integer DEFAULT 0,
  video_count integer DEFAULT 0,
  UNIQUE(user_id, year_month)
);

-- Historial de generaciones del usuario
CREATE TABLE generations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  prompt text NOT NULL,
  model text NOT NULL,
  generation_type text NOT NULL CHECK (generation_type IN ('image', 'video')),
  result_url text,
  reference_image_url text,
  is_saved boolean DEFAULT false
);

-- RLS: cada usuario solo ve sus propias filas
ALTER TABLE user_generation_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see own usage" ON user_generation_usage
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "users see own generations" ON generations
  FOR ALL USING (user_id = auth.uid());
```

También crear un bucket en Supabase Storage llamado `generations` (puede ser público).

---

## Estructura de archivos

### Archivos NUEVOS a crear

```
components/
  GenerateContext.tsx       ← estado global del panel
  GeneratePanel.tsx         ← panel lateral deslizable

app/api/
  generate/
    route.ts                ← POST: llama FAL.ai y guarda resultado
    usage/
      route.ts              ← GET: devuelve cuántos créditos quedan este mes
```

### Archivos EXISTENTES a modificar

```
components/Card.tsx         ← agregar botón "GENERATE" en el back face
components/Navigation.tsx   ← agregar botón ⚡ GENERATE en el nav superior
app/layout.tsx              ← envolver con GenerateProvider y renderizar GeneratePanel
lib/types.ts                ← agregar tipos Generation y GenerationUsage
```

---

## Implementación detallada

### 1. `lib/types.ts` — Agregar tipos

```typescript
export interface Generation {
  id: string;
  user_id: string;
  created_at: string;
  prompt: string;
  model: string;
  generation_type: 'image' | 'video';
  result_url: string | null;
  reference_image_url: string | null;
  is_saved: boolean;
}

export interface GenerationUsage {
  image_count: number;
  video_count: number;
  image_limit: number;
  video_limit: number;
}
```

---

### 2. `components/GenerateContext.tsx`

```typescript
'use client';
import { createContext, useContext, useState, ReactNode } from 'react';

interface GenerateState {
  isOpen: boolean;
  prompt: string;
  referenceImageUrl: string | null;
  generationType: 'image' | 'video';
}

interface GenerateContextType extends GenerateState {
  openPanel: (prompt?: string, referenceImageUrl?: string | null) => void;
  closePanel: () => void;
  setPrompt: (prompt: string) => void;
  setReferenceImageUrl: (url: string | null) => void;
  setGenerationType: (type: 'image' | 'video') => void;
  togglePanel: () => void;
}

const GenerateContext = createContext<GenerateContextType | null>(null);

export function GenerateProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);
  const [generationType, setGenerationType] = useState<'image' | 'video'>('image');

  const openPanel = (newPrompt = '', newImageUrl: string | null = null) => {
    if (newPrompt) setPrompt(newPrompt);
    if (newImageUrl !== undefined) setReferenceImageUrl(newImageUrl);
    setIsOpen(true);
  };

  const closePanel = () => setIsOpen(false);
  const togglePanel = () => setIsOpen(prev => !prev);

  return (
    <GenerateContext.Provider value={{
      isOpen, prompt, referenceImageUrl, generationType,
      openPanel, closePanel, togglePanel,
      setPrompt, setReferenceImageUrl, setGenerationType,
    }}>
      {children}
    </GenerateContext.Provider>
  );
}

export function useGenerate() {
  const ctx = useContext(GenerateContext);
  if (!ctx) throw new Error('useGenerate must be used within GenerateProvider');
  return ctx;
}
```

---

### 3. `app/api/generate/usage/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabaseServer';

const IMAGE_LIMIT = 10;
const VIDEO_LIMIT = 2;

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const yearMonth = new Date().toISOString().slice(0, 7); // "2026-05"

  const { data } = await supabase
    .from('user_generation_usage')
    .select('image_count, video_count')
    .eq('user_id', user.id)
    .eq('year_month', yearMonth)
    .single();

  return NextResponse.json({
    image_count: data?.image_count ?? 0,
    video_count: data?.video_count ?? 0,
    image_limit: IMAGE_LIMIT,
    video_limit: VIDEO_LIMIT,
  });
}
```

---

### 4. `app/api/generate/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabaseServer';
import * as fal from '@fal-ai/client';

fal.config({ credentials: process.env.FAL_API_KEY });

const IMAGE_LIMIT = 10;
const VIDEO_LIMIT = 2;

const IMAGE_MODELS: Record<string, string> = {
  'gpt-image-2':    'fal-ai/gpt-image-1',        // ajustar al endpoint real de FAL
  'flux-pro':       'fal-ai/flux-pro',
  'nano-banana-pro':'fal-ai/nano-banana-pro',     // ajustar al endpoint real de FAL
};

const VIDEO_MODELS: Record<string, string> = {
  'kling-1.6':  'fal-ai/kling-video/v1.6/standard/text-to-video',
  'seedance':   'fal-ai/seedance-1-lite',
};

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { prompt, model, generationType, referenceImageUrl } = await req.json();

  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
  }

  // Verificar límite mensual
  const yearMonth = new Date().toISOString().slice(0, 7);
  const { data: usage } = await supabase
    .from('user_generation_usage')
    .select('image_count, video_count')
    .eq('user_id', user.id)
    .eq('year_month', yearMonth)
    .single();

  const imageCount = usage?.image_count ?? 0;
  const videoCount = usage?.video_count ?? 0;

  if (generationType === 'image' && imageCount >= IMAGE_LIMIT) {
    return NextResponse.json({ error: 'Monthly image limit reached' }, { status: 429 });
  }
  if (generationType === 'video' && videoCount >= VIDEO_LIMIT) {
    return NextResponse.json({ error: 'Monthly video limit reached' }, { status: 429 });
  }

  // Llamar FAL.ai
  const modelEndpoints = generationType === 'image' ? IMAGE_MODELS : VIDEO_MODELS;
  const endpoint = modelEndpoints[model] || modelEndpoints[Object.keys(modelEndpoints)[0]];

  const input: Record<string, unknown> = { prompt };
  if (referenceImageUrl && generationType === 'image') {
    input.image_url = referenceImageUrl;
  }

  let resultUrl: string;
  try {
    const result = await fal.subscribe(endpoint, { input }) as { images?: { url: string }[]; video?: { url: string } };
    resultUrl = result.images?.[0]?.url ?? result.video?.url ?? '';
    if (!resultUrl) throw new Error('No result URL from FAL');
  } catch (err) {
    console.error('FAL.ai error:', err);
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 });
  }

  // Actualizar contador de uso
  await supabase.from('user_generation_usage').upsert(
    {
      user_id: user.id,
      year_month: yearMonth,
      image_count: generationType === 'image' ? imageCount + 1 : imageCount,
      video_count: generationType === 'video' ? videoCount + 1 : videoCount,
    },
    { onConflict: 'user_id,year_month' }
  );

  // Guardar generación en historial
  const { data: generation } = await supabase
    .from('generations')
    .insert({
      user_id: user.id,
      prompt,
      model,
      generation_type: generationType,
      result_url: resultUrl,
      reference_image_url: referenceImageUrl ?? null,
    })
    .select()
    .single();

  return NextResponse.json({ url: resultUrl, generation });
}
```

---

### 5. `components/GeneratePanel.tsx`

El panel debe:
- Deslizarse desde la derecha (`translate-x-full` → `translate-x-0`) con transición suave
- Ancho fijo: `w-80` (320px) en desktop
- En mobile: ocupa todo el ancho y aparece como drawer inferior o full-screen
- Tener scroll interno si el contenido es largo
- Mantener el mismo estilo visual de The Archive: `bg-panel`, bordes `border-white/10`, fuentes `font-mono`, color accent `text-acid`

**Secciones del panel (de arriba a abajo):**

1. **Header**: título "GENERATE" + botón X para cerrar
2. **Reference image**: thumbnail si hay una imagen seleccionada + botón para limpiarla. Si no hay, un área con "Drop a visual here or click GENERATE on any card"
3. **Prompt**: `<textarea>` pre-llenado con el prompt de la card, editable
4. **Type toggle**: botón IMG | VID (tab-style)
5. **Model selector**: dropdown con los modelos disponibles según el tipo seleccionado
6. **Credits indicator**: "X/10 images remaining this month" en pequeño, `text-acid`
7. **Botón GENERATE ⚡**: `bg-acid text-black`, disabled si isGenerating o sin créditos
8. **Results grid**: las últimas generaciones del usuario, en grilla 2 columnas. Cada resultado tiene: imagen/video, botón descargar, botón guardar en favoritos

**Estado local del componente:**
- `isGenerating: boolean`
- `results: Generation[]`  
- `usage: GenerationUsage | null`
- `selectedModel: string`
- `error: string | null`

**Al montar**: llamar `GET /api/generate/usage` y cargar las últimas 10 generaciones desde Supabase

**Al hacer click GENERATE:**
1. `setIsGenerating(true)`
2. `POST /api/generate` con `{ prompt, model, generationType, referenceImageUrl }`
3. Si 429: mostrar mensaje de límite alcanzado (usando `useToast`)
4. Si éxito: agregar resultado al inicio del array `results`, decrementar el counter de créditos
5. `setIsGenerating(false)`

---

### 6. Modificar `components/Navigation.tsx`

Agregar el botón `⚡ GENERATE` en la barra de navegación superior, junto al avatar/icono de perfil:

```tsx
import { useGenerate } from './GenerateContext';

// Dentro del componente Navigation:
const { togglePanel, isOpen } = useGenerate();

// En el JSX, junto al botón de perfil:
<button
  onClick={togglePanel}
  className={`flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 border transition-all ${
    isOpen
      ? 'border-acid text-acid bg-acid/10'
      : 'border-white/20 text-white/60 hover:text-acid hover:border-acid/50'
  }`}
>
  <span>⚡</span>
  <span>Generate</span>
</button>
```

---

### 7. Modificar `components/Card.tsx`

En el **back face**, agregar un botón "GENERATE" junto al botón de copy del prompt. Solo para `itemType === 'visual'` o `itemType === 'system'`:

```tsx
import { useGenerate } from './GenerateContext';

// Dentro del componente Card:
const { openPanel } = useGenerate();

// En el JSX del back face, junto al botón de copy:
{(itemType === 'visual' || itemType === 'system') && (
  <button
    onClick={(e) => {
      e.stopPropagation();
      openPanel(
        item.prompt_text || '',
        itemType === 'visual' ? item.image_url || null : null
      );
    }}
    className="text-acid/50 hover:text-acid transition-colors p-1"
    title="Generate with this prompt"
  >
    <span className="font-mono text-[10px]">⚡</span>
  </button>
)}
```

---

### 8. Modificar `app/layout.tsx`

Envolver la app con `GenerateProvider` y renderizar `GeneratePanel` una sola vez a nivel global:

```tsx
import { GenerateProvider } from '@/components/GenerateContext';
import GeneratePanel from '@/components/GeneratePanel';

// Dentro del body, envolver todo con GenerateProvider:
<GenerateProvider>
  <div className="relative flex flex-col min-h-screen">
    {children}
    <GeneratePanel />
  </div>
</GenerateProvider>
```

El `GeneratePanel` debe posicionarse con `fixed right-0 top-0 h-full z-50` y deslizarse con `transform transition-transform`.

---

## Modelos disponibles (para el selector)

### Imágenes
```typescript
const IMAGE_MODELS = [
  { id: 'gpt-image-2',     label: 'GPT Image 2',      description: 'Alta calidad fotorrealista' },
  { id: 'flux-pro',        label: 'Flux Pro',          description: 'Arte y creativo' },
  { id: 'nano-banana-pro', label: 'Nano Banana Pro',   description: 'Estilo ilustración' },
];
```

### Videos
```typescript
const VIDEO_MODELS = [
  { id: 'kling-1.6',  label: 'Kling 1.6',   description: '5s clip, alta calidad' },
  { id: 'seedance',   label: 'Seedance',     description: '4s clip, rápido' },
];
```

> **Nota para el desarrollador**: Verificar los endpoints exactos de FAL.ai para cada modelo en [fal.ai/models](https://fal.ai/models). Los IDs en esta spec son aproximados. El patrón es `fal-ai/[nombre-del-modelo]`.

---

## Diseño visual del panel

Seguir el sistema de diseño existente de The Archive:
- Background: `bg-[#0d0d0d]` o `bg-panel`
- Borde izquierdo: `border-l border-white/10`
- Accent color: `#c8ff00` (variable `acid` en tailwind)
- Fuente mono: `font-mono`
- Fuente títulos: `font-anton` o `font-oswald`
- Textos secundarios: `text-white/50` o `text-gray-500`
- Inputs: `bg-black border border-white/10 focus:border-acid`
- Botón principal: `bg-acid text-black font-oswald uppercase tracking-widest`
- Todo en UPPERCASE como el resto de la UI

---

## Verificación end-to-end

1. Ejecutar el SQL en Supabase → confirmar tablas `user_generation_usage` y `generations`
2. Crear bucket `generations` en Supabase Storage
3. Agregar `FAL_API_KEY` en `.env.local`
4. `npm run dev`
5. Ir a Visuals → flip una card → click `⚡` → el panel abre a la derecha con el prompt pre-llenado
6. Click GENERATE → ver estado de carga → imagen aparece en el panel
7. Confirmar fila en tabla `generations` en Supabase Dashboard
8. Confirmar que `user_generation_usage` se incrementó
9. Repetir 10 veces → la generación 11 debe mostrar mensaje de límite alcanzado (no crash)
10. Abrir el panel desde el botón ⚡ GENERATE del navbar (sin pasar por una card)
11. Cambiar a tipo VIDEO → seleccionar modelo Kling → generar
12. Cerrar el panel con el botón X y volver a abrirlo → el prompt se mantiene

---

## Fuera del scope de este MVP

- Stripe para comprar créditos adicionales
- Página `/generate` con historial completo
- Compartir generaciones a la sección Community
- Opción de que el usuario use su propia API key
- Admin panel para ver uso total de todos los usuarios
