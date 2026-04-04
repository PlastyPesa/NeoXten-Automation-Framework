export interface GateStep {
  name: string;
  type: 'yaml' | 'flutter' | 'flutter_integration' | 'cargo' | 'policy';
  config?: string;
  outSubDir?: string;
  testPath?: string;
  testTarget?: string;
  driverPath?: string;
  cwd?: string;
  policyRoot?: string;
  deviceId?: string;
}

export interface GateSuiteDefinition {
  schemaVersion: string;
  suiteId: string;
  displayName: string;
  steps: GateStep[];
}
