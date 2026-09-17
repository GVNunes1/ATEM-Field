# Modal regression checks

Run `npm install` and `npx playwright install chromium`, then start `npm run dev` in a separate terminal. Run `npm run test:modals` against the local server.

Optional environment variables: `TEST_BASE_URL` (default `http://127.0.0.1:5173`) and `CHROMIUM_PATH` (custom browser executable). The suite rejects non-local servers, intercepts API requests with synthetic fixtures and fails on any API write attempt.

Coverage: create/edit/merge/delete technician dialogs, credential manager and nested PIN dialog, portal link, checklist template, create/edit asset, reservation editor, kiosk PIN/reservation/call/calibration/loan dialogs, Excel overlay, scrolling on long pages, keyboard focus/return, Escape, nested inert state and reduced motion. Viewports: 1440×900, 375×812, 768×1024, 1024×768 and 812×375. Screenshots are written to ignored `test-results/modal-overlays/`.

No field-report/PDF routes are invoked or changed.
