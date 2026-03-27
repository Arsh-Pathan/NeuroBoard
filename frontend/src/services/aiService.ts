/**
 * AI Service — communicates with the unified /ai-process backend endpoint.
 * Handles both shape detection and math solving in a single call.
 */

const API_BASE_URL = '/api';
const AI_TIMEOUT_MS = 30_000;

// --- Response Types ---

export interface DetectedShape {
  type: 'rectangle' | 'circle' | 'triangle' | 'diamond' | 'arrow' | 'line';
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number | null;
  points?: number[] | null; // [x1, y1, x2, y2] for arrows/lines
  confidence: number;
}

export interface MathResult {
  equation: string;
  solution: string;
}

export interface AIProcessResponse {
  shapes: DetectedShape[];
  math: MathResult | null;
  raw_text: string;
  error?: string | null;
}

// --- Legacy types for backward compat ---

export interface MathResponse {
  equation: string;
  solution: string;
  error?: string;
}

export interface ShapeResponse {
  shape: string;
  confidence: number;
}

// --- Helpers ---

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// --- Service ---

export const aiService = {
  /**
   * Unified AI processing: sends a canvas snapshot (base64) and receives
   * detected shapes + solved math in a single response.
   */
  async processCanvas(imageBase64: string): Promise<AIProcessResponse> {
    try {
      const response = await fetchWithTimeout(
        `${API_BASE_URL}/ai-process`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_base64: imageBase64 }),
        },
        AI_TIMEOUT_MS,
      );

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Server error ${response.status}: ${text}`);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { shapes: [], math: null, raw_text: '', error: 'Request timed out' };
      }
      console.error('AI Service Error:', error);
      return {
        shapes: [],
        math: null,
        raw_text: '',
        error: error instanceof Error ? error.message : 'Could not connect to AI service',
      };
    }
  },

  /**
   * Legacy: Sends a base64 snapshot to solve math equations only.
   */
  async solveMath(imageBase64: string): Promise<MathResponse> {
    try {
      const response = await fetchWithTimeout(
        `${API_BASE_URL}/solve-math`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_base64: imageBase64 }),
        },
        AI_TIMEOUT_MS,
      );

      if (!response.ok) {
        throw new Error('Failed to solve math');
      }

      return await response.json();
    } catch (error) {
      console.error('AI Service Error (Math):', error);
      return { equation: '', solution: '', error: 'Could not connect to AI service' };
    }
  },

  /**
   * Legacy: Sends stroke data to detect shapes.
   */
  async detectShapes(imageBase64: string): Promise<ShapeResponse | null> {
    try {
      const response = await fetchWithTimeout(
        `${API_BASE_URL}/canvas/detect-shapes`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_base64: imageBase64 }),
        },
        AI_TIMEOUT_MS,
      );

      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.error('AI Service Error (Shapes):', error);
      return null;
    }
  },
};
