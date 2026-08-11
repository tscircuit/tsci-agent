const UTF8_DECODER = new TextDecoder();

export function replaceResumeCommandPi(text: string): string {
  return text.replace(/pi (?=--session)/, "tsci-agent ");
}

export function rebrandResumeChunk(chunk: string | Uint8Array): string | Uint8Array {
  const text = chunk instanceof Uint8Array ? UTF8_DECODER.decode(chunk) : chunk;
  return text.includes("To resume this session") ? replaceResumeCommandPi(text) : chunk;
}

interface StdoutWrite {
  (chunk: string | Uint8Array, cb?: (error?: Error | null) => void): boolean;
  (chunk: string | Uint8Array, encoding?: BufferEncoding, cb?: (error?: Error | null) => void): boolean;
}

export function installResumeCommandRebrand(): void {
  const originalWrite = process.stdout.write.bind(process.stdout);
  const wrappedWrite: StdoutWrite = (chunk, ...rest) => {
    const rebranded = rebrandResumeChunk(chunk);
    return originalWrite(rebranded, ...(rest as [BufferEncoding?, ((error?: Error | null) => void)?]));
  };
  process.stdout.write = wrappedWrite;
}
