import path from 'node:path';

import { config as loadEnvironment } from 'dotenv';
import { type Configuration } from 'webpack';

import { plugins } from './webpack.plugins';
import { rules } from './webpack.rules';

loadEnvironment({
  path: [
    path.resolve(__dirname, '.env.local'),
    path.resolve(__dirname, '.env'),
  ],
  quiet: true,
});

export const mainConfig: Configuration = {
  /**
   * This is the main entry point for your application, it's the first file
   * that runs in the main process.
   */
  entry: './src/index.ts',
  // Put your normal webpack config below here
  module: {
    rules,
  },
  plugins: [...plugins],
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.json'],
  },
};
