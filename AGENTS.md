# Repository Guidelines

## Tests

- Put exactly one `test(...)` per test file.
- Enumerate every test file by appending a two-digit number immediately before `.test.ts` (for example, `do-command01.test.ts`, `sandbox02.test.ts`, `feature03.test.ts`, etc.).
- Do not use `describe`.
- Do not use `beforeEach` or `afterEach`.
- Test fixtures such as `getTestCli()` should clean themselves up. Prefer `await using cli = await getTestCli()` for fixtures that implement `Symbol.asyncDispose`.
