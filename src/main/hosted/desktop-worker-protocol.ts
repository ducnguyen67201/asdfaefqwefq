import manifest from '../../../protocol/agent-runtime.v3.manifest.json';
import {
  AGENT_RUNTIME_PROTOCOL_VERSION,
  DesktopWorkerCapabilitiesV3Schema,
  type DesktopWorkerCapabilitiesV3,
} from '../../shared/agent-runtime-protocol';
import {
  HOSTED_TOOL_CONTRACTS,
  hostedToolContractById,
  type HostedToolContract,
} from '../../shared/agent-tool-contracts';
import type { RuntimeToolId } from '../../shared/contracts';
import type { RuntimeToolRegistry } from '../agent/runtime-tool-registry';

export const HOSTED_AGENT_PROTOCOL_DIGEST = manifest.protocolDigest;
export const HOSTED_AGENT_TOOL_CATALOG_DIGEST = manifest.toolCatalogDigest;

/** @deprecated Use HOSTED_AGENT_TOOL_CATALOG_DIGEST. */
export const HOSTED_AGENT_TOOL_SCHEMA_DIGEST =
  HOSTED_AGENT_TOOL_CATALOG_DIGEST;

export function hostedToolMetadata(
  toolId: RuntimeToolId,
  operation: string,
): HostedToolContract | null {
  const contract = hostedToolContractById(toolId);
  return contract?.operations.includes(operation) ? contract : null;
}

export function desktopWorkerCapabilities(
  registry: Pick<RuntimeToolRegistry, 'list'>,
): DesktopWorkerCapabilitiesV3 {
  const local = new Map(
    registry.list().map((definition) => [
      definition.id,
      new Set(definition.operations),
    ]),
  );
  return DesktopWorkerCapabilitiesV3Schema.parse({
    protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION,
    protocolDigest: HOSTED_AGENT_PROTOCOL_DIGEST,
    toolCatalogDigest: HOSTED_AGENT_TOOL_CATALOG_DIGEST,
    tools: HOSTED_TOOL_CONTRACTS.flatMap((contract) => {
      const supported = local.get(contract.toolId);
      const operations = contract.operations.filter((operation) =>
        supported?.has(operation),
      );
      return operations.length > 0
        ? [{ toolId: contract.toolId, operations: [...operations] }]
        : [];
    }),
  });
}
