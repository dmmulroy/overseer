import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const oxlintExecutable = fileURLToPath(
  new URL("../../node_modules/oxlint/bin/oxlint", import.meta.url),
);
const overseerPlugin = fileURLToPath(
  new URL("../../tooling/oxlint/overseer-plugin.ts", import.meta.url),
);

const lintSource = (
  source: string,
  flags: readonly string[] = [],
): { readonly fixedSource: string; readonly output: string; readonly status: number | null } => {
  const directory = mkdtempSync(join(tmpdir(), "overseer-oxlint-"));
  const sourcePath = join(directory, "fixture.ts");
  const configPath = join(directory, ".oxlintrc.json");

  try {
    writeFileSync(sourcePath, source);
    writeFileSync(
      configPath,
      JSON.stringify({
        jsPlugins: [{ name: "overseer", specifier: overseerPlugin }],
        rules: { "overseer/prefer-direct-object-properties": "error" },
      }),
    );

    const result = spawnSync(
      process.execPath,
      [oxlintExecutable, "-c", configPath, ...flags, sourcePath],
      {
        encoding: "utf8",
        stdio: "pipe",
      },
    );
    return {
      fixedSource: readFileSync(sourcePath, "utf8"),
      output: `${result.stdout}${result.stderr}`,
      status: result.status,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

describe("prefer-direct-object-properties Oxlint rule", () => {
  it("reports conditional spreads with one empty object branch", () => {
    const result = lintSource(`
      declare const path: string | undefined;
      declare const side: "old" | "new" | undefined;
      const value = {
        ...(path === undefined ? {} : { path }),
        ...(side === "old" || side === "new" ? { side } : {}),
      };
    `);

    expect(result.status).toBe(1);
    expect(result.output.match(/prefer-direct-object-properties/g)).toHaveLength(2);
  });

  it("applies the direct-property rewrite as an explicit fix suggestion", () => {
    const result = lintSource(
      `const value = {
  ...(path === undefined ? {} : { path }),
  ...(start === undefined ? {} : { lineStart: start, lineEnd: end }),
  ...(side === "old" || side === "new" ? { side } : {}),
};\n`,
      ["--fix-suggestions"],
    );

    expect(result.status).toBe(0);
    expect(result.fixedSource).toBe(`const value = {
  path,
  lineStart: start, lineEnd: end,
  side,
};\n`);
  });

  it("does not suggest dropping unrelated runtime conditions", () => {
    const source = `const value = {
  ...(replayed ? { "idempotency-replayed": "true" } : {}),
};\n`;
    const result = lintSource(source, ["--fix-suggestions"]);

    expect(result.status).toBe(1);
    expect(result.fixedSource).toBe(source);
  });

  it("accepts direct properties and conditionals that choose between populated objects", () => {
    const result = lintSource(`
      declare const path: string | undefined;
      declare const choosePath: boolean;
      const direct = { path };
      const alternatives = { ...(choosePath ? { path } : { path: "fallback" }) };
    `);

    expect(result.status).toBe(0);
    expect(result.output).not.toContain("prefer-direct-object-properties");
  });
});
