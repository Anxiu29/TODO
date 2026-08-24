import { createServer, type AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { isTcpPortInUse, pickDevRendererPort } from "../src/data/devPort";

const listen = async (): Promise<{ port: number; close: () => Promise<void> }> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        port,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          })
      });
    });
  });

describe("dev renderer port", () => {
  let closer: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (closer) {
      await closer();
      closer = null;
    }
  });

  it("reports a listening port as in use", async () => {
    const server = await listen();
    closer = server.close;
    await expect(isTcpPortInUse(server.port)).resolves.toBe(true);
  });

  it("skips the preferred port when it is already taken", async () => {
    const server = await listen();
    closer = server.close;
    const picked = await pickDevRendererPort(server.port, 5);
    expect(picked.preferredInUse).toBe(true);
    expect(picked.port).not.toBe(server.port);
  });
});
