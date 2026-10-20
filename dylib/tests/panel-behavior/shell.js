'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { panel, walk, details, runner, FORMS } = require('./harness');

const emit = process.argv[2];
if (!emit) { console.error('usage: shell.js <emit>'); process.exit(2); }

const TOGGLES = {
  'Metal HUD': 'MTL_HUD_ENABLED',
  'MSync': 'WINEMSYNC',
  'High Resolution': 'NOTPROTON_RETINA',
  'Advertise AVX2 to Rosetta': 'ROSETTA_ADVERTISE_AVX',
  'Let games read controllers directly (May break Steam Input. Not recommended)': 'NOTPROTON_RAW_CONTROLLERS',
  'Disable hidraw': 'NOTPROTON_DISABLE_HIDRAW',
};
const PANEL_KEYS = ['CX_GRAPHICS_BACKEND', 'MTL_HUD_ENABLED', 'D3DM_ENABLE_METALFX', 'DXMT_ENABLE_NVEXT',
  'DXMT_METALFX_SPATIAL_SWAPCHAIN', 'DXMT_CONFIG', 'ROSETTA_ADVERTISE_AVX', 'WINEMSYNC', 'NOTPROTON_RETINA',
  'NOTPROTON_RAW_CONTROLLERS', 'NOTPROTON_DISABLE_HIDRAW'];
const OTHER_KEYS = ['WINEDEBUG', 'DXVK_HUD', 'FOO', 'NOTPROTON_EXE', 'NOTPROTON_START_DIR'];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'np-shell-'));
const probe = path.join(dir, 'probe');
fs.writeFileSync(probe, '#!' + process.execPath + '\n' +
  `const k=${JSON.stringify(PANEL_KEYS.concat(OTHER_KEYS))};const e={};` +
  'k.forEach(n=>{if(n in process.env)e[n]=process.env[n]});' +
  'require("fs").appendFileSync(process.env.NP_PROBE_OUT,' +
  'JSON.stringify({argv:process.argv.slice(2),env:e})+"\\n");\n', { mode: 0o755 });
fs.writeFileSync(path.join(dir, 'gamemoderun'), '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });

const quote = s => "'" + s.replace(/'/g, "'\\''") + "'";
const COMMAND = quote(probe) + " 'game.exe'";

function steamLine(options) {
  const o = options.trim();
  return /%command%/i.test(o) ? o.replace(/%command%/gi, () => COMMAND) : COMMAND + (o ? ' ' + o : '');
}

const shells = ['/bin/sh', '/bin/dash'].filter(s => fs.existsSync(s));

function launch(shell, options) {
  const out = path.join(dir, 'runs');
  fs.rmSync(out, { force: true });
  spawnSync(shell, ['-c', steamLine(options)], {
    env: { PATH: dir + ':/usr/bin:/bin', HOME: process.env.HOME, NP_PROBE_OUT: out },
    cwd: dir, timeout: 10000, stdio: 'ignore',
  });
  return fs.existsSync(out) ? fs.readFileSync(out, 'utf8').trim().split('\n').map(JSON.parse) : [];
}

function view(form, options) {
  const P = panel(emit, form);
  const nodes = walk(P.render({ details: details(options) }));
  const toggles = {};
  nodes.filter(n => n.type === 'Toggle' && n.props.label in TOGGLES)
       .forEach(n => { toggles[TOGGLES[n.props.label]] = n; });
  const backend = nodes.find(n => n.type === 'Dropdown' && n.props.rgOptions.some(o => o.data === 'dxvk'));
  const upscale = nodes.find(n => n.type === 'Dropdown' && n.props.rgOptions.some(o => o.data === '1.5'));
  return { toggles, backend, upscale, written: P.written, files: P.files, dialogs: P.dialogs,
           buttons: nodes.filter(n => n.type === 'Button') };
}

function dxmt(conf) {
  const out = {};
  for (const line of (conf || '').split(';')) {
    let n = 0;
    const ws = () => { while (n < line.length && ' \t\r'.includes(line[n])) n++; };
    ws();
    let key = '';
    while (n < line.length && /[0-9A-Za-z._]/.test(line[n])) key += line[n++];
    ws();
    if (line[n] !== '=') continue;
    n++; ws();
    let value = '', str = false;
    for (; n < line.length; n++) {
      if (!str && ' \t\r'.includes(line[n])) break;
      if (line[n] === '"') str = !str; else value += line[n];
    }
    out[key] = value;
  }
  return out;
}
const FACTOR = 'd3d11.metalSpatialUpscaleFactor';
const userDxmt = env => { const c = dxmt(env.DXMT_CONFIG); delete c[FACTOR]; return JSON.stringify(c); };

function agrees(t, v, env, what) {
  if (v.upscale) {
    const f = Math.max(parseFloat(dxmt(env.DXMT_CONFIG)[FACTOR] || '2'), 1);
    const want = env.DXMT_METALFX_SPATIAL_SWAPCHAIN === '1' ? f : '';
    const got = v.upscale.props.selectedOption;
    t.ok(got === '' ? want === '' : parseFloat(got) === want,
         `${what}: upscale shows "${got}", DXMT uses ${want}`);
  }
  for (const [key, node] of Object.entries(v.toggles))
    t.ok(node.props.checked === (env[key] === '1'), `${what}: ${key} shows ${node.props.checked}, game gets ${env[key]}`);
  t.ok(v.backend.props.selectedOption === (env.CX_GRAPHICS_BACKEND || ''),
       `${what}: backend shows "${v.backend.props.selectedOption}", game gets ${env.CX_GRAPHICS_BACKEND}`);
}

const ACTIONS = [
  { name: 'Metal HUD', run: v => v.toggles.MTL_HUD_ENABLED.props.onChange(!v.toggles.MTL_HUD_ENABLED.props.checked),
    want: (v0, v1) => v1.toggles.MTL_HUD_ENABLED.props.checked === !v0.toggles.MTL_HUD_ENABLED.props.checked },
  { name: 'MSync', run: v => v.toggles.WINEMSYNC.props.onChange(!v.toggles.WINEMSYNC.props.checked),
    want: (v0, v1) => v1.toggles.WINEMSYNC.props.checked === !v0.toggles.WINEMSYNC.props.checked },
  { name: 'raw controllers', run: v => v.toggles.NOTPROTON_RAW_CONTROLLERS.props.onChange(!v.toggles.NOTPROTON_RAW_CONTROLLERS.props.checked),
    want: (v0, v1) => v1.toggles.NOTPROTON_RAW_CONTROLLERS.props.checked === !v0.toggles.NOTPROTON_RAW_CONTROLLERS.props.checked },
  { name: 'backend dxvk', run: v => v.backend.props.onChange({ data: 'dxvk' }),
    want: (v0, v1) => v1.backend.props.selectedOption === 'dxvk' },
  { name: 'backend automatic', run: v => v.backend.props.onChange({ data: '' }),
    want: (v0, v1) => v1.backend.props.selectedOption === '' },
  { name: 'upscale 1.5', run: v => v.upscale && v.upscale.props.onChange({ data: '1.5' }),
    want: (v0, v1) => !v0.upscale || v1.upscale.props.selectedOption === '1.5' },
  { name: 'upscale off', run: v => v.upscale && v.upscale.props.onChange({ data: '' }),
    want: (v0, v1) => !v0.upscale || v1.upscale.props.selectedOption === '' },
];

const CASES = [
  "CX_GRAPHICS_BACKEND=dxmt DXMT_CONFIG='d3d11.preferredMaxFrameRate=60' %command%",
  'CX_GRAPHICS_BACKEND=dxmt DXMT_METALFX_SPATIAL_SWAPCHAIN=1 DXMT_CONFIG="d3d11.preferredMaxFrameRate=60;" %command%',
  'DXMT_METALFX_SPATIAL_SWAPCHAIN=1 DXMT_CONFIG="d3d11.metalSpatialUpscaleFactor = 1.5 ; d3d11.preferredMaxFrameRate=30" %command%',
  'DXMT_METALFX_SPATIAL_SWAPCHAIN=1 DXMT_CONFIG="d3d11.metalSpatialUpscaleFactor=3.0;d3d11.metalSpatialUpscaleFactor=1.5" %command%',
  'DXMT_METALFX_SPATIAL_SWAPCHAIN=1 DXMT_CONFIG=d3d11.metalSpatialUpscaleFactor=0.5 %command%',
  'DXMT_METALFX_SPATIAL_SWAPCHAIN=1 DXMT_CONFIG="d3d11.metalSpatialUpscaleFactor=2" %command% --offline',
  "DXMT_CONFIG='d3d11.preferredMaxFrameRate=60' %command% --offline",
  '',
  '--offline',
  '%command%',
  '%command% --offline',
  'MTL_HUD_ENABLED=1 %command%',
  'MTL_HUD_ENABLED="1" %command% --offline',
  "MTL_HUD_ENABLED='1' WINEMSYNC=0 %command%",
  'MTL_HUD_ENABLED=1 %COMMAND%',
  'MTL_HUD_ENABLED=1 %Command% -windowed',
  'MTL_HUD_ENABLED=1 %command%%command%',
  'DXVK_HUD=1 %command% --offline',
  'WINEDEBUG="err+all, trace+seh" MTL_HUD_ENABLED=1 %command% --name "two words"',
  "DXMT_CONFIG='d3d11.foo=1 d3d11.bar=2' %command% --name 'two words'",
  'WINEDEBUG=err+all,\\ trace+seh %command% --name two\\ words',
  '%command% --title MTL_HUD_ENABLED=1',
  'MTL_HUD_ENABLED_EXTRA=1 %command% --title "MTL_HUD_ENABLED=0 extra"',
  'MTL_HUD_ENABLED=1\tMTL_HUD_ENABLED="0" %command%',
  'MTL_HUD_ENABLED=1 MTL_HUD_ENABLED="" %command%',
  'MTL_HUD_ENABLED=1 -windowed',
  'MTL_HUD_ENABLED=1 CX_GRAPHICS_BACKEND=dxmt',
  '-windowed MTL_HUD_ENABLED=1',
  'MTL_HUD_ENABLED=1 gamemoderun %command%',
  'gamemoderun MTL_HUD_ENABLED=1 %command%',
  'gamemoderun %command% --offline',
  'MTL_HUD_ENABLED=1; %command%',
  'MTL_HUD_ENABLED=1 true && %command%',
  'true && MTL_HUD_ENABLED=1 %command% --offline',
  'true; CX_GRAPHICS_BACKEND=dxmt %command%',
  'MTL_HUD_ENABLED=1 %command% | cat',
  'MTL_HUD_ENABLED=1 %command% > /dev/null 2>&1',
  'MTL_HUD_ENABLED=1 2>/dev/null %command%',
  'MTL_HUD_ENABLED=1>/dev/null %command%',
  'MTL_HUD_ENABLED=1 %command% # MTL_HUD_ENABLED=0',
  '( MTL_HUD_ENABLED=1 %command% )',
  '{ MTL_HUD_ENABLED=1 %command%; }',
  'if true; then MTL_HUD_ENABLED=1 %command%; fi',
  'FOO=$(echo a b) MTL_HUD_ENABLED=1 %command%',
  'FOO="$(echo "a)b")" MTL_HUD_ENABLED=1 %command%',
  'FOO=`echo a b` MTL_HUD_ENABLED=1 %command%',
  'FOO=${HOME:-a b} MTL_HUD_ENABLED=1 %command%',
  'CX_GRAPHICS_BACKEND=dxmt DXMT_METALFX_SPATIAL_SWAPCHAIN=1 DXMT_CONFIG=d3d11.metalSpatialUpscaleFactor=2.0 %command%',
  'MTL_HUD_ENABLED="1 %command%',
  'MTL_HUD_ENABLED=1 "%command%"',
  'MTL_HUD_ENABLED=1 \\%command%',
  '  MTL_HUD_ENABLED=1   %command%  --offline  ',
  "NOTPROTON_EXE='/Users/test/Games/Mod Engine 2/launchmod_eldenring.bat' %command%",
  "NOTPROTON_EXE='/Users/test/Jeux/Café \"d\" l'\\''été/ゲーム.exe' MTL_HUD_ENABLED=1 %command% -t er -c 'Z:\\a b\\c.toml'",
  "CX_GRAPHICS_BACKEND=dxmt NOTPROTON_EXE=/g/AssassinsCreed_Dx10.exe NOTPROTON_START_DIR='/g/a b' %command% --offline",
];

let failed = 0;
for (const shell of shells) {
  for (const form of Object.keys(FORMS)) {
    const t = runner(`${path.basename(shell)} ${form}`);
    for (const options of CASES) {
      const before = launch(shell, options);
      const v0 = view(form, options);
      const label = JSON.stringify(options);
      if (before.length) agrees(t, v0, before[0].env, label);
      for (const a of ACTIONS) {
        const v = view(form, options);
        a.run(v);
        const next = v.written.length ? v.written[v.written.length - 1].opts : options;
        const after = launch(shell, next);
        const what = `${label} ${a.name} -> ${JSON.stringify(next)}`;
        t.ok(after.length === before.length, `${what}: game runs ${after.length}x, was ${before.length}x`);
        const v1 = view(form, next);
        t.ok(a.want(v0, v1), `${what}: panel shows the change`);
        if (!after.length || after.length !== before.length) continue;
        agrees(t, v1, after[0].env, what);
        before.forEach((run, n) => {
          t.ok(JSON.stringify(after[n].argv) === JSON.stringify(run.argv),
               `${what}: game arguments kept ${JSON.stringify(after[n].argv)}`);
          for (const k of OTHER_KEYS)
            t.ok(after[n].env[k] === run.env[k], `${what}: ${k} kept`);
          t.ok(userDxmt(after[n].env) === userDxmt(run.env),
               `${what}: DXMT_CONFIG entries kept ${userDxmt(after[n].env)}`);
        });
      }
    }
    failed += t.failed;
  }
}

// The Executable rows, driven through Steam's file dialog and read back from what the game gets.
const TARGETS = ['/Users/test/Games/Mod Engine 2/launchmod_eldenring.bat',
  "/Users/test/Jeux/Café \"d\" l'été/ゲーム.EXE", '/g/AssassinsCreed_Dx10.exe', '/g/$HOME `id` \\x.bat'];
const STARTS = ['', '-windowed', 'MTL_HUD_ENABLED=1 %command% --offline',
  'WINEDEBUG="a b" gamemoderun %command% -t er',
  '"/Users/test/Games/Mod Engine 2/launchmod_eldenring.bat"'];
for (const shell of shells) {
  for (const form of Object.keys(FORMS)) {
    const t = runner(`${path.basename(shell)} ${form} executable`);
    const click = (v, n, file) => {
      if (file !== undefined) v.files.push(file);
      v.buttons[n].props.onClick();
      return v.written.length ? v.written[v.written.length - 1].opts : null;
    };
    for (const start of STARTS) {
      const before = launch(shell, start);
      let v = view(form, start);
      t.ok(v.buttons.length === 1, `${JSON.stringify(start)}: only Browse shows without a target`);
      t.ok(click(v, 0, '') === null, `${JSON.stringify(start)}: a cancelled dialog writes nothing`);
      for (const exe of TARGETS) {
        const what = `${JSON.stringify(start)} + ${JSON.stringify(exe)}`;
        v = view(form, start);
        const picked = click(v, 0, exe);
        t.ok(JSON.stringify(v.dialogs[0].rgFilters[0].rFilePatterns) === '["*.exe","*.bat"]',
             `${what}: the dialog offers .exe and .bat`);
        const run = launch(shell, picked);
        t.ok(run.length === before.length && run.length > 0, `${what}: the game runs once -> ${JSON.stringify(picked)}`);
        if (!run.length || run.length !== before.length) continue;
        t.ok(run[0].env.NOTPROTON_EXE === exe && !('NOTPROTON_START_DIR' in run[0].env),
             `${what}: the run script gets NOTPROTON_EXE ${JSON.stringify(run[0].env.NOTPROTON_EXE)}`);
        t.ok(JSON.stringify(run[0].argv) === JSON.stringify(before[0].argv),
             `${what}: game arguments kept ${JSON.stringify(run[0].argv)}`);
        t.ok(['WINEDEBUG', 'MTL_HUD_ENABLED'].every(k => run[0].env[k] === before[0].env[k]),
             `${what}: other settings kept`);

        v = view(form, picked);
        t.ok(v.buttons.length === 3, `${what}: Reset and Start In show once a target is set`);
        const folder = exe.replace(/\/[^/]*$/, '');
        const withDir = click(v, 2, '/tmp/start in/ü');
        t.ok(v.dialogs[0].bChooseDirectory === true && v.dialogs[0].strInitialFile === folder,
             `${what}: Start In opens on the target's folder`);
        const dirRun = launch(shell, withDir);
        t.ok(dirRun.length && dirRun[0].env.NOTPROTON_START_DIR === '/tmp/start in/ü' &&
             dirRun[0].env.NOTPROTON_EXE === exe, `${what}: Start In is set and the target kept`);

        v = view(form, withDir);
        const cancelled = click(v, 0, undefined) === null;
        t.ok(cancelled && v.buttons.length === 4, `${what}: both rows offer Reset once both are set`);
        const dirReset = launch(shell, click(v, 3));
        t.ok(dirReset.length && !('NOTPROTON_START_DIR' in dirReset[0].env) && dirReset[0].env.NOTPROTON_EXE === exe,
             `${what}: resetting Start In keeps the target`);

        v = view(form, withDir);
        const again = launch(shell, click(v, 0, '/g/other.exe'));
        t.ok(again.length && again[0].env.NOTPROTON_EXE === '/g/other.exe' && !('NOTPROTON_START_DIR' in again[0].env),
             `${what}: choosing another target drops the old Start In`);

        v = view(form, withDir);
        const reset = click(v, 1);
        const resetRun = launch(shell, reset);
        t.ok(resetRun.length === before.length && resetRun.every((r, n) =>
               !('NOTPROTON_EXE' in r.env) && !('NOTPROTON_START_DIR' in r.env) &&
               JSON.stringify(r.argv) === JSON.stringify(before[n].argv)),
             `${what}: Reset launches the game as before -> ${JSON.stringify(reset)}`);
      }
    }
    failed += t.failed;
  }
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} failure(s)` : `\npanel agrees with ${shells.join(' and ')}`);
process.exit(failed ? 1 : 0);
