import crypto from 'crypto';
import { ApiCredentials } from '../types';


// Generate timestamp (milliseconds)
export function getTimestamp(): number {
  return Date.now();
}

// Build signed form data (for POST/PUT endpoints) - signs the exact payload that will be sent
export function buildSignedForm(params: Record<string, any>, credentials: ApiCredentials): URLSearchParams {
  const timestamp = getTimestamp();

  // Add required parameters
  const finalParams: Record<string, any> = {
    ...params,
    timestamp,
    recvWindow: 20000  // Increased from 5000ms to handle queue delays and prevent timestamp errors
  };

  // Build URLSearchParams in the order keys will be sent (insertion order)
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(finalParams)) {
    if (value !== undefined && value !== null) {
      sp.append(key, String(value));
    }
  }

  // Sign the exact string that will be sent (before appending signature)
  const preSign = sp.toString();
  const hmac = crypto.createHmac('sha256', credentials.secretKey);
  hmac.update(preSign);
  const signature = hmac.digest('hex');

  // Append signature as the final parameter
  sp.append('signature', signature);

  return sp;
}

// Build signed query string (for GET/DELETE endpoints)
export function buildSignedQuery(params: Record<string, any>, credentials: ApiCredentials): string {
  const sp = buildSignedForm(params, credentials);
  // URLSearchParams.toString() automatically URL-encodes, which is what we want
  return sp.toString();
}

// Keep the old functions for backward compatibility (deprecated - use buildSignedForm/buildSignedQuery instead)
export function getSignedParams(params: Record<string, any>, credentials: ApiCredentials): Record<string, any> {
  const sp = buildSignedForm(params, credentials);
  const result: Record<string, any> = {};
  for (const [key, value] of sp.entries()) {
    result[key] = value;
  }
  return result;
}

export function paramsToQuery(params: Record<string, any>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      sp.append(key, String(value));
    }
  }
  return sp.toString();
}
