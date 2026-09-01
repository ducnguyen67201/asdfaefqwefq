# CUA model-tool inventory contract

CUA inventory schema 2 separates the driver's complete tool surface from the
surface that an agent may see. Each tool declares:

- `audience`: `model` or `host`. Tro never publishes host tools to a model.
  `set_config` is reserved to the host even if a malformed inventory labels it
  otherwise.
- `schemaDialect` and `schemaVersion`: the exact model-schema contract. Tro
  admits a model tool only when a registered validator supports that pair.
- `modelInputSchema`: the already provider-compatible model schema. Validators
  are check-only; mutating a schema during validation quarantines the tool.
- `inputSchema`: the driver's native call schema. It is kept separate so host
  bindings and driver-native optionality never force Tro to rewrite the model
  schema.
- `injectSession`: whether Tro adds the task-owned CUA session after model input
  validation. A schema-2 producer should omit the host-owned session field from
  the model schema when this is true.

The inventory also declares `requiredTools`. These are model-tool names needed
for the driver surface to be usable. An absent, incompatible, or colliding
required tool makes CUA unavailable during startup. Other incompatible tools
are quarantined independently and compatible tools remain available.

```json
{
  "schema_version": "2",
  "capability_version": "3",
  "requiredTools": ["verify_state"],
  "tools": [
    {
      "name": "verify_state",
      "description": "Verify observed state.",
      "capabilities": ["state.verify"],
      "audience": "model",
      "schemaDialect": "openai.function.strict",
      "schemaVersion": "1",
      "injectSession": true,
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "session": { "type": "string" },
          "expect": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["session", "expect"]
      },
      "modelInputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "expect": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["expect"]
      }
    },
    {
      "name": "set_config",
      "description": "Change driver configuration.",
      "capabilities": ["system.config.write"],
      "audience": "host",
      "schemaDialect": "driver.internal",
      "schemaVersion": "1",
      "inputSchema": {}
    }
  ]
}
```

## Producer conformance

CUA Core owns the strongest compatibility gate. Its release CI should enumerate
every schema-2 `audience: model` tool and construct it with each supported
Agents SDK/provider schema validator. The release must fail for an unsupported
dialect, invalid strict schema, missing required tool, duplicate tool name, or
schema mutation. Tro repeats these checks at startup because installed driver
artifacts and application releases can drift independently.

Schema 1 remains a transitional compatibility path. Tro identifies host tools
using the schema-1 capability prefixes and applies a named `legacy-v1` adapter
to optional JSON Schema fields. That transformation is included in the catalog
digest and reported as degraded compatibility; it is not used for schema 2.
