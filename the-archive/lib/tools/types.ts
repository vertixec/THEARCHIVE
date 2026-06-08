// Declarative contract for Tools shown inside the GENERATE panel.
// A tool is data: its inputs render the form, and `endpoint`/`kind` decide
// how it runs. Adding a tool = adding a registry entry, not new UI.

export type ToolInputType = 'reference-images' | 'textarea' | 'text' | 'select';

interface ToolInputBase {
  key: string;
  type: ToolInputType;
  label: string;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
}

export interface ReferenceImagesInput extends ToolInputBase {
  type: 'reference-images';
  min?: number;
  max?: number;
}

export interface TextToolInput extends ToolInputBase {
  type: 'textarea' | 'text';
  maxLength?: number;
}

export interface SelectToolInput extends ToolInputBase {
  type: 'select';
  options: { value: string; label: string }[];
}

export type ToolInput = ReferenceImagesInput | TextToolInput | SelectToolInput;

export type ToolStatus = 'live' | 'soon';

// 'image-batch' runs N image generations synchronously (Ads).
// 'pipeline' is a multi-step async job (Reels) — handled later via tool_jobs.
export type ToolKind = 'image-batch' | 'pipeline';

export interface ToolDefinition {
  id: string;
  name: string;
  tagline: string;
  description: string;
  /** Icon key resolved by the gallery (see ToolsGallery). */
  icon: string;
  status: ToolStatus;
  kind: ToolKind;
  /** API route that runs the tool. Absent while status === 'soon'. */
  endpoint?: string;
  /** How many results a single run produces (the MAX). */
  outputCount: number;
  /** Singular noun for one output, used in the run button (e.g. 'ad', 'image'). Defaults to 'result'. */
  outputNoun?: string;
  /**
   * When present, the user selects WHICH angles to generate (chips). The number
   * of outputs equals the number of selected angles. Only id + label are public.
   */
  angleOptions?: { id: string; label: string }[];
  /** Which credit bucket the run spends. */
  creditType: 'image' | 'video';
  /** Total credits a full run can cost (1 per output here). */
  creditCost: number;
  inputs: ToolInput[];
}

// Shape returned by image-batch tools (Ads).
export interface ToolImageResult {
  url: string;
  angle: string;
}

export interface ToolRunResponse {
  results: ToolImageResult[];
  requested: number;
  succeeded: number;
  credits?: { ok: boolean; credits: number; video_credits: number } | null;
}
