import ForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';

// CI packaging depends on the source job, which already typechecked this revision.
// Local development and release workflows retain webpack's typecheck by default.
const checkedByCi = process.env.CI === 'true'
  && process.env.TROCODE_CI_TYPECHECK_PASSED === 'true';

export const plugins = checkedByCi ? [] : [
  new ForkTsCheckerWebpackPlugin({
    logger: 'webpack-infrastructure',
  }),
];
