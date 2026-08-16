import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Application, TSConfigReader, TypeDocReader } from "typedoc";

/**
 * Generates the API reference for `domain-tools`.
 *
 * This drives TypeDoc through its Node API rather than its CLI so the run can
 * be inspected: the TypeScript version actually used is printed, and conversion,
 * validation and rendering are separate steps, each of which can end the run.
 *
 * The run is **strict** — any warning fails it. A broken `{@link}`, or a type
 * that reaches the public surface without being exported, is a defect in the
 * reference, and a reference that is quietly wrong is worse than one that was
 * never built.
 *
 * Options live in `typedoc.json` beside this workspace's `package.json`, which
 * is also what a bare `typedoc` CLI invocation reads, so the two cannot drift.
 * `treatWarningsAsErrors` is set there for the benefit of that CLI path; it is
 * deliberately not what this module relies on, because it was observed **not**
 * to promote link-resolution warnings — those still arrive on the warn path
 * with `hasErrors()` false. Counting warnings directly is what actually holds.
 */

/** The workspace root, resolved from this module rather than from `cwd`. */
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Strictness in one place: an error, or any warning at all, ends the run. */
function hasProblems(app: Application): boolean {
  return app.logger.hasErrors() || app.logger.warningCount > 0;
}

async function main(): Promise<number> {
  const app = await Application.bootstrapWithPlugins(
    { options: workspaceRoot },
    [new TypeDocReader(), new TSConfigReader()],
  );

  app.logger.info(
    `typedoc ${Application.VERSION} · typescript ${app.getTypeScriptVersion()}`,
  );

  const project = await app.convert();
  if (!project) {
    app.logger.error("conversion produced no project");
    return 1;
  }
  if (hasProblems(app)) return 1;

  app.validate(project);
  if (hasProblems(app)) return 1;

  // Everything above runs before a single file is written, which is the point:
  // a run that fails for a bad link leaves no half-correct site behind.
  await app.generateOutputs(project);
  if (hasProblems(app)) {
    app.logger.error("rendering reported problems — the output may be partial");
    return 1;
  }

  app.logger.info(
    `reference written to ${resolve(workspaceRoot, app.options.getValue("out"))}`,
  );
  return 0;
}

process.exitCode = await main();
