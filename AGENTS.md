# Repository Guidelines

## Tests

- Put exactly one `test(...)` per test file.
- Do not use `describe`.
- Do not use `beforeEach` or `afterEach`.
- Test fixtures such as `getTestCli()` should clean themselves up. Prefer `await using cli = await getTestCli()` for fixtures that implement `Symbol.asyncDispose`.
