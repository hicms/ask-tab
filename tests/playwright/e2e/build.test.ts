import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, '../../../dist');

test.describe('@phase-0 Build verification', () => {
  test('MVP-1: build output exists with manifest.json', () => {
    expect(fs.existsSync(distPath)).toBe(true);
    expect(fs.existsSync(path.join(distPath, 'manifest.json'))).toBe(true);
  });

  test('MVP-2: manifest has required keys', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(distPath, 'manifest.json'), 'utf-8'));

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toBeDefined();
    expect(Array.isArray(manifest.permissions)).toBe(true);
    expect(manifest.permissions).toContain('storage');
    expect(manifest.background).toBeDefined();
    expect(manifest.background.service_worker).toBeDefined();
    expect(manifest.side_panel).toBeDefined();
  });
});
