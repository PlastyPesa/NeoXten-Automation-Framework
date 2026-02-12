export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { retries?: number; onRetry?: (attempt: number) => void } = {}
): Promise<{ result: T; flaky: boolean }> {
  const retries = options.retries ?? 1;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await fn();
      return { result, flaky: attempt > 0 };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < retries) {
        options.onRetry?.(attempt + 1);
      }
    }
  }
  throw lastError;
}
