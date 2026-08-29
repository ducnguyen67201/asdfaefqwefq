# Reviewed connectors

Connectors are server-side registered tools backed by a reviewed catalog,
strict input schemas, a pinned MCP endpoint, immutable schema snapshots, OAuth
scope checks, bounded results, and content treated as untrusted data.

The current Gmail pilot exposes private read, draft creation, and label
operations. It does not expose send or delete. Connector availability comes
from the catalog and the user's active OAuth connection; there is no per-call
Tro policy or approval decision.

For each call Rust:

1. resolves an active connection and immutable snapshot;
2. checks the catalog-contract digest and exact registered schema;
3. validates arguments and derives catalog-owned effect metadata;
4. persists a requested invocation and checkpoint;
5. acquires the one-time executing lease;
6. calls the connector once and bounds/guards the returned content;
7. records the result and evidence for verification.

If connection state, OAuth scopes, endpoint, schema, or catalog digest changes,
the tool becomes unavailable or requires reconnection. If the provider may
have completed a consequential call but the result is unknown, the run blocks
and Tro does not replay it.

OAuth tokens remain encrypted in the Rust service and never enter Electron or
the renderer. Analytics includes only fixed catalog/tool IDs and result status,
never arguments, recipients, messages, labels, or returned content.
