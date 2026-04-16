import type { Service } from './index';
import { fileURLToPath } from 'url';
import { extname } from 'path';
import { normalizeSlashes } from './util';
import { assertScriptCanLoadAsCJS } from '../dist-raw/node-internal-modules-cjs-loader';

/** @internal */
export function registerWithHooks(service: Service) {
  const Module = require('module');
  const compiledExtensions = new Set(service.extensions.compiled);
  const { nodeEquivalents } = service.extensions;

  return Module.registerHooks({
    load(
      url: string,
      context: { format?: string; conditions?: string[] },
      nextLoad: (url: string, context: any) => any
    ) {
      if (!service.enabled()) {
        return nextLoad(url, context);
      }

      if (!url.startsWith('file://')) {
        return nextLoad(url, context);
      }

      const nativePath = fileURLToPath(url);

      const ext = extname(nativePath);

      if (!compiledExtensions.has(ext)) {
        return nextLoad(url, context);
      }

      if (service.ignored(nativePath)) {
        return nextLoad(url, context);
      }

      // Guard: throw ERR_REQUIRE_ESM when require() targets an ESM-only file,
      // matching legacy require.extensions behavior.
      if (context.format === 'commonjs') {
        assertScriptCanLoadAsCJS(service, { parent: null } as any, nativePath);
      }

      // Determine format based on module type classification and extension
      const format =
        context.format ||
        (() => {
          const { moduleType } = service.moduleTypeClassifier.classifyModuleByModuleTypeOverrides(
            normalizeSlashes(nativePath)
          );
          if (moduleType === 'cjs') return 'commonjs';
          if (moduleType === 'esm') return 'module';
          // 'auto' — infer from the extension's node equivalent
          const equivalent = nodeEquivalents.get(ext);
          if (equivalent === '.mjs') return 'module';
          if (equivalent === '.cjs') return 'commonjs';
          return undefined;
        })();

      const result = nextLoad(url, { ...context, format });

      if (result.source == null) {
        return result;
      }

      const sourceStr = typeof result.source === 'string' ? result.source : result.source.toString('utf8');

      const compiled = service.compile(sourceStr, nativePath);

      return {
        source: compiled,
        format: result.format ?? format,
        shortCircuit: true,
      };
    },
  });
}
