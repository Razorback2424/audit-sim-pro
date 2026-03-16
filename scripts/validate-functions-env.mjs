#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const DEFAULT_ENV_FILE = 'functions/.env.production.local';
const envFileArg = process.argv[2] || DEFAULT_ENV_FILE;
const envPath = path.resolve(process.cwd(), envFileArg);

const REQUIRED = [
  'APP_ID',
  'APP_BASE_URL',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_INDIVIDUAL',
  'STRIPE_PRICE_INDIVIDUAL_ANNUAL',
];

const OPTIONAL = ['FIREBASE_STORAGE_BUCKET', 'STORAGE_BUCKET', 'GCLOUD_PROJECT'];

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
const isUnsafeLaunchHost = (host = '') => {
  const normalized = String(host || '').trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized === 'example.com' ||
    normalized === 'www.example.com' ||
    normalized === 'example.org' ||
    normalized === 'www.example.org' ||
    normalized === 'example.net' ||
    normalized === 'www.example.net' ||
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '0.0.0.0' ||
    normalized.endsWith('.local')
  );
};

const errors = [];
const warnings = [];

let env = {};
try {
  env = readEnvFile(envPath);
} catch (err) {
  console.error('[validate-functions-env] FAILED');
  console.error(`- ${err.message || String(err)}`);
  process.exit(1);
}

for (const key of REQUIRED) {
  const value = env[key];
  if (!value) {
    errors.push(`Missing required ${key}`);
    continue;
  }
  if (isPlaceholder(value)) {
    errors.push(`${key} still contains placeholder value`);
  }
}

for (const key of OPTIONAL) {
  const value = env[key];
  if (value && isPlaceholder(value)) {
    errors.push(`${key} still contains placeholder value`);
  }
}

if (env.APP_BASE_URL) {
  try {
    const url = new URL(env.APP_BASE_URL);
    if (isUnsafeLaunchHost(url.hostname)) {
      errors.push(`APP_BASE_URL uses a non-launch-safe host (${url.hostname})`);
    }
    if (url.protocol !== 'https:') {
      warnings.push('APP_BASE_URL is not https (strongly recommended for production).');
    }
    if (url.pathname !== '/' && url.pathname !== '') {
      warnings.push(
        `APP_BASE_URL includes a path (${url.pathname}); confirm checkout redirect URLs are intended.`
      );
    }
  } catch {
    errors.push('APP_BASE_URL is not a valid URL');
  }
}

if (env.APP_ID && !/^[a-z0-9][a-z0-9-]{2,}$/i.test(env.APP_ID)) {
  warnings.push('APP_ID looks unusual; confirm it matches frontend REACT_APP_APP_ID namespace.');
}

if (env.STRIPE_SECRET_KEY && !/^sk_(live|test)_/i.test(env.STRIPE_SECRET_KEY)) {
  warnings.push('STRIPE_SECRET_KEY format is unusual (expected sk_live_... in production).');
}

if (env.STRIPE_WEBHOOK_SECRET && !/^whsec_/i.test(env.STRIPE_WEBHOOK_SECRET)) {
  warnings.push('STRIPE_WEBHOOK_SECRET format is unusual (expected whsec_...).');
}

['STRIPE_PRICE_INDIVIDUAL', 'STRIPE_PRICE_INDIVIDUAL_ANNUAL'].forEach((key) => {
  if (env[key] && !/^price_/i.test(env[key])) {
    warnings.push(`${key} format is unusual (expected price_...).`);
  }
});

if (errors.length) {
  console.error('[validate-functions-env] FAILED');
  errors.forEach((msg) => console.error(`- ${msg}`));
  process.exit(1);
}

if (warnings.length) {
  console.warn('[validate-functions-env] WARNINGS');
  warnings.forEach((msg) => console.warn(`- ${msg}`));
}

console.log('[validate-functions-env] OK');
console.log(`- file: ${envPath}`);
console.log(`- appId: ${env.APP_ID}`);
console.log(`- baseUrl: ${env.APP_BASE_URL}`);
