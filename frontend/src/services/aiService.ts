/**
 * AI Service for communicating with the backend API.
 * Handles math solving and shape detection.
 */

const API_BASE_URL = '/api';

export interface MathResponse {
  equation: string;
  solution: string;
  error?: string;
}

export interface ShapeResponse {
  shape: string;
  confidence: number;
}

export const aiService = {
  /**
   * Sends a base64 snapshot of the canvas to solve mathematical equations.
   */
  async solveMath(imageBase64: string): Promise<MathResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/solve-math`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image_base64: imageBase64 }),
      });

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
   * Sends a base64 snapshot to detect and suggest cleaner shapes.
   */
  async detectShapes(imageBase64: string): Promise<ShapeResponse | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/canvas/detect-shapes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image_base64: imageBase64 }),
      });

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error('AI Service Error (Shapes):', error);
      return null;
    }
  },
};
