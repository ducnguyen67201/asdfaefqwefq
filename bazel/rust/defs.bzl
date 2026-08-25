"""Shared conventions for first-party TroCode Rust targets."""

load(
    "@crates//:defs.bzl",
    _aliases = "aliases",
    _all_crate_deps = "all_crate_deps",
    _crate_edition = "crate_edition",
)
load(
    "@rules_rust//rust:defs.bzl",
    "rust_clippy",
    "rust_lint_config",
    "rust_test",
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
        targets = source_targets + test_targets,
    )

    rust_clippy(
        name = clippy_name,
        testonly = True,
        deps = source_targets + test_targets,
    )

def trocode_rust_integration_test(
        name,
        src,
        compile_data = None,
        size = "medium",
        tags = None):
    """Declares a separately compiled Cargo-style Rust integration test."""
    rust_test(
        name = name,
        srcs = [src],
        aliases = _aliases(
            normal = True,
            normal_dev = True,
            proc_macro = True,
            proc_macro_dev = True,
        ),
        compile_data = compile_data or [],
        crate_name = name,
        edition = _crate_edition(),
        lint_config = ":rust_lints",
        size = size,
        tags = ["integration"] + (tags or []),
        deps = [":api_lib"] + _all_crate_deps(
            normal = True,
            normal_dev = True,
        ),
        proc_macro_deps = _all_crate_deps(
            proc_macro = True,
            proc_macro_dev = True,
        ),
    )
