const UTF8_DECODER = new TextDecoder();

export function replaceResumeCommandPi(text: string): string {
  return text.replace(/pi (?=--session)/, "tsci agent ");
}

export function rebrandResumeChunk(chunk: string | Uint8Array): string | Uint8Array {
  const text = chunk instanceof Uint8Array ? UTF8_DECODER.decode(chunk) : chunk;
  return text.includes("To resume this session") ? replaceResumeCommandPi(text) : chunk;
}

export function installResumeCommandRebrand(): void {
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array, ...rest: unknown[]) => {
    const rebranded = rebrandResumeChunk(chunk);
    return originalWrite(rebranded as string, ...(rest as [BufferEncoding?, ((error?: Error | null) => void)?]));
  };
}
