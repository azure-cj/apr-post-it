// After a signed `tauri build`: the files to upload to a release in the releases repo, in
// src-tauri/target/release/upload. The installer is copied under a name with no spaces (GitHub
// would turn them into dots), and latest.json says where it is and carries its signature: the
// installed apps read it to find a newer version.
//
//   node scripts/release-files.mjs "What changed, in a sentence"

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = 'azure-cj/apr-post-it';

const conf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const version = conf.version;
const nsis = 'src-tauri/target/release/bundle/nsis';
const built = join(nsis, `${conf.productName}_${version}_x64-setup.exe`);
if (!existsSync(built) || !existsSync(`${built}.sig`)) {
  console.error(`No signed installer for ${version} in ${nsis}. Run release.ps1 to build it.`);
  process.exit(1);
}

const name = `APG-Post-It_${version}_x64-setup.exe`;
const upload = 'src-tauri/target/release/upload';
mkdirSync(upload, { recursive: true });
copyFileSync(built, join(upload, name));

const latest = {
  version,
  notes: (process.argv[2] ?? '').trim(),
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: readFileSync(`${built}.sig`, 'utf8').trim(),
      url: `https://github.com/${REPO}/releases/download/v${version}/${name}`,
    },
  },
};
writeFileSync(join(upload, 'latest.json'), `${JSON.stringify(latest, null, 2)}\n`);

console.log(`Ready to upload, from ${upload}:`);
console.log(`  ${name}`);
console.log('  latest.json');
console.log(`Make a release tagged v${version} in https://github.com/${REPO}/releases/new and attach both.`);
