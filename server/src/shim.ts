import { ExecutionContext } from '@superblocksteam/shared';
import { BasePlugin, sanitizeAgentKey } from '@superblocksteam/shared-backend';
import { VersionedPluginDefinition, Event, Request, Response } from '@superblocksteam/worker';
import P from 'pino';
import dependencies from './dependencies';
import {
  SUPERBLOCKS_CONTROLLER_KEY,
  SUPERBLOCKS_WORKER_EXECUTION_PYTHON_TIMEOUT_MS,
  SUPERBLOCKS_WORKER_EXECUTION_JS_TIMEOUT_MS,
  SUPERBLOCKS_WORKER_EXECUTION_REST_API_TIMEOUT_MS
} from './env';
import logger from './logger';
import { Plugin } from './plugin';

// Shim connects a BasePlugin to a Transport. Once we've deprecated
// the old architecture, there's no reason why BasePlugin can't implement
// `Plugin`; but until then, it seemed cleaner to keep them separate.
export class Shim<T extends BasePlugin> implements Plugin {
  private _plugin: T;
  private _logger: P.Logger;
  private _pluginDef: VersionedPluginDefinition;

  private constructor(pluginDef: VersionedPluginDefinition, plugin: T, _logger?: P.Logger) {
    this._plugin = plugin;
    this._pluginDef = pluginDef;

    const { name, version } = this._pluginDef;
    this._logger = _logger || logger.child({ name, version });

    this._plugin.attachLogger(this._logger);
    this.run = this.run.bind(this);
  }

  // Using the static factory function pattern.
  static async init(pluginDef: VersionedPluginDefinition): Promise<Plugin> {
    const key = `sb-${pluginDef.name}-${pluginDef.version}`;

    if (!(key in dependencies)) {
      throw new Error(`The plugin ${pluginDef.name} at version ${pluginDef.version} does not exist.`);
    }

    const plugin: BasePlugin = dependencies[key] as BasePlugin;

    plugin.configure({
      pythonExecutionTimeoutMs: SUPERBLOCKS_WORKER_EXECUTION_PYTHON_TIMEOUT_MS,
      javascriptExecutionTimeoutMs: SUPERBLOCKS_WORKER_EXECUTION_JS_TIMEOUT_MS,
      restApiExecutionTimeoutMs: SUPERBLOCKS_WORKER_EXECUTION_REST_API_TIMEOUT_MS,
      workflowFetchAndExecuteFunc: null // Workflows are flattened by the controller.
    });

    try {
      await plugin.init();
    } catch (_) {
      // BasePlugin.(init|shutdown) are not abstract. Rather, they have no-op implementations.
      // However, i'm getting property doesn't exist exception if the subclass doesn't overwrite it. I'm probably
      // not understanding something so i'm wrapping it.
    }

    return new Shim(pluginDef, plugin);
  }

  public async run(_event: Event, _request: Request): Promise<{ resp?: Response; err?: Error }> {
    const _logger = this._logger.child({ event: _event });

    try {
      _logger.info({ event: _event }, 'executing');

      switch (_event) {
        case Event.EXECUTE: {
          // This code sits on the other side of a transport. Hence, we need
          // to re-construct it so that we get access to the class methods.
          _request.pluginProps.context = new ExecutionContext(_request.pluginProps.context);
          _request.pluginProps.redactedContext = new ExecutionContext(_request.pluginProps.redactedContext);

          // This is used by the fileServer in readContents() for authentication.
          _request.pluginProps.context.addGlobalVariable('$agentKey', sanitizeAgentKey(SUPERBLOCKS_CONTROLLER_KEY));
          _request.pluginProps.redactedContext.addGlobalVariable('$agentKey', sanitizeAgentKey(SUPERBLOCKS_CONTROLLER_KEY));

          return { resp: { executionOutput: await this._plugin.setupAndExecute(_request.pluginProps) } };
        }
        case Event.TEST: {
          await this._plugin.test(_request.datasourceConfiguration);
          return { resp: {} };
        }
        case Event.PRE_DELETE: {
          await this._plugin.preDelete(_request.datasourceConfiguration);
          return { resp: {} };
        }
        case Event.METADATA: {
          return {
            resp: { datasourceMetadataDto: await this._plugin.metadata(_request.datasourceConfiguration, _request.actionConfiguration) }
          };
        }
        default: {
          throw new Error(`unrecognized event ${_event}`);
        }
      }
    } catch (err) {
      _logger.error(
        {
          err: err.message,
          type: err.name
        },
        'could not execute plugin'
      );
      // We need to wrap the error and throw it in the controller.
      return { err };
    }
  }

  public name(): string {
    return this._pluginDef.name;
  }

  public version(): string {
    return this._pluginDef.version;
  }
}
