#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const DEFAULT_ENV_FILE = '.env.production.local';
const envFileArg = process.argv[2] || DEFAULT_ENV_FILE;
const envPath = path.resolve(process.cwd(), envFileArg);

const readEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Env file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
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

const isPlaceholder = (value = '') => /<[^>]+>/.test(String(value));

const fail = (messages) => {
  console.error('[validate-prod-env] FAILED');
  messages.forEach((msg) => console.error(`- ${msg}`));
  process.exit(1);
};

const warn = (messages) => {
  if (!messages.length) return;
  console.warn('[validate-prod-env] WARNINGS');
  messages.forEach((msg) => console.warn(`- ${msg}`));
};

let env;
try {
  env = readEnvFile(envPath);
} catch (err) {
  fail([err.message || String(err)]);
}

const requiredKeys = ['REACT_APP_FIREBASE_CONFIG', 'REACT_APP_APP_ID'];
const errors = [];
const warnings = [];

for (const key of requiredKeys) {
  const value = env[key];
  if (!value) {
    errors.push(`Missing required ${key}`);
  } else if (isPlaceholder(value)) {
    errors.push(`${key} still contains placeholder values`);
  }
}

if (env.REACT_APP_APP_ID && !/^[a-z0-9][a-z0-9-]{2,}$/i.test(env.REACT_APP_APP_ID)) {
  warnings.push('REACT_APP_APP_ID looks unusual (expected a stable namespace like auditsim-pro-prod).');
}

if (env.REACT_APP_FIREBASE_CONFIG) {
  try {
    const parsed = JSON.parse(env.REACT_APP_FIREBASE_CONFIG);
    const firebaseRequired = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'appId'];
    firebaseRequired.forEach((key) => {
      const value = parsed?.[key];
      if (!value || isPlaceholder(value)) {
        errors.push(`REACT_APP_FIREBASE_CONFIG is missing a valid ${key}`);
      }
    });
    if (parsed?.functionsRegion && env.REACT_APP_FUNCTIONS_REGION) {
      if (parsed.functionsRegion !== env.REACT_APP_FUNCTIONS_REGION) {
        warnings.push(
          `functionsRegion mismatch (firebase config: ${parsed.functionsRegion}, env: ${env.REACT_APP_FUNCTIONS_REGION})`
        );
      }
    }
  } catch (err) {
    errors.push(`REACT_APP_FIREBASE_CONFIG is not valid JSON (${err.message || err})`);
  }
}

if (env.REACT_APP_APPCHECK_SITE_KEY && isPlaceholder(env.REACT_APP_APPCHECK_SITE_KEY)) {
  errors.push('REACT_APP_APPCHECK_SITE_KEY still contains a placeholder value');
}
if (!env.REACT_APP_APPCHECK_SITE_KEY) {
  warnings.push(
    'REACT_APP_APPCHECK_SITE_KEY is missing (recommended before public self-signup launch).'
  );
}

if (env.REACT_APP_DEMO_SURL_CASE_ID && /\s/.test(env.REACT_APP_DEMO_SURL_CASE_ID)) {
  warnings.push('REACT_APP_DEMO_SURL_CASE_ID contains whitespace; confirm this is intentional.');
}

if (env.REACT_APP_FUNCTIONS_REGION && !/^[a-z]+-[a-z0-9]+[0-9]+$/i.test(env.REACT_APP_FUNCTIONS_REGION)) {
  warnings.push(
    'REACT_APP_FUNCTIONS_REGION format looks unusual (expected e.g. us-central1).'
  );
}

if (errors.length) {
  fail(errors);
}

warn(warnings);
console.log('[validate-prod-env] OK');
console.log(`- file: ${envPath}`);
console.log(`- appId: ${env.REACT_APP_APP_ID}`);
if (env.REACT_APP_FUNCTIONS_REGION) {
  console.log(`- functionsRegion: ${env.REACT_APP_FUNCTIONS_REGION}`);
}
