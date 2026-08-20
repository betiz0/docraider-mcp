import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DefaultPackageManager, SettingsManager, loadSkills } from "@earendil-works/pi-coding-agent";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { chmodSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { delimiter, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const names = ["docraider-search", "docraider-crawl", "docraider-manage"] as const;
const quote = (value: string): string => `'${value.replaceAll("'", `'\"'\"'`)}'`;

let sandbox: string;
let packageRoot: string;
let env: NodeExecutionEnv;

function resultValue<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw result.error;
  return result.value;
}

beforeAll(async () => {
  env = new NodeExecutionEnv({ cwd: root });
  sandbox = resultValue(await env.createTempDir("docraider-pi-package-"));

  const build = resultValue(await env.exec("npm run build", { timeout: 60 }));
  expect(build.exitCode, build.stderr).toBe(0);

  const pack = resultValue(await env.exec(
    `npm pack --json --pack-destination ${quote(sandbox)}`,
    { timeout: 60, env: { FORCE_COLOR: "0", NO_COLOR: "1" } },
  ));
  expect(pack.exitCode, pack.stderr).toBe(0);
  const tarball = readdirSync(sandbox).find((file) => file.endsWith(".tgz"));
  expect(tarball).toBeDefined();

  const installRoot = join(sandbox, "installed");
  mkdirSync(installRoot);
  writeFileSync(join(installRoot, "package.json"), JSON.stringify({ private: true, allowScripts: [] }));
  const install = resultValue(await env.exec(
    `npm install --ignore-scripts --prefix ${quote(installRoot)} ${quote(join(sandbox, tarball!))}`,
    { timeout: 60, env: { FORCE_COLOR: "0", NO_COLOR: "1", npm_config_userconfig: "/dev/null", npm_config_allow_scripts: "" } },
  ));
  expect(install.exitCode, install.stderr).toBe(0);
  packageRoot = join(installRoot, "node_modules", "docraider-mcp");
}, 90_000);

afterAll(async () => {
  await env?.cleanup();
});

describe("Agent Skills packed pi package", () => {
  it("uses pi 0.84.2 package discovery to find exactly the three published skills", async () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    expect(pkg.pi?.skills).toEqual(names.map((name) => `skills/${name}`));
    expect(pkg.keywords).toContain("pi-package");

    const settingsManager = SettingsManager.inMemory({}, { projectTrusted: true });
    const packageManager = new DefaultPackageManager({
      cwd: sandbox,
      agentDir: join(sandbox, "agent"),
      settingsManager,
    });
    const resolved = await packageManager.resolveExtensionSources([packageRoot], { temporary: true });

    expect(resolved.extensions).toEqual([]);
    expect(resolved.prompts).toEqual([]);
    expect(resolved.themes).toEqual([]);
    expect(resolved.skills.map((skill) => relative(packageRoot, skill.path))).toEqual(
      names.map((name) => `skills/${name}/SKILL.md`),
    );
    for (const skill of resolved.skills) {
      expect(skill).toMatchObject({
        enabled: true,
        metadata: { scope: "temporary", origin: "package", baseDir: packageRoot },
      });
    }
  });

  it("passes pi's official frontmatter validation with no diagnostics", async () => {
    const settingsManager = SettingsManager.inMemory({}, { projectTrusted: true });
    const packageManager = new DefaultPackageManager({
      cwd: sandbox,
      agentDir: join(sandbox, "agent-frontmatter"),
      settingsManager,
    });
    const resolved = await packageManager.resolveExtensionSources([packageRoot], { temporary: true });
    const loaded = loadSkills({
      cwd: sandbox,
      agentDir: join(sandbox, "agent-frontmatter"),
      skillPaths: resolved.skills.map((skill) => skill.path),
      includeDefaults: false,
    });

    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.skills.map((skill) => skill.name)).toEqual(names);
    expect(loaded.skills.every((skill) => skill.description.length >= 20)).toBe(true);
    expect(new Set(loaded.skills.map((skill) => skill.name)).size).toBe(names.length);
    expect(loaded.skills.every((skill) => skill.filePath.startsWith(packageRoot))).toBe(true);
  });

  it("reports official pi diagnostics for invalid Agent Skills frontmatter", () => {
    const invalidDir = join(sandbox, "invalid-skill");
    mkdirSync(invalidDir);
    const invalidPath = join(invalidDir, "SKILL.md");
    writeFileSync(invalidPath, "---\nname: Invalid_Name\ndescription: diagnostic fixture\n---\nFixture.\n");

    const loaded = loadSkills({
      cwd: sandbox,
      agentDir: join(sandbox, "agent-invalid"),
      skillPaths: [invalidPath],
      includeDefaults: false,
    });
    expect(loaded.diagnostics).toEqual([
      expect.objectContaining({
        type: "warning",
        path: invalidPath,
        message: expect.stringContaining("invalid characters"),
      }),
    ]);
  });

  it.each(names)("%s publishes portable relative resources and an executable wrapper", (name) => {
    const directory = join(packageRoot, "skills", name);
    const markdown = readFileSync(join(directory, "SKILL.md"), "utf8");
    expect(markdown).toContain("scripts/docraider");
    for (const match of markdown.matchAll(/\[references\/([^\]]+)\]\((references\/[^)]+)\)/g)) {
      expect(readFileSync(join(directory, match[2]), "utf8").length).toBeGreaterThan(0);
    }
    expect(statSync(join(directory, "scripts", "docraider")).mode & 0o111).not.toBe(0);
  });

  it.each(names)("%s executes the package-relative CLI from the packed artifact", async (name) => {
    const wrapper = join(packageRoot, "skills", name, "scripts", "docraider");
    const emptyBin = join(sandbox, `empty-${name}`);
    mkdirSync(emptyBin);
    const result = resultValue(await env.exec(
      `${quote(wrapper)} stats --help`,
      { env: { PATH: emptyBin, NODE: process.execPath } },
    ));

    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, command: "stats" });
  });

  it.each(names)("%s prefers a docraider executable on PATH", async (name) => {
    const wrapper = join(packageRoot, "skills", name, "scripts", "docraider");
    const bin = join(sandbox, `path-${name}`);
    mkdirSync(bin);
    const pathCli = join(bin, "docraider");
    writeFileSync(pathCli, `#!/bin/sh\nprintf 'path:%s\n' "$*"\n`);
    chmodSync(pathCli, 0o755);
    const result = resultValue(await env.exec(
      `${quote(wrapper)} search topic`,
      { env: { PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` } },
    ));

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("path:search topic");
  });
});
