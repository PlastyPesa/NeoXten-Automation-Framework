export function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

export async function readJson(res) {
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      `Expected JSON body, got parse error. status=${res.status} body=${text.slice(0, 400)}`,
    );
  }
  return { body, text };
}

/** 1×1 transparent PNG */
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
