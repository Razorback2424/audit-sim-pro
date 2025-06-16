# AuditSim Pro

AuditSim Pro is a React and Firebase based training app for simulating audit procedures. It uses Firestore, Storage and Authentication via the Firebase client SDK. The project is bootstrapped with Create React App and styled with Tailwind and MUI.

## Environment Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file in the project root with at least the following keys:
   ```bash
   REACT_APP_FIREBASE_CONFIG="{...firebaseConfigJson}"
   REACT_APP_APP_ID=auditsim-pro-default-dev
   ```
   `REACT_APP_FIREBASE_CONFIG` should contain your Firebase configuration JSON and `REACT_APP_APP_ID` identifies the dataset in Firestore.

### Firebase Emulators

To work locally without touching production data you can run the Firebase emulators. Install the Firebase CLI and start the emulators:

```bash
npm install -g firebase-tools
firebase emulators:start --only firestore,storage,auth
```

The app will automatically connect to the emulators if the config in `.env` points to them.

## Available Scripts

- `npm start` – run the app in development mode
- `npm test` – execute Jest and React Testing Library tests
- `npm run build` – build the production bundle

To generate a coverage report run:

```bash
npm test -- --coverage
```

## Login Behavior

On first load the app shows a role selection screen. No user ID is created until you choose a role at which point the app signs in anonymously and stores the selection.

## Security Rules Overview

The application relies on Firebase security rules for both Firestore and Storage. Administrators can read and write all case and user data. Trainees may only read the cases they are authorized for and submit their own selections. See `firestore.rules` and `storage.rules` for the exact RBAC logic.

## Firebase Service Modules

Firestore queries and mutations are centralized under `src/services/`. Pages import these modules instead of calling Firestore directly. This keeps page components slimmer and allows tests to easily mock Firebase interactions.

