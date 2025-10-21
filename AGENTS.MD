Absolutely! Here is a single, coherent AGENTS.MD file tailored specifically for your actual audit-sim-pro codebase. This version directly reflects your code’s tech stack (React + Firebase), directory structure, testing conventions, and real-world usage. It is ready to drop in at your repo root.

⸻

AGENTS.MD

AuditSim Pro — Agent and Contributor Guide

Project Purpose

AuditSim Pro is a React and Firebase-based platform that simulates the audit search for unrecorded liabilities. It is designed for audit trainee and instructor roles, delivering realistic, interactive, and automated training via a secure, web-based experience.

⸻

1. Environment & Toolchain
	•	Frontend: React (Create React App), MUI, Tailwind CSS.
	•	Backend/Infra: Firebase (Firestore, Storage, Authentication).
No server-side code exists in this repo; all business logic is in the frontend and Firebase cloud services.
	•	Testing: Jest (via react-scripts test), React Testing Library.
	•	Styling: Tailwind utility classes and MUI components.
	•	Linting: No explicit linter script. Follow Prettier/CRA code formatting if present.

Setup:

npm install
# Environment variables for Firebase config are set in .env (never commit secrets)


⸻

2. Project Structure
	•	/src/pages/ — Main UI screens for admin and trainees.
	•	/src/services/ — Firebase logic (e.g., roleService.js).
	•	/src/routes/ — Custom route components (e.g., RoleRoute.jsx).
	•	/public/ — Static files and main HTML entry.
	•	firestore.rules / storage.rules — Firebase backend security rules.
	•	tailwind.config.js, postcss.config.js — Tailwind/PostCSS configuration.

⸻

3. Coding Standards
	•	Components: Use React functional components and hooks. Prefer composition and small, reusable units.
	•	Naming: Use descriptive, unambiguous names for files, variables, and functions. No abbreviations unless standard.
	•	Services: All Firestore/Firebase calls should go through /src/services/. Never manipulate Firestore directly in components.
	•	Styling: Use Tailwind utility classes and MUI for new UI work; avoid inline styles.
	•	Security: Never hard-code credentials or secrets—always use environment variables. Apply RBAC and permission checks on sensitive UI and Firestore calls.

⸻

4. Testing & Verification
	•	All code changes must pass:

npm test


	•	Use @testing-library/react for UI/component tests.
	•	Place all test files alongside the code as *.test.js[x].
	•	Do not commit code with failing or skipped tests.
	•	Ensure all lint checks pass before PR.

⸻

5. Git & PR Workflow
	•	Branch names:
Use feature/<desc>, bugfix/<desc>, or similar for clarity.
	•	Pull request titles:
Use action-based, concise titles (e.g., feat: add trainee dashboard page).
	•	PR descriptions:
	•	Explain what and why
	•	Reference related issues or tasks
	•	Note any manual steps or migration needed
	•	Reviews:
All PRs must be reviewed and all tests must pass before merging to main.

⸻

6. Security, Compliance, and Privacy
	•	RBAC: Enforced via app logic and Firestore security rules.
	•	Document/PII access:
	•	Secure all invoice/document downloads via Firebase rules.
	•	Do not expose user IDs, emails, or other PII in logs, errors, or UI.
	•	Firestore/Storage:
	•	Update security rules with every feature affecting permissions.
	•	Test security rules before deploying changes.

⸻

7. Agent-Specific Instructions
	•	Respect file structure and existing patterns in /src/pages, /src/services, and /src/routes.
	•	Use and extend service files (e.g., roleService.js) for Firebase or role logic; do not bypass with inline logic.
	•	UI: Always use MUI and Tailwind for components; do not use inline styles.
	•	Environment: Never hard-code sensitive keys; always use .env for config.
	•	For ambiguity: Leave a // TODO: comment with rationale for human follow-up.
	•	Documentation: Update the README.md (and /docs if present) when adding or changing features or workflows.

⸻

8. Documentation
	•	README.md must stay up to date with setup, deployment, and usage instructions.
	•	Add/update /docs/ for new workflows, edge cases, or architectural decisions.

⸻

9. Living Document Principle
	•	This file is the canonical agent and contributor guide for audit-sim-pro.
	•	Update it via pull request with clear rationale for any major change in workflow, conventions, or stack.

⸻

10. Prohibited Practices
	•	No direct Firestore/Storage manipulation in components; use the service layer.
	•	No hardcoded secrets or credentials in the codebase.
	•	No logging or exposing of sensitive data in errors, logs, or the UI.

⸻

End of AGENTS.MD
Last updated: June 2025. Review and update regularly as the project evolves.

⸻

Let me know if you need anything added for future backend expansion, stricter lint/test automation, or more deployment detail!