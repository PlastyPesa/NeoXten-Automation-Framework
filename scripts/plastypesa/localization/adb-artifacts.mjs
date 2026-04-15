#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getLocalizationOutDir } from './config.mjs';

export function getAdbDevice() {
  const explicit = (process.env.PLASTYPESA_ANDROID_DEVICE || '').trim();
  if (explicit) return explicit;
  const result = spawnSync('adb', ['devices'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const lines = (result.stdout || '').split('\n').slice(1);
  for (const line of lines) {
    const match = line.trim().match(/^(\S+)\s+device\s*$/);
    if (match) return match[1];
  }
  return null;
}

export function captureAdbArtifacts(label, outDir = getLocalizationOutDir()) {
  const deviceId = getAdbDevice();
  if (!deviceId) {
    return { captured: false, reason: 'no adb device in "device" state' };
  }

  const screenshotPath = resolve(outDir, `${label}.png`);
  const xmlPath = resolve(outDir, `${label}.xml`);
  const remotePngPath = `/sdcard/${label}.png`;
  const remoteXmlPath = `/sdcard/${label}.xml`;

  spawnSync('adb', ['-s', deviceId, 'shell', 'screencap', '-p', remotePngPath], {
    encoding: 'utf8',
  });
  const screenshot = spawnSync('adb', ['-s', deviceId, 'exec-out', 'cat', remotePngPath], {
    encoding: null,
  });
  if (screenshot.status === 0 && screenshot.stdout && screenshot.stdout.length > 0) {
    writeFileSync(screenshotPath, screenshot.stdout);
  }

  spawnSync('adb', ['-s', deviceId, 'shell', 'uiautomator', 'dump', remoteXmlPath], {
    encoding: 'utf8',
  });
  const pulled = spawnSync('adb', ['-s', deviceId, 'exec-out', 'cat', remoteXmlPath], {
    encoding: 'utf8',
  });
  if (pulled.status === 0 && pulled.stdout) {
    writeFileSync(xmlPath, pulled.stdout, 'utf8');
  }

  return {
    captured: existsSync(screenshotPath) || existsSync(xmlPath),
    deviceId,
    screenshotPath: existsSync(screenshotPath) ? screenshotPath : null,
    xmlPath: existsSync(xmlPath) ? xmlPath : null,
  };
}

if (process.argv[1] && process.argv[1].endsWith('adb-artifacts.mjs')) {
  const label = process.argv[2] || 'device-capture';
  const result = captureAdbArtifacts(label);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
