import manifest from '../../../protocol/agent-runtime.v5.manifest.json';
import {
  AGENT_RUNTIME_PROTOCOL_VERSION_V5,
  DesktopWorkerCapabilitiesV5Schema,
  type CuaDriverCatalogV5,
  type DesktopWorkerCapabilitiesV5,
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

export function hostedToolMetadata(
  toolId: RuntimeToolId,
  operation: string,
): HostedToolContract | null {
  const contract = hostedToolContractById(toolId);
  return contract?.operations.includes(operation) ? contract : null;
}

export function desktopWorkerCapabilities(
  registry: Pick<RuntimeToolRegistry, 'listRegistered'>,
  cua: CuaDriverCatalogV5 | null = null,
): DesktopWorkerCapabilitiesV5 {
  const local = new Map(
    registry.listRegistered().map((definition) => [
      definition.id,
      new Set(definition.operations),
    ]),
  );
  return DesktopWorkerCapabilitiesV5Schema.parse({
    protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION_V5,
    protocolDigest: HOSTED_AGENT_PROTOCOL_DIGEST,
    toolCatalogDigest: HOSTED_AGENT_TOOL_CATALOG_DIGEST,
    cua,
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
