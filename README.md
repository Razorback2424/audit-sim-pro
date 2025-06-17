# AuditSim Pro

AuditSim Pro is a React and Firebase based training app for simulating audit procedures. It uses Firestore, Storage and Authentication via the Firebase client SDK. The project is bootstrapped with Create React App and styled with Tailwind and MUI.

## Environment Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in your Firebase project settings:
   ```bash
   cp .env.example .env
   # then edit .env with your values
   ```
   `REACT_APP_FIREBASE_CONFIG` contains your Firebase configuration JSON and `REACT_APP_APP_ID` identifies the dataset in Firestore. Keep `.env` out of version control.

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

## Admin Workflow

1. From the Admin Dashboard you can create or edit a case using the Case Form.
   Disbursements may be uploaded via CSV or entered manually. Invoice PDFs can be
   attached to each payment.
2. When the form is saved, each PDF is uploaded under
   `artifacts/&lt;appId&gt;/case_documents/&lt;caseId&gt;/` and the Firestore document
   records its `downloadURL` for trainees to access.
3. Use the new **Case Overview** page from the dashboard to view a read-only
   summary of a case. Links from this page allow quick access to editing and to
   trainee submissions.
4. From the submissions list you can drill down into a **Submission Detail** page
   to review each trainee's selections and classifications. If a trainee has
   attempted the same case multiple times the detail page shows each attempt
   chronologically along with any recorded grade.

## Trainee Workflow

1. From the Trainee Dashboard select a case to work on.
2. On the case view page choose which disbursements to test and classify each
   selected item using the provided options.
3. Submit your selections to store them with your user record. A confirmation
   screen summarizes the payment IDs chosen and any retrieved invoice PDFs with
   links to open them.

## Firebase Service Modules

Firestore queries and mutations are centralized under `src/services/`. Pages import these modules instead of calling Firestore directly. This keeps page components slimmer and allows tests to easily mock Firebase interactions.

