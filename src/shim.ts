import { ExecutionOutput, ExecutionContext } from '@superblocksteam/shared';
import { BasePlugin, PluginProps, sanitizeAgentKey } from '@superblocksteam/shared-backend';
import P from 'pino';
import {
  SUPERBLOCKS_CONTROLLER_KEY,
  SUPERBLOCKS_WORKER_EXECUTION_PYTHON_TIMEOUT_MS,
  SUPERBLOCKS_WORKER_EXECUTION_JS_TIMEOUT_MS,
  SUPERBLOCKS_WORKER_EXECUTION_REST_API_TIMEOUT_MS
} from './env';
import logger from './logger';
import { VersionedPluginDefinition, Plugin } from './plugin';

// Shim connects a BasePlugin to a Transport. Once we've deprecated
// the old architecture, there's no reason why BasePlugin can't implement
// `Plugin`; but until then, it seemed cleaner to keep them separate.
export class Shim<T extends BasePlugin> implements Plugin {
  private _plugin: T;
  private _logger: P.Logger;
  private _pluginDef: VersionedPluginDefinition;

  private constructor(pluginDef: VersionedPluginDefinition, plugin: T) {
    this._plugin = plugin;
    this._pluginDef = pluginDef;

    const { name, version } = this._pluginDef;
    this._logger = logger.child({ name, version });

    this._plugin.attachLogger(this._logger);
    this.run = this.run.bind(this);
  }

  // Using the static factory function pattern.
  static async init(pluginDef: VersionedPluginDefinition): Promise<Plugin> {
    const module = await import(`sb-${pluginDef.name}-${pluginDef.version}`);
    const plugin: BasePlugin = new module.default();

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

  public async run(props: PluginProps, callback: (_output: ExecutionOutput, _err: Error) => void): Promise<void> {
    try {
      this._logger.info('executing');

      // This code sits on the other side of a transport. Hence, we need
      // to re-construct it so that we get access to the class methods.
      props.context = new ExecutionContext(props.context);
      // For some reason, bindings use the redacted context whereas language plugins use the normal context.
      props.redactedContext = new ExecutionContext(props.redactedContext);

      // This is used by the fileServer in readContents() for authentication.
      // NOTE(frank): Can't use addGlobalVariable because we lose the
      //              class functions after encoding. We could add an
      //              unmarshal() but seems unecessary here.
      // UPDATE: I believe we can use the method now give the above change.
      props.context.globals['$agentKey'] = sanitizeAgentKey(SUPERBLOCKS_CONTROLLER_KEY);
      props.redactedContext.addGlobalVariable('$agentKey', sanitizeAgentKey(SUPERBLOCKS_CONTROLLER_KEY));

      callback(await this._plugin.setupAndExecute(props), null);
    } catch (err) {
      this._logger.error(
        {
          err: err.message,
          type: err.name
        },
        'could not execute plugin'
      );
      // We need to wrap the error and throw it in the controller.
      callback(null, err);
    }
  }

  public name(): string {
    return this._pluginDef.name;
  }

  public version(): string {
    return this._pluginDef.version;
  }
}
