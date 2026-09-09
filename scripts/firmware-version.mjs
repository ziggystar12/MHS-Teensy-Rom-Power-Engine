import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const root = path.resolve(import.meta.dirname, '..');
export const versionConfigurationPath = 'firmware-version.json';

export function validateFirmwareVersion(configuration) {
  assert.equal(configuration.schemaVersion, 2, 'Unsupported firmware version configuration');
  assert.match(configuration.version ?? '', /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Invalid firmware version');
  assert.equal(configuration.gui?.path, 'Source', 'Build from the single canonical source tree');
  return { ...configuration, filename: `MPE_Firmware-V${configuration.version}.hex` };
}

export function readFirmwareVersion() {
  return validateFirmwareVersion(JSON.parse(fs.readFileSync(path.join(root, versionConfigurationPath), 'utf8')));
}

export const firmwareVersion = readFirmwareVersion();

export function assertGuiFirmwareVersion(configuration = firmwareVersion) {
  const guiRoot = path.join(root, configuration.gui.path);
  const source = fs.readFileSync(path.join(guiRoot, 'C64/MainMenuCRT/source/GeosRich.s'), 'utf8');
  const about = source.match(/RichAboutVersion:\s*!text\s+"([^"]+)"/);
  assert.equal(about?.[1], `MPE FIRMWARE V${configuration.version}`, 'GUI About must show the packaged firmware version');
  const backend = fs.readFileSync(path.join(guiRoot, 'Teensy/DesktopFirmwareVersion.h'), 'utf8');
  const installed = backend.match(/^#define MPE_FIRMWARE_VERSION "([^"]+)"/m);
  assert.equal(installed?.[1], configuration.version, 'Startup update detection must compare against the packaged firmware version');
  return configuration;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(assertGuiFirmwareVersion(), null, 2));
}
