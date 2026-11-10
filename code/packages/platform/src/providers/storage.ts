// Object storage boundary (AD-10). B1 only needs the readiness ping; S3 is not used.
export interface ObjectStorage {
  ping(): Promise<boolean>;
}
export class FakeObjectStorage implements ObjectStorage {
  healthy = true;
  async ping(): Promise<boolean> {
    return this.healthy;
  }
}
