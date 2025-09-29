/**
 * Safely parse JSON from a response, checking content-type first
 */
export async function safeJsonParse(response: Response): Promise<any | null> {
  const contentType = response.headers.get('content-type');

  if (!contentType || !contentType.includes('application/json')) {
    console.warn(`Expected JSON response but got: ${contentType}`);
    return null;
  }

  try {
    return await response.json();
  } catch (error) {
    console.error('Failed to parse JSON response:', error);
    return null;
  }
}

/**
 * Fetch with safe JSON parsing
 */
export async function fetchJson(url: string, options?: RequestInit): Promise<any | null> {
  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      console.warn(`Fetch failed with status ${response.status}: ${url}`);
      return null;
    }

    return await safeJsonParse(response);
  } catch (error) {
    console.error(`Fetch error for ${url}:`, error);
    return null;
  }
}