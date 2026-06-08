// SERVER-ONLY. The "style transfer" recipe lives here and never reaches the
// client. It turns a style reference (+ an optional content image and/or a
// text prompt) into a single FAL edit prompt. The hard part of a `--sref`-style
// tool is separating STYLE from CONTENT — these prompts spell that out
// explicitly so the edit model copies the look, not the subject.

// What "style" means, repeated to every variant so the model stays on the look
// and off the subject of the reference.
const STYLE_DEFINITION =
  'color palette, lighting, contrast, texture, materials, medium and rendering technique (e.g. oil paint, 3D render, film photo), grain, line work and overall mood';

export interface BuildStyleTransferArgs {
  /** User subject/scene to create in the reference style. Optional if a content image is given. */
  prompt?: string;
  /** True when a second image was supplied to be re-skinned with the reference look. */
  hasContentImage: boolean;
}

/**
 * Build the single FAL edit prompt. Image order is fixed by the route:
 *   image #1 = STYLE reference (always)
 *   image #2 = CONTENT image (only when hasContentImage)
 */
export function buildStyleTransferPrompt({ prompt, hasContentImage }: BuildStyleTransferArgs): string {
  const subject = prompt?.trim();

  if (hasContentImage) {
    // Two images: restyle the second using the first's look. An optional prompt
    // nudges the result without overriding the content image's subject.
    return [
      `Re-render the SECOND image in the visual style of the FIRST image.`,
      `Keep the subject, pose, layout and composition of the second image intact.`,
      `Apply ONLY the first image's ${STYLE_DEFINITION}. Do not import the first image's subject, objects or scene.`,
      subject ? `Extra direction: ${subject}.` : '',
      'Output: a single, polished, high-quality image. Sharp and coherent, no watermarks, no text artifacts.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  // One image + a prompt: create a NEW subject in the reference's style.
  return [
    `Create a NEW image of: ${subject}.`,
    `Use the provided reference image PURELY as a style reference — replicate its ${STYLE_DEFINITION}.`,
    `Do NOT copy the subject, objects, characters or composition of the reference. Only its look and feel should carry over.`,
    'Output: a single, polished, high-quality image. Sharp and coherent, no watermarks, no text artifacts.',
  ].join('\n');
}
