# Connected applications

Tro's connector platform is a backend-owned MCP broker. The Responses API sees
small namespaced function catalogs and uses server-side `tool_search` to load
deferred functions, but Tro—not OpenAI—holds OAuth credentials and performs
remote MCP calls. Gmail is the first reviewed connector and remains a
Developer Preview canary.

## Trust boundary

- Connections belong to one authenticated `user_id`; they are never inherited
  through organizations, classrooms, or knowledge spaces.
- Activity/Attempt-bound runs receive no personal connector namespaces.
- The renderer can list safe status, start an attempt, poll it, and disconnect.
  OAuth URLs are validated and opened only by Electron main. Tokens, codes,
  client secrets, remote schemas, arguments, and results never cross renderer
  IPC.
- The Rust catalog pins the remote HTTPS endpoint, OAuth scopes, reviewed tool
  names, local input schemas, and minimum action effects. MCP annotations cannot
  lower policy.
- Private reads require exact approval before content enters the model. Draft
  and label actions use the same pure intent-authorization policy as desktop
  actions; exact approval is required when the current instruction does not
  authorize them.
- Remote content is bounded, normalized, marked as untrusted, and withheld when
  high-confidence prompt-injection patterns are present.
- A draft or label call with an ambiguous transport outcome becomes `unknown`
  and is never retried.

The Gmail pilot exposes only `get_message`, `get_thread`, `list_drafts`,
`list_labels`, `search_threads`, `create_draft`, `label_message`,
`label_thread`, `unlabel_message`, and `unlabel_thread`. It deliberately omits
sending, deletion, trash, attachments, arbitrary MCP URLs, resources, prompts,
sampling, and local stdio servers.

## Configuration and rollout

Create a separate Google OAuth web client, enable the Gmail API and Gmail MCP
API, and register the exact public HTTPS callback:

```text
https://<api-host>/v1/connectors/oauth/callback
```

Set the connector variables documented in `.env.example`. Encryption key-ring
entries use `version:base64` and must decode to 32 bytes. Do not reuse the
agent-state key ring. The service fails startup when a nonzero rollout lacks a
callback, Gmail OAuth credentials, or token keys.

Roll out in this order:

1. Deploy migration 026 and the backend with connectors disabled.
2. Configure callback, OAuth credentials, and a new token encryption key ring.
3. Enable one internal canary with `TROCODE_CONNECTOR_CANARY_USERS`.
4. Verify connect, reconnect, disconnect, schema-drift fail-closed behavior,
   private-read approval, draft approval, prompt-injection withholding, and
   unknown-outcome handling.
5. Increase deterministic rollout percentage only after Google OAuth
   verification and operational review.

To rotate encryption, add a higher-version key, retain old read keys, and move
`TROCODE_CONNECTOR_TOKEN_KEY_VERSION` to the new version. New writes and token
refreshes use the current version. Remove an old key only after all live tokens
using it have been reauthorized or refreshed.

## Adding another application

A new verified application should add a catalog definition, a dedicated OAuth
profile, reviewed schemas/effects, discovery fixtures, content-risk tests, and
presentation copy. It must reuse the existing OAuth-attempt, encrypted-token,
snapshot, route, policy, approval, execution, result, and audit lifecycle. Do
not accept a user-supplied MCP URL or infer authority from installation consent.

Operational logs may include connector key, connection/invocation identifiers,
tool name, fixed outcome code, and duration. Never log OAuth material, message
queries, recipients, bodies, remote schemas, or results.
