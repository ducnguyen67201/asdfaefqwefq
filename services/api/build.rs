fn main() {
    println!("cargo:rerun-if-changed=migrations");
    // Watching the removed `public` directory makes every Cargo invocation dirty.
    println!("cargo:rerun-if-changed=admin-dist");
}
