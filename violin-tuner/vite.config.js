import { defineConfig } from 'vite';

// Safari may evaluate a module Worker's entry again when a lazy chunk imports it.
// That replaces its message handler and loses the model loaded by the first instance.
function preventWorkerEntryImports() {
  return {
    name: 'prevent-worker-entry-imports',
    generateBundle(_, bundle) {
      const chunks = Object.values(bundle).filter((output) => output.type === 'chunk');
      const entries = new Set(
        chunks.filter((chunk) => chunk.isEntry).map((chunk) => chunk.fileName),
      );
      for (const chunk of chunks)
        for (const dependency of [...chunk.imports, ...chunk.dynamicImports])
          if (entries.has(dependency))
            this.error(
              `Worker chunk ${chunk.fileName} imports entry ${dependency}. Move shared code out of the Worker entry or import it statically.`,
            );
    },
  };
}
export default defineConfig({
  worker: { format: 'es', plugins: () => [preventWorkerEntryImports()] },
  base: process.env.VITE_BASE_PATH || '/',
});
