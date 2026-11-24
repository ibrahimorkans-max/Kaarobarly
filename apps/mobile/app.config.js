const fs = require('fs');
const path = require('path');

/**
 * app.json plus the Firebase file when it is present: push notifications need
 * google-services.json (Firebase console → Project settings → Android app com.zhtrader.kaarobarly).
 * Without it the app builds and runs; only push is unavailable.
 */
module.exports = ({ config }) => {
  const file = path.join(__dirname, 'google-services.json');
  if (!fs.existsSync(file)) return config;
  return { ...config, android: { ...config.android, googleServicesFile: './google-services.json' } };
};
