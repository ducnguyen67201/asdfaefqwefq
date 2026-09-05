export const TROCODE_IS_TEST_APP = process.env.TROCODE_APP_ENV === 'test';
export const TROCODE_EXECUTABLE_NAME = TROCODE_IS_TEST_APP ? 'Tro Test' : 'Tro';
export const TROCODE_APP_BUNDLE_ID = TROCODE_IS_TEST_APP
  ? 'com.trocode.desktop.test'
  : 'com.trocode.desktop';
export const TROCODE_HELPER_BUNDLE_ID = `${TROCODE_APP_BUNDLE_ID}.helper`;
