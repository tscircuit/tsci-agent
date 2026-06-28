import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getTestCli } from "./fixtures/getTestCli";

test("runs do --sandbox from a temporary copy while leaving the original workspace readable", async () => {
  await using cli = await getTestCli();
  await cli.files.write(
    "./index.circuit.tsx",
    `export default function Circuit() {\n  return <board width={10} height={10} />\n}\n`,
  );

  const result = await cli.do(
    "Review this tscircuit project. First inspect the current directory with a tool and base your response only on those files.",
    { sandbox: true },
  );

  expect(result.exitCode).toBe(0);

  const sandboxDir = await cli.getLastSandboxDir();
  expect(sandboxDir).toBeDefined();
  await expect(cli.getLastStderr()).resolves.toContain(`cwd=${sandboxDir}`);
  await expect(readFile(join(sandboxDir!, "index.circuit.tsx"), "utf8")).resolves.toContain("<board");
  await expect(cli.getLastStderr()).resolves.toContain("[tool] bash");
  await expect(cli.files.ls("./")).resolves.toContain("index.circuit.tsx");
  await expect(cli.files.read("./index.circuit.tsx")).resolves.toContain("<board");

  const review = (await cli.getLastOutput()).trim();
  expect(review).toMatchInlineSnapshot(`
    "I inspected the project directory and opened the only file present.

    Files found
    - index.circuit.tsx

    File contents (index.circuit.tsx)
    export default function Circuit() {
      return <board width={10} height={10} />
    }

    Quick summary
    - This is an extremely minimal tscircuit project: a single TSX file that exports a Circuit component which renders a <board> with width and height 10.
    - There are no supporting project files (package.json, tsconfig, README, parts/footprints, BOM, schematic, build configs, test files, etc.).

    What this implies
    - The project won’t build or run as-is because standard project metadata and tooling files are missing.
    - The tscircuit description itself is just a placeholder board with no components, nets, or other design data, so there’s nothing to fabricate, simulate, or export.

    Recommendations — prioritized
    1. Add project metadata and tooling
       - Create package.json, tsconfig.json (if using TypeScript), and any scripts for the tsci tooling you plan to use (build, dev, export).
       - Add a README.md explaining purpose and how to run the project.

    2. Flesh out the circuit
       - Add components (resistors, ICs, connectors) and footprints to the index.circuit.tsx (or split into components).
       - Define nets and connections so the design is meaningful.
       - Add power rails, ground, and any required constraints.

    3. Add project structure commonly used with tscircuit
       - A directory for parts/footprints, BOM output, and PnP files.
       - Schematic and board layout files if your workflow separates them.

    4. Add build/export targets
       - Configure export targets for Gerbers, drill, BOM, PnP.
       - Add a CI workflow (GitHub Actions) to lint/build and export artifacts automatically.

    5. Documentation and tests
       - Document component choices, mechanical constraints, and expected outputs.
       - Add basic tests or validation rules (DRC-like checks).

    Implementation notes and suggestions for index.circuit.tsx
    - The component is valid as a minimal entrypoint. To make it useful, replace or extend <board width={10} height={10} /> with actual subelements (components, nets, mounting holes). Example structure you might aim for:
      - <board width={...} height={...}>
          <component ref="U1" footprint="...">...</component>
          <component ref="J1" footprint="...">...</component>
          <net name="GND">...</net>
        </board>
    - Consider using descriptive units or comments if width/height are in mm, grid units, or cells.

    If you want, I can:
    - Create a minimal package.json and tsconfig to make the project buildable.
    - Expand index.circuit.tsx into a small example board with a connector and a resistor+LED to demonstrate nets, footprint selection, and BOM generation.
    - Initialize a README and add scripts for tsci (if you want me to run tsci commands, confirm and I’ll proceed).

    Which next step would you like me to take?"
  `);
}, 60_000);
