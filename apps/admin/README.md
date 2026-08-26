# Tro Admin

This directory contains the authored React and TypeScript source for the web
admin dashboard. The production build is emitted to `services/api/admin-dist`
and embedded in the Rust API binary.

Run `npm run admin:dev` while the Rust API is available locally, or run
`npm run admin:build` to refresh the checked-in production assets. Files under
`services/api/admin-dist` are generated and must not be edited by hand.
