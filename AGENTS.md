## Testing

For workbench and animation-lab design changes, run the isolated workbench specs, the live unified-studio specs, and the production build:

```bash
npx playwright test tests/workbench-library.spec.js tests/workbench-motion-tuning.spec.js && STUDIO_BASE_URL=http://127.0.0.1:5173 ADMIN_BASE_URL=http://127.0.0.1:8787 npx playwright test tests/unified-studio.spec.js && npm run build
```

The live unified-studio pass expects Vite on port 5173 and the CMS admin server on port 8787. See the Playwright specs in `tests/` for test conventions. New behavior needs a focused test, bug fixes need a regression test, and existing tests must stay green.
