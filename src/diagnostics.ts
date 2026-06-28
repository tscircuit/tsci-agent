export function reportDiagnostics(diagnostics: Array<{ type: string; message: string }>) {
  for (const diagnostic of diagnostics) {
    const prefix = diagnostic.type === "error" ? "error" : diagnostic.type === "warning" ? "warning" : "info";
    console.error(`[${prefix}] ${diagnostic.message}`);
  }
}
