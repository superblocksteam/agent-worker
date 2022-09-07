import { SupportedPluginVersions } from '@superblocksteam/shared';
import { VersionedPluginDefinition, ErrorEncoding, Event, Request, Response, Timings, Metadata } from '@superblocksteam/worker';

export type PluginRequest = {
  exclude?: boolean;
  plugins?: string[];
};

export function unmarshalPluginRequest(request: string): PluginRequest {
  if (request.length < 1) {
    return {};
  }

  const pr: PluginRequest = {
    exclude: request.startsWith('!'),
    plugins: []
  };

  if (pr.exclude && request.length < 2) {
    return {};
  }

  if (pr.exclude) {
    pr.plugins = request.split('!')[1].split(',');
  } else {
    pr.plugins = request.split(',');
  }

  return pr;
}

export function sort(i: VersionedPluginDefinition, j: VersionedPluginDefinition): number {
  if (i.name < j.name) {
    return -1;
  }
  return 1;
}

export function marshalVPDs(vpds: VersionedPluginDefinition[]): SupportedPluginVersions {
  const marshaled = {};

  vpds.forEach((vpd) => {
    if (!(vpd.name in marshaled)) {
      marshaled[vpd.name] = [];
    }
    marshaled[vpd.name].push(vpd.version);
  });

  return marshaled;
}

export type RunFunc = (
  _event: Event,
  _metadata: Metadata,
  _request: Request,
  _timings: Timings,
  callback: (_response: Response, _timings: Timings, _err: ErrorEncoding) => void
) => void;

export interface Plugin {
  run: (_event: Event, _request: Request) => Promise<{ resp?: Response; err?: Error }>;
  name(): string;
  version(): string;
}

export function load(desired: PluginRequest, deps: object): VersionedPluginDefinition[] {
  // 1. Filter out all deps that aren't plugins or aren't formatted correctly.
  // 2. Create VersionedPluginDefinition array from plugins.
  // 3. Filter out based on SUPERBLOCK_SUPPORTED_PLUGINS.
  return (
    Object.keys(deps)
      .filter((dep: string): boolean => {
        const parts = dep.split('-');
        return dep.startsWith('sb-') && parts.length >= 3;
      })
      .map((dep: string): VersionedPluginDefinition => {
        const parts = dep.split('-');
        return {
          name: parts.slice(1, parts.length - 1).join('-'),
          version: parts[parts.length - 1]
        };
      })
      // This is only pseudo-performant because we never expect `desired.plugins` to be large.
      .filter((vpd: VersionedPluginDefinition): boolean => {
        // If no plugins were loaded, it means none were specified.
        // In this case, the default behavior is to load them all.
        if (!desired?.plugins?.length) {
          return true;
        }

        const includes = desired.plugins.includes(vpd.name);
        return desired.exclude ? !includes : includes;
      })
  );
}
