/**
 * 2026-10-13 — the first real field users. An iPhone 13 (1.0.2+31) filed pose_zero_frames on every
 * swing: no on-device pose module on iOS, and the cloud proxy unconfigured. The iOS module had been
 * written in May and never reached a binary — withMediaPipePose copied the Swift/ObjC into ios/ but
 * never registered them with the Xcode target, never put the model in Copy Bundle Resources, and the
 * Swift called PoseLandmarker.close(), which does not exist on iOS (it could not have compiled).
 *
 * These run the REAL plugin against an Xcode project and a Podfile, so they fail the way the build
 * would: a source not in Compile Sources, a model not in the bundle, a pod left floating. The rest —
 * that it compiles and detects a golfer — was proven on the simulator and is noted in the plugin.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const xcode = require('xcode');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const withMediaPipePose = require('../../plugins/withMediaPipePose');

const root = path.join(__dirname, '..', '..');
const APP = 'SmartPlayCaddie';

type Mod = (c: Record<string, unknown>) => Promise<Record<string, unknown>>;

function iosMods(): { xcodeproj: Mod; dangerous: Mod } {
  const cfg = withMediaPipePose({ name: 'x', slug: 'x' });
  return cfg.mods.ios;
}

function modRequest(platformProjectRoot: string) {
  return { projectName: APP, projectRoot: root, platformProjectRoot, platform: 'ios', introspect: false };
}

async function runXcode(proj: unknown): Promise<string> {
  const out = await iosMods().xcodeproj({ name: 'x', slug: 'x', modResults: proj, modRequest: modRequest(os.tmpdir()) });
  return (out.modResults as { writeSync(): string }).writeSync();
}

function freshProject() {
  const p = xcode.project(path.join(__dirname, '..', 'fixtures', 'minimal-app.pbxproj'));
  p.parseSync();
  return p;
}

/** The entries of one build phase, by its comment name. */
function phase(pbx: string, name: 'Sources' | 'Resources'): string {
  const m = new RegExp(`/\\* ${name} \\*/ = \\{\\s*isa = PBX${name}BuildPhase;[\\s\\S]*?files = \\(([\\s\\S]*?)\\);`).exec(pbx);
  if (!m) throw new Error(`${name} build phase not found`);
  return m[1];
}

describe('the iOS pose module reaches the binary', () => {
  it('the Swift and ObjC bridge are in the app target\'s Compile Sources', async () => {
    const pbx = await runXcode(freshProject());
    const src = phase(pbx, 'Sources');
    expect(src).toContain('MediaPipePoseModule.swift in Sources');
    expect(src).toContain('MediaPipePose.m in Sources');
  });

  it('every bundled model is in Copy Bundle Resources (the bundle ROOT the Swift reads)', async () => {
    const pbx = await runXcode(freshProject());
    const res = phase(pbx, 'Resources');
    const models = fs.readdirSync(path.join(root, 'assets', 'mediapipe')).filter((f) => f.endsWith('.task'));
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) expect(res).toContain(`${m} in Resources`);
    expect(pbx).toMatch(new RegExp(`path = "?${APP}/MediaPipe/pose_landmarker_full\\.task"?;`));
  });

  it('sources are bare filenames inside <app>/MediaPipe — a doubled path is what failed build 16', async () => {
    const pbx = await runXcode(freshProject());
    // the serializer may or may not quote; the PATH is what matters
    expect(pbx).toMatch(/name = "?MediaPipePoseModule\.swift"?; path = "?MediaPipePoseModule\.swift"?;/);
    expect(pbx).toMatch(new RegExp(`path = "?${APP}/MediaPipe"?;`));
  });

  it('re-running prebuild does not register anything twice', async () => {
    const p = freshProject();
    await runXcode(p);
    const pbx = await runXcode(p);
    expect(pbx.match(/MediaPipePoseModule\.swift in Sources \*\/ = /g)?.length).toBe(1);
    expect(pbx.match(/pose_landmarker_full\.task in Resources \*\/ = /g)?.length).toBe(1);
  });

  it('the Podfile pins the exact pod the module was compiled and run against', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-ios-'));
    fs.writeFileSync(path.join(dir, 'Podfile'), "target 'SmartPlayCaddie' do\n  use_react_native!(\n  )\nend\n");
    await iosMods().dangerous({ name: 'x', slug: 'x', modResults: null, modRequest: modRequest(dir) });
    const podfile = fs.readFileSync(path.join(dir, 'Podfile'), 'utf8');
    expect(podfile).toContain("pod 'MediaPipeTasksVision', '0.10.35'");
    expect(podfile).not.toMatch(/MediaPipeTasksVision', '~>/);
    // and the sources + models the Xcode step references were actually copied beside it
    for (const f of ['MediaPipePoseModule.swift', 'MediaPipePose.m', 'pose_landmarker_full.task']) {
      expect(fs.existsSync(path.join(dir, APP, 'MediaPipe', f))).toBe(true);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('the Swift module uses the iOS API, not Android\'s', () => {
  const swift = fs.readFileSync(path.join(root, 'ios-native', 'MediaPipePoseModule.swift'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('never calls close() — iOS PoseLandmarker has none (Android\'s does); it did not compile', () => {
    expect(swift).not.toMatch(/\.close\(\)/);
  });

  it('reads the model from the bundle root, where Copy Bundle Resources puts it', () => {
    expect(swift).toContain('Bundle.main.path(forResource: name, ofType: "task")');
    expect(swift).not.toContain('inDirectory:');
  });
});
