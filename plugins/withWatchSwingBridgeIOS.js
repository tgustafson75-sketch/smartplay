/**
 * 2026-08-25 — Registers the Apple Watch phone-side bridge with the iOS app target.
 *
 * WHY THIS DOES MORE THAN COPY FILES. The sibling plugins (withBluetoothMediaButton,
 * withMediaPipePose) copy their Swift/Obj-C into the prebuilt tree and stop there. Copying a source
 * file into a folder does NOT add it to the Xcode target's "Sources" build phase, so that pattern
 * relies on something else picking the files up. Rather than assume it does, this plugin copies AND
 * explicitly registers both files with the app target's compile sources. If the copy-only pattern
 * happens to work, this is merely belt-and-braces; if it does not, the difference is a watch bridge
 * that exists in the repo and does not exist in the binary — the exact half-build shape this project
 * keeps paying for.
 *
 * Idempotent: re-running prebuild will not duplicate the entries.
 */

const { withDangerousMod, withXcodeProject } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const FILES = ['WearSwingBridgeModule.swift', 'WearSwingBridge.m'];
const GROUP_DIR = 'WatchBridge';

function withCopy(config) {
  return withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const platformRoot = modConfig.modRequest.platformProjectRoot;
      const sourceDir = path.join(projectRoot, 'ios-native');
      // Mirrors the sibling plugins' location so all hand-written native code sits together.
      const appDir = fs
        .readdirSync(platformRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory() && fs.existsSync(path.join(platformRoot, d.name, 'AppDelegate.swift')))
        .map((d) => d.name)[0];
      if (!appDir) {
        console.warn('[withWatchSwingBridgeIOS] could not locate the app target directory — skipping copy');
        return modConfig;
      }
      const targetDir = path.join(platformRoot, appDir, GROUP_DIR);
      try {
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        for (const f of FILES) {
          const src = path.join(sourceDir, f);
          if (fs.existsSync(src)) fs.copyFileSync(src, path.join(targetDir, f));
          else console.warn(`[withWatchSwingBridgeIOS] missing source ${f}`);
        }
        console.log('[withWatchSwingBridgeIOS] iOS sources copied');
      } catch (e) {
        console.warn('[withWatchSwingBridgeIOS] iOS source copy failed (non-fatal):', e.message);
      }
      return modConfig;
    },
  ]);
}

function withCompileSources(config) {
  return withXcodeProject(config, (modConfig) => {
    try {
      const proj = modConfig.modResults;
      const appName = modConfig.modRequest.projectName;
      const groupPath = `${appName}/${GROUP_DIR}`;

      // Reuse the group if a prior prebuild made one — never stack duplicates.
      let groupKey = proj.findPBXGroupKey({ name: GROUP_DIR });
      if (!groupKey) {
        groupKey = proj.pbxCreateGroup(GROUP_DIR, groupPath);
        const mainKey = proj.findPBXGroupKey({ name: appName }) || proj.getFirstProject().firstProject.mainGroup;
        if (mainKey) proj.addToPbxGroup(groupKey, mainKey);
      }

      const targetUuid = proj.getFirstTarget().uuid;
      for (const f of FILES) {
        const rel = `${groupPath}/${f}`;
        // .m compiles; .swift compiles. Both belong to Sources, and both must be skipped if the
        // file is already registered — addSourceFile throws on a duplicate path.
        const already = JSON.stringify(proj.hash.project.objects.PBXBuildFile || {}).includes(f);
        if (already) continue;
        proj.addSourceFile(rel, { target: targetUuid }, groupKey);
      }
      console.log('[withWatchSwingBridgeIOS] iOS sources registered with the app target');
    } catch (e) {
      console.warn('[withWatchSwingBridgeIOS] Xcode registration failed (non-fatal):', e.message);
    }
    return modConfig;
  });
}

module.exports = (config) => withCompileSources(withCopy(config));
