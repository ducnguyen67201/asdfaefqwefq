"""Shared conventions for first-party TroCode Rust targets."""

load(
    "@rules_rust//rust:defs.bzl",
    "rust_clippy",
    "rust_lint_config",
    "rustfmt_test",
)

def trocode_rust_lint_config(name):
    """Declares the standard lint policy for first-party Rust code."""
    rust_lint_config(
        name = name,
        clippy = {
            "all": "deny",
        },
        rustc = {
            "unsafe_code": "forbid",
        },
    )

def trocode_rust_checks(rustfmt_name, clippy_name, source_targets, test_targets = None):
    """Declares standard formatting and Clippy checks for a Rust package."""
    test_targets = test_targets or []

    rustfmt_test(
        name = rustfmt_name,
        targets = source_targets,
    )

    rust_clippy(
        name = clippy_name,
        testonly = True,
        deps = source_targets + test_targets,
    )
