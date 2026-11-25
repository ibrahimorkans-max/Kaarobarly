/**
 * Builds a signed release APK on this computer (needs JDK 17 and the Android SDK).
 *   node scripts/build-apk.cjs
 * Output: ../../dist/Tijar-<version>.apk
 *
 * The signing key lives in apps/mobile/credentials (git-ignored). Keep a backup of that folder:
 * Android only installs an update over an existing app when it is signed with the same key.
 *
 * Run it on Linux, macOS or WSL. On plain Windows the native (C++) step fails because its file paths
 * exceed 260 characters. In WSL: copy the repo (with credentials/) to the Linux disk, `npm ci`, then run this.
 * To ship an update, raise "version" and android.versionCode in app.json first.
 */
const { execFileSync, execSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const creds = path.join(root, 'credentials');
const keystore = path.join(creds, 'kaarobarly-release.keystore');
const propsFile = path.join(creds, 'keystore.json');
const app = require(path.join(root, 'app.json')).expo;
const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', cwd: root, ...opts });

// 1. Signing key (created once)
fs.mkdirSync(creds, { recursive: true });
if (!fs.existsSync(keystore)) {
  const password = crypto.randomBytes(18).toString('base64url');
  const props = { storePassword: password, keyAlias: 'kaarobarly', keyPassword: password };
  console.log('==> Creating the release signing key in credentials/ (back this folder up)');
  execFileSync('keytool', [
    '-genkeypair', '-v', '-storetype', 'PKCS12', '-keystore', keystore, '-alias', props.keyAlias,
    '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
    '-storepass', password, '-keypass', password, '-dname', 'CN=Kaarobarly, O=ZH Trader, C=PK',
  ], { stdio: 'inherit' });
  fs.writeFileSync(propsFile, JSON.stringify(props, null, 2));
}
const props = JSON.parse(fs.readFileSync(propsFile, 'utf8'));

// 2. Native project from app.json. Kept between builds so Gradle reuses compiled native code
//    (minutes instead of half an hour); CLEAN=1 regenerates it from scratch.
const fresh = process.env.CLEAN === '1' || !fs.existsSync(path.join(root, 'android/app/build.gradle'));
console.log(fresh ? '==> Generating the Android project' : '==> Updating the Android project (CLEAN=1 for a full rebuild)');
run(`npx expo prebuild --platform android --no-install${fresh ? ' --clean' : ''}`);

// 3. Use the release key instead of the debug key
const gradleFile = path.join(root, 'android/app/build.gradle');
let gradle = fs.readFileSync(gradleFile, 'utf8');
const ks = keystore.replace(/\\/g, '/');
// an updated (not regenerated) project already has the release key
if (!gradle.includes(`storeFile file('${ks}')`)) gradle = gradle.replace(
  /signingConfigs\s*\{/,
  `signingConfigs {
        release {
            storeFile file('${ks}')
            storePassword '${props.storePassword}'
            keyAlias '${props.keyAlias}'
            keyPassword '${props.keyPassword}'
        }`,
);
gradle = gradle.replace(/(release\s*\{[^}]*?)signingConfig signingConfigs\.debug/, '$1signingConfig signingConfigs.release');
if (!gradle.includes('signingConfig signingConfigs.release')) throw new Error('Could not switch the release build to the release key; check android/app/build.gradle');
fs.writeFileSync(gradleFile, gradle);

// 4. Phones only (skip x86 emulator code: smaller APK, faster build).
//    FAST=1 builds 64-bit phones only (about half the native work) for quick test builds;
//    releases keep 32-bit too, because many low-cost phones still run 32-bit Android.
const fast = process.env.FAST === '1';
const gp = path.join(root, 'android/gradle.properties');
const setProp = (text, key, value) => (new RegExp(`^${key.replace(/\./g, '\\.')}=`, 'm').test(text) ? text.replace(new RegExp(`^${key.replace(/\./g, '\\.')}=.*$`, 'm'), `${key}=${value}`) : `${text.replace(/\n*$/, '\n')}${key}=${value}\n`);
let props2 = fs.readFileSync(gp, 'utf8');
props2 = setProp(props2, 'reactNativeArchitectures', fast ? 'arm64-v8a' : 'armeabi-v7a,arm64-v8a');
// half the cores in parallel: much faster than 2, still inside 8 GB of memory
props2 = setProp(props2, 'org.gradle.workers.max', String(Math.max(2, Math.min(4, Math.floor(require('node:os').cpus().length / 2)))));
// reuse outputs of earlier builds when inputs did not change
props2 = setProp(props2, 'org.gradle.caching', 'true');
fs.writeFileSync(gp, props2);
if (fast) console.log('==> FAST build: 64-bit phones only');

// 5. Build
console.log('==> Building the release APK (first build takes 10-30 minutes)');
const androidDir = path.join(root, 'android');
const gradlew = path.join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
run(`"${gradlew}" assembleRelease --no-daemon --build-cache -x lintVitalAnalyzeRelease -x lintVitalReportRelease -x lintVitalRelease`, { cwd: androidDir, env: { ...process.env, NODE_ENV: 'production' } });

// 6. Copy out
const built = path.join(root, 'android/app/build/outputs/apk/release/app-release.apk');
const outDir = path.resolve(root, '../../dist');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `Tijar-${app.version}.apk`);
fs.copyFileSync(built, out);
console.log(`==> APK ready: ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
