/**
 * Retry utility with exponential backoff
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>
): Promise<T> {
  let lastError: Error;
  const maxRetries = 3;
  const baseDelay = 1000;
  const maxDelay = 30000;
  const backoffMultiplier = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxRetries) {
        throw new Error(
          `Operation failed after ${maxRetries + 1} attempts: ${lastError.message}`
        );
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        baseDelay * Math.pow(backoffMultiplier, attempt),
        maxDelay
      );

      console.log(`Attempt ${attempt + 1} failed: ${lastError.message}. Retrying in ${delay}ms...`);

      await sleep(delay);
    }
  }

  throw lastError!;
}

/**
 * Utility function for delays
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
