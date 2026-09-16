export function dataUrlForImage(image) {
  return `data:${image.contentType ?? 'image/png'};base64,${image.base64}`;
}

export async function responseJson(response, providerName) {
  const text = await response.text();
  let value = {};
  if (text) {
    try {
      value = JSON.parse(text);
    } catch {
      throw httpError(`${providerName} returned invalid JSON with status ${response.status}.`, response.status);
    }
  }
  if (!response.ok) {
    const message = value.error?.message
      ?? value.message
      ?? value.detail
      ?? value.base_resp?.status_msg
      ?? `${providerName} request failed with status ${response.status}.`;
    const error = httpError(String(message), response.status);
    error.details = value;
    throw error;
  }
  return value;
}

export async function downloadImage(fetchImplementation, url, providerName) {
  const response = await fetchImplementation(url);
  if (!response.ok) throw httpError(`${providerName} image download failed with status ${response.status}.`, response.status);
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type')?.split(';')[0] ?? 'image/png',
  };
}

export function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function nonNegativeNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
