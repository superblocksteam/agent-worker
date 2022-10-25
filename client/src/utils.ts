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

export type Timings = {
  invocation?: number;
  socketRequest?: number;
  socketResponse?: number;
};

export type Metadata = {
  orgID?: string;
  carrier?: Record<string, string>;
  // agnostic metric tags sent from the controller that the worker should blindly append to every metric
  extraMetricTags?: Record<string, string | number>;
};

export type Comparator<T> = (a: T, b: T) => number;

export class SortedArray<T> {
  private _data: T[];
  private _comparator: Comparator<T>;

  constructor(comparator: Comparator<T>) {
    this._data = [];
    this._comparator = comparator;
  }

  public add(item: T) {
    if (this._data.length === 0 || this._comparator(this._data[0], item) >= 0) {
      this._data.splice(0, 0, item);
      return this._data;
    } else if (this._data.length > 0 && this._comparator(this._data[this._data.length - 1], item) <= 0) {
      this._data.splice(this._data.length, 0, item);
      return this._data;
    }
    let left = 0,
      right = this._data.length;
    let leftLast = 0,
      rightLast = right;
    while (left < right) {
      const inPos = Math.floor((right + left) / 2);
      const compared = this._comparator(this._data[inPos], item);
      if (compared < 0) {
        left = inPos;
      } else if (compared > 0) {
        right = inPos;
      } else {
        right = inPos;
        left = inPos;
      }
      // nothing has changed, must have found limits. insert between.
      if (leftLast === left && rightLast === right) {
        break;
      }
      leftLast = left;
      rightLast = right;
    }
    // use right, because Math.floor is used
    this._data.splice(right, 0, item);
  }

  public size(): number {
    return this._data.length;
  }

  public get(idx: number): T | undefined {
    return idx < this.size() ? this._data[idx] : undefined;
  }

  public filter(include: (_: T) => boolean): SortedArray<T> {
    const copy = new SortedArray<T>(this._comparator);
    copy._data = this._data.filter(include);
    return copy;
  }

  public map<S>(transform: (_: T) => S): S[] {
    return this._data.map(transform);
  }

  public [Symbol.iterator](): { next: () => { done: boolean; value: T } } {
    let counter = 0;

    const next = (): { done: boolean; value: T } => {
      return { done: counter === this.size(), value: this.get(counter++) as T };
    };

    return { next };
  }
}
