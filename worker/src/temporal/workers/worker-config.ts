/**
 * Webpack bundler configuration for the Temporal worker.
 *
 * Contains the webpackConfigHook that customises module resolution
 * (e.g. `.workflow` extensions), externalises native bindings like
 * `node-pty`, and replaces swc-loader with ts-loader for compatibility.
 */

import { createRequire } from 'node:module';

/**
 * Returns the `bundlerOptions` object accepted by `Worker.create()`.
 */
export function createBundlerOptions() {
  return {
    ignoreModules: ['child_process'],
    webpackConfigHook: (config: any) => {
      // Configure extension resolution for ES modules
      // Add .workflow, .ts to handle all file types
      if (config?.resolve) {
        if (config.resolve?.extensions && Array.isArray(config.resolve.extensions)) {
          // Add custom extensions for Temporal workflows
          const customExts = ['.workflow', '.ts', '.workflow.js'];
          customExts.forEach((ext) => {
            if (!config.resolve.extensions.includes(ext)) {
              config.resolve.extensions.unshift(ext);
            }
          });
        }
        // Also configure module resolution to handle these extensions
        if (!config.resolve.extensionAlias) {
          config.resolve.extensionAlias = {};
        }
        config.resolve.extensionAlias['.workflow'] = ['.workflow.js', '.workflow'];
      }

      // Ensure node-pty native bindings are not bundled (they only load at runtime on the host)
      if (Array.isArray(config?.externals)) {
        config.externals.push({ 'node-pty': 'commonjs node-pty' });
      } else if (typeof config?.externals === 'object' && config.externals !== null) {
        config.externals = {
          ...config.externals,
          'node-pty': 'commonjs node-pty',
        };
      } else {
        config.externals = {
          'node-pty': 'commonjs node-pty',
        };
      }

      // Force webpack to transpile TypeScript with ts-loader instead of swc-loader.
      // swc native bindings can fail to load on some Node/OS combos when installed via Bun.
      try {
        const require = createRequire(import.meta.url);
        if (config?.module?.rules && Array.isArray(config.module.rules)) {
          config.module.rules = config.module.rules.map((rule: any) => {
            const usesSwc =
              typeof rule?.use === 'object' &&
              rule.use?.loader &&
              /swc-loader/.test(String(rule.use.loader));
            const isTsRule = rule && rule.test && rule.test.toString() === /\.ts$/.toString();
            if (usesSwc || isTsRule) {
              return {
                ...rule,
                test: /\.ts$/,
                exclude: /node_modules/,
                use: {
                  loader: require.resolve('ts-loader'),
                  options: {
                    transpileOnly: true,
                    compilerOptions: { target: 'ES2017' },
                  },
                },
              };
            }
            return rule;
          });
        }
      } catch (_err: unknown) {
        console.warn(
          'Failed to apply webpackConfigHook override; falling back to default SWC loader',
          _err,
        );
      }
      return config;
    },
  };
}
