declare module 'adm-zip' {
  class AdmZip {
    constructor(path?: string | Buffer);
    addFile(name: string, data: Buffer): void;
    getEntry(name: string): { isDirectory: boolean; entryName: string } | null;
    readFile(entry: { entryName: string; isDirectory: boolean }): Buffer | null;
    getEntries(): Array<{ entryName: string; isDirectory: boolean }>;
    writeZip(path: string): void;
  }
  export = AdmZip;
}
