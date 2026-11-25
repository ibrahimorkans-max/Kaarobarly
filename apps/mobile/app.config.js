const fs = require('fs');
const path = require('path');

/**
 * app.json plus two optional extras:
 * - the Firebase file when it is present: push notifications need google-services.json
 *   (Firebase console → Project settings → Android app com.zhtrader.kaarobarly). Without it only push is unavailable.
 * - WEB_BASE_URL (e.g. /app) when exporting the web app to live under a path of the website.
 */
module.exports = ({ config }) => {
  let out = config;
  const file = path.join(__dirname, 'google-services.json');
  if (fs.existsSync(file)) out = { ...out, android: { ...out.android, googleServicesFile: './google-services.json' } };
  if (process.env.WEB_BASE_URL) out = { ...out, experiments: { ...out.experiments, baseUrl: process.env.WEB_BASE_URL } };
  return out;
};
