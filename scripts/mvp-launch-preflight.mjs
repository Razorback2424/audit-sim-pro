#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const root = process.cwd();
const frontendEnvPath = path.resolve(root, '.env.production.local');
const functionsEnvPath = path.resolve(root, 'functions/.env.production.local');

const runNodeScript = (scriptPath, argPath) => {
  const result = spawnSync(process.execPath, [scriptPath, argPath], {
    cwd: root,
    encoding: 'utf8',
  });
  return result;
};

const parseEnv = (filePath) => {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf8');
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
};

const issues = [];
const warnings = [];

const printSection = (title) => console.log(`\n== ${title} ==`);

printSection('MVP Launch Preflight');
console.log(`- repo: ${root}`);
console.log(`- frontend env: ${frontendEnvPath}`);
console.log(`- functions env: ${functionsEnvPath}`);

printSection('Validator Checks');
const frontendValidator = runNodeScript(path.resolve(root, 'scripts/validate-prod-env.mjs'), frontendEnvPath);
process.stdout.write(frontendValidator.stdout || '');
process.stderr.write(frontendValidator.stderr || '');
if (frontendValidator.status !== 0) {
  issues.push('Frontend production env validation failed');
}

const functionsValidator = runNodeScript(
  path.resolve(root, 'scripts/validate-functions-env.mjs'),
  functionsEnvPath
);
process.stdout.write(functionsValidator.stdout || '');
process.stderr.write(functionsValidator.stderr || '');
if (functionsValidator.status !== 0) {
  issues.push('Functions production env validation failed');
}

printSection('Cross-Config Consistency');
const frontendEnv = parseEnv(frontendEnvPath);
const functionsEnv = parseEnv(functionsEnvPath);

let frontendFirebaseConfig = null;
try {
  if (frontendEnv.REACT_APP_FIREBASE_CONFIG) {
    frontendFirebaseConfig = JSON.parse(frontendEnv.REACT_APP_FIREBASE_CONFIG);
  }
} catch {
  // validator already reports malformed JSON
}

if (frontendEnv.REACT_APP_APP_ID && functionsEnv.APP_ID) {
  if (frontendEnv.REACT_APP_APP_ID !== functionsEnv.APP_ID) {
    issues.push(
      `APP_ID mismatch: frontend REACT_APP_APP_ID=${frontendEnv.REACT_APP_APP_ID} vs functions APP_ID=${functionsEnv.APP_ID}`
    );
  } else {
    console.log(`- APP_ID matches (${frontendEnv.REACT_APP_APP_ID})`);
  }
}

if (functionsEnv.APP_BASE_URL) {
  try {
    const url = new URL(functionsEnv.APP_BASE_URL);
    if (url.pathname && url.pathname !== '/') {
      warnings.push(
        `APP_BASE_URL includes a path (${url.pathname}); ensure CRA build hosting path and Bluehost upload match.`
      );
    }
    console.log(`- APP_BASE_URL: ${url.origin}${url.pathname}`);
  } catch {
    issues.push('APP_BASE_URL is invalid URL');
  }
}

if (frontendFirebaseConfig?.projectId && functionsEnv.GCLOUD_PROJECT) {
  if (frontendFirebaseConfig.projectId !== functionsEnv.GCLOUD_PROJECT) {
    warnings.push(
      `Firebase project mismatch: frontend projectId=${frontendFirebaseConfig.projectId} vs functions GCLOUD_PROJECT=${functionsEnv.GCLOUD_PROJECT}`
    );
  } else {
    console.log(`- Firebase projectId matches GCLOUD_PROJECT (${frontendFirebaseConfig.projectId})`);
  }
}

if (frontendFirebaseConfig?.storageBucket && functionsEnv.FIREBASE_STORAGE_BUCKET) {
  if (frontendFirebaseConfig.storageBucket !== functionsEnv.FIREBASE_STORAGE_BUCKET) {
    warnings.push(
      `Storage bucket mismatch: frontend storageBucket=${frontendFirebaseConfig.storageBucket} vs FIREBASE_STORAGE_BUCKET=${functionsEnv.FIREBASE_STORAGE_BUCKET}`
    );
  }
}

printSection('Required Files');
[
  'docs/launch/bluehost-spa-deploy.md',
  'docs/launch/firebase-production-backend-checklist.md',
  'docs/verification/mvp-feedback-beta-launch-checklist.md',
  'deploy/bluehost/.htaccess.example',
].forEach((relPath) => {
  const absPath = path.resolve(root, relPath);
  if (!fs.existsSync(absPath)) {
    issues.push(`Missing required launch asset: ${relPath}`);
  } else {
    console.log(`- found ${relPath}`);
  }
});

printSection('Result');
if (warnings.length) {
  console.warn('[mvp-launch-preflight] WARNINGS');
  warnings.forEach((w) => console.warn(`- ${w}`));
}
if (issues.length) {
  console.error('[mvp-launch-preflight] FAILED');
  issues.forEach((i) => console.error(`- ${i}`));
  process.exit(1);
}
console.log('[mvp-launch-preflight] OK');
console.log('- Next: run docs/verification/mvp-feedback-beta-launch-checklist.md against production/staging');
