import { build } from 'esbuild';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const extensions = ['.ts', '.tsx', '.js'];

function resolveSource(base) {
  const candidates = [
    base,
    ...extensions.map((extension) => `${base}${extension}`),
    ...extensions.map((extension) => join(base, `index${extension}`)),
  ];
  return candidates.find((candidate) => {
    try {
      return existsSync(candidate) && !statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  });
}

const resolver = {
  name: 'source-resolver',
  setup(buildApi) {
    buildApi.onResolve({ filter: /^\.\.?\// }, (args) => {
      const requested = resolve(dirname(args.importer), args.path);
      const withoutJs = requested.endsWith('.js') ? requested.slice(0, -3) : requested;
      const match = resolveSource(withoutJs);
      return match ? { path: match } : undefined;
    });
  },
};

for (const entry of ['api/index.ts', 'api/cron.ts']) {
  await build({
    entryPoints: [entry],
    outfile: entry.replace(/\.ts$/, '.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    packages: 'external',
    sourcemap: false,
    tsconfig: 'tsconfig.json',
    plugins: [resolver],
    logLevel: 'info',
  });
}
