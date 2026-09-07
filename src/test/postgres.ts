import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

export class TestPostgres {
  private readonly container = `fipe-publication-test-${randomUUID()}`;
  private created = false;

  private docker(args: string[], input?: string): string {
    return execFileSync("docker", args, {
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    }).trim();
  }

  async start(exposePort = false): Promise<void> {
    this.docker([
      "create",
      "--name",
      this.container,
      "-e",
      "POSTGRES_PASSWORD=publication-test",
      ...(exposePort ? ["-p", "127.0.0.1::5432"] : []),
      "postgres:17-alpine",
    ]);
    this.created = true;
    this.docker(["start", this.container]);

    for (let attempt = 0; attempt < 60; attempt++) {
      const ready = spawnSync(
        "docker",
        ["exec", this.container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"],
        { stdio: "pipe", timeout: 5_000 },
      );
      if (ready.status === 0) return;
      await setTimeout(500);
    }
    throw new Error(
      `Test PostgreSQL did not become ready: ${this.docker(["logs", this.container])}`,
    );
  }

  stop(): void {
    if (this.created) this.docker(["rm", "-f", "-v", this.container]);
  }

  url(database: string): string {
    const address = this.docker(["port", this.container, "5432/tcp"]);
    return `postgres://postgres:publication-test@${address}/${database}`;
  }

  sql(database: string, query: string): string {
    return this.docker(
      [
        "exec",
        "-i",
        this.container,
        "psql",
        "-U",
        "postgres",
        "-d",
        database,
        "-v",
        "ON_ERROR_STOP=1",
        "-At",
      ],
      query,
    );
  }
}
