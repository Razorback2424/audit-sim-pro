# Testing Commands Found

## Frontend (repo root)
Commands confirmed in `package.json` and `README.md`.

- Install: `npm install`.
  Source: `README.md:23-26`
- Dev: `npm start`.
  Source: `README.md:32`
- Tests: `npm test`.
  Source: `README.md:33`, `package.json:21-25`
- Build: `npm run build`.
  Source: `README.md:34`, `package.json:21-25`
- Coverage: `npm test -- --coverage`.
  Source: `README.md:36-40`

## Functions
- No scripts are defined in `functions/package.json`.
  Source: `functions/package.json:1-16`

## Emulators
- Firebase emulators: `firebase emulators:start --only firestore,storage,auth`.
  Source: `README.md:21-26`

## Placeholders Remaining in TESTING.md
Items that should be replaced once real commands are defined.

- Lint: no `lint` script in `package.json`. `TESTING.md:2`, `package.json:21-25`
- Functions lint/typecheck/tests: no scripts in `functions/package.json`. `TESTING.md:2`, `functions/package.json:1-16`
- Rules compile/validate: no command documented. `TESTING.md:4`, `firebase.json:1-12`, `README.md:21-26`
- Emulator seed script: not documented. `TESTING.md:2`, `README.md:21-26`

