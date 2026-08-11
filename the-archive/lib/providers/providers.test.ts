import { describe, expect, it } from 'vitest';
import { decodeJobEndpoint, encodeJobEndpoint } from './index';
import { MODEL_CATALOG, MODELS_BY_ID, referenceInputFor, resolveEndpoint } from '../modelCatalog';
import { MODEL_OPTIONS, defaultSelection, modelParamsFor } from '../modelOptions';

describe('job endpoint encoding', () => {
  it('leaves FAL endpoints untouched so legacy rows keep resolving', () => {
    const stored = encodeJobEndpoint('fal', 'fal-ai/gpt-image-2');
    expect(stored).toBe('fal-ai/gpt-image-2');
    const decoded = decodeJobEndpoint(stored);
    expect(decoded.provider.id).toBe('fal');
    expect(decoded.endpoint).toBe('fal-ai/gpt-image-2');
  });

  it('round-trips KIE endpoints through the provider prefix', () => {
    const stored = encodeJobEndpoint('kie', 'google/nano-banana');
    expect(stored).toBe('kie:google/nano-banana');
    const decoded = decodeJobEndpoint(stored);
    expect(decoded.provider.id).toBe('kie');
    expect(decoded.endpoint).toBe('google/nano-banana');
  });

  it('treats an unknown prefix as a plain FAL endpoint', () => {
    const decoded = decodeJobEndpoint('bytedance/seedance-2.0/fast/text-to-video');
    expect(decoded.provider.id).toBe('fal');
    expect(decoded.endpoint).toBe('bytedance/seedance-2.0/fast/text-to-video');
  });
});

describe('model catalog', () => {
  it('prices every catalogued model', () => {
    for (const model of MODEL_CATALOG) {
      expect(MODEL_OPTIONS[model.id], `missing options for ${model.id}`).toBeDefined();
      expect(MODEL_OPTIONS[model.id].type).toBe(model.type);
    }
  });

  it('has no priced model missing from the catalog', () => {
    for (const id of Object.keys(MODEL_OPTIONS)) {
      expect(MODELS_BY_ID[id], `missing catalog entry for ${id}`).toBeDefined();
    }
  });

  it('gives every image model a reference field for edits', () => {
    for (const model of MODEL_CATALOG.filter((entry) => entry.type === 'image')) {
      expect(model.editEndpoint, `missing edit endpoint for ${model.id}`).toBeTruthy();
      expect(model.referenceInput, `missing reference input for ${model.id}`).toBeDefined();
    }
  });

  it('routes edits to the edit endpoint', () => {
    expect(resolveEndpoint('image', 'gpt-image-2', true)).toBe('openai/gpt-image-2/edit');
    expect(resolveEndpoint('image', 'kie/nano-banana', true)).toBe('google/nano-banana-edit');
    // KIE's nano-banana-pro serves both paths from one model string.
    expect(resolveEndpoint('image', 'kie/nano-banana-pro', true)).toBe('nano-banana-pro');
  });

  it('names the reference field each vendor expects', () => {
    expect(referenceInputFor('gpt-image-2')).toEqual({ key: 'image_urls', multiple: true });
    expect(referenceInputFor('flux-pro')).toEqual({ key: 'image_url', multiple: false });
    expect(referenceInputFor('kie/gpt-image-2')).toEqual({ key: 'input_urls', multiple: true });
    expect(referenceInputFor('kie/nano-banana-pro')).toEqual({ key: 'image_input', multiple: true });
  });
});

describe('model params', () => {
  it('sends KIE seedance duration as a number, not a string', () => {
    const params = modelParamsFor('kie/seedance-2', { duration: '10', resolution: '720p' });
    expect(params.duration).toBe(10);
    expect(params.resolution).toBe('720p');
  });

  it('keeps every other duration as the string the vendor documents', () => {
    expect(modelParamsFor('kie/kling-3', { duration: '10' }).duration).toBe('10');
    expect(modelParamsFor('kling-1.6', { duration: '10' }).duration).toBe('10');
  });

  it('prices KIE image models below their FAL twins at default options', () => {
    const cost = (id: string) => MODEL_OPTIONS[id].cost(defaultSelection(id));
    expect(cost('kie/gpt-image-2')).toBeLessThan(cost('gpt-image-2'));
    expect(cost('kie/nano-banana-pro')).toBeLessThan(cost('nano-banana-pro'));
  });
});
