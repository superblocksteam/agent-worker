import { ExecutionOutput, DatasourceConfiguration, DatasourceMetadataDto, ActionConfiguration } from '@superblocksteam/shared';
import { PluginProps } from '@superblocksteam/shared-backend';

export type TLSOptions = {
  ca?: string;
  cert?: string;
  key?: string;
  insecure?: boolean;
  validateServer?: boolean;
};

export enum Event {
  METADATA = 'metadata',
  TEST = 'test',
  EXECUTE = 'execute',
  PRE_DELETE = 'pre_delete'
}

export type VersionedPluginDefinition = {
  name: string;
  version: string;
};

export type Request = {
  datasourceConfiguration?: DatasourceConfiguration;
  actionConfiguration?: ActionConfiguration;
  pluginProps?: PluginProps;
};

export type Response = {
  executionOutput?: ExecutionOutput;
  datasourceMetadataDto?: DatasourceMetadataDto;
};