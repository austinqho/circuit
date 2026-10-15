export type ReactSurface = 'react' | 'react-dom' | 'react-dom/client' | 'react-dom/server';
export type ReactSemanticDisposition = 'modeled' | 'no_relevant_tracing_effect' | 'unsupported';
export interface ReactApiRecord {
  readonly id: string;
  readonly surface: ReactSurface;
  readonly package: 'react' | 'react-dom';
  readonly export: string;
  readonly versions: readonly string[];
  readonly disposition: ReactSemanticDisposition;
  readonly semantic_kind?: 'retained_callback' | 'state_pair' | 'context_value' | 'ref_cell' | 'root_handle' | 'class_component' | 'component_wrapper' | 'synchronous_scope';
  readonly condition?: string;
  readonly reason?: string;
  readonly environment?: 'node' | 'browser';
  readonly reference: string;
  readonly behavior: import('./react-behavior.mjs').ReactBehavior;
}
export interface ReactPackageAttestation {
  readonly id: string;
  readonly package: 'react' | 'react-dom';
  readonly version: string;
  readonly integrity: string;
  readonly source: string;
  readonly verification: {
    readonly method: 'exact_installed_package_source';
    readonly installations: readonly {
      readonly package: string;
      readonly version: string;
      readonly integrity: string;
      readonly files: Readonly<Record<string, string>>;
    }[];
  };
}
export declare const REACT_API_INVENTORY: readonly ReactApiRecord[];
export declare const REACT_PACKAGE_ATTESTATIONS: readonly ReactPackageAttestation[];
export declare function reactSemanticPackages(): string[];
export declare function reactPackageAttestation(packageName: string, version: string): ReactPackageAttestation | null;
export declare function getReactApiRecord(input: {
  surface: ReactSurface;
  exportName: string;
  version: string;
  environment?: 'node' | 'browser';
}): ReactApiRecord | null;
