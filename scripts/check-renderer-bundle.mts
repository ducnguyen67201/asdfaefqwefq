import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
import webpack, { type Configuration } from 'webpack';

import { rendererConfig } from '../webpack.renderer.config.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

export async function checkRendererBundle(
  entry: Configuration['entry'] = {
    main_window: './src/renderer.tsx',
    screen_recording: './src/screen-recording-registration-renderer.ts',
  },
  outputPath = resolve(root, '.webpack/ci-renderer'),
): Promise<void> {
  const compiler = webpack({
    ...rendererConfig,
    context: root,
    target: 'web',
    mode: 'production',
    entry,
    // Exercise the real loaders and asset resolution, without native packaging
    // or a second typecheck. Minification remains part of platform packaging.
    optimization: { ...rendererConfig.optimization, minimize: false },
    plugins: rendererConfig.plugins?.filter((plugin) => !(plugin instanceof ForkTsCheckerWebpackPlugin)),
    output: { path: outputPath, filename: '[name]/index.js', globalObject: 'self', clean: true },
  });
  if (!compiler) throw new Error('Could not create the renderer compiler.');
  await new Promise<void>((accept, reject) => {
    compiler.run((error, stats) => {
      const failure = error ?? (stats?.hasErrors()
        ? new Error(stats.toString({ all: false, errors: true })) : undefined);
      compiler.close((closeError) => {
        if (failure || closeError) reject(failure ?? closeError);
        else if (!stats) reject(new Error('Renderer compilation returned no result.'));
        else accept();
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await checkRendererBundle();
  console.log('Renderer entries and referenced assets bundled successfully.');
}
