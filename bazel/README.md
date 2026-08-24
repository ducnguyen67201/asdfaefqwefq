# Repository-owned Bazel support

This directory contains reusable build logic owned by TroCode. It is not a
generated Bazel output directory; generated `bazel-*` paths remain ignored at
the repository root.

Keep application targets in the nearest `BUILD.bazel` file so their sources and
dependencies remain visible. Put a helper here only when it establishes a
repository-wide convention or is reusable by multiple targets.

Current support packages:

- `rust/` — shared first-party Rust lint and verification macros.
