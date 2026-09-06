# Contributing

Thanks for considering a contribution to postwright.

## Running the tests

```bash
npm test
```

This runs the unit and integration suites under `node:test` (`test/unit/*.test.js` and
`test/integration/*.test.js`). The suite is fully offline: no test should reach a real
network endpoint, browser session, or credential. Any test that exercises a publisher
mocks `fetch` or the browser session instead of calling out for real.

## Code style

- CommonJS only (`require`/`module.exports`). Do not introduce ESM syntax or a build step.
- Tests use the built-in `node:test` and `node:assert` modules. Do not add a third-party
  test framework.
- No new runtime dependencies without discussion first — open an issue or start a PR
  description with the reasoning before adding one. This is a small, local-first CLI
  tool and every dependency is a piece of the trust boundary between a draft and a real
  publish action.

## Changing one of the evidence gates (R1-R12)

The twelve rules in `src/core/lint.js` exist because of specific, measured behavior on a
real account (see the `EVIDENCE` map at the top of that file). If you want to change,
loosen, or remove a rule:

- Include the measured evidence behind the change (what was observed, on what channel,
  over what sample) — not just a style preference or a hypothesis about what should work.
- Explain why the existing evidence no longer applies, if you're overriding a rule that's
  already backed by a measurement.
- Add or update a test in `test/unit/lint.test.js` that exercises the new behavior.

A PR that changes a gate's pass/fail condition without new evidence will be asked for it
before review continues.

## Touching `src/publish/*` or anything that reaches a real network/browser call

Code under `src/publish/*`, and anything else that can make a live HTTP request or drive
a real browser session, gets extra scrutiny. A bug here doesn't just fail a test — it can
publish something to a real account. PRs touching this area should:

- Explain exactly what request or browser action changes, and under what conditions it
  fires.
- Confirm the change is still only reachable through the `release --confirm` path (or the
  `auth`/`doctor` read-only checks), never as a side effect of `draft`, `lint`, or `status`.
- Include a test that proves the new code path with a mocked `fetch`/browser session, not
  a live call.

## Reporting issues

Open an issue with what you expected, what happened, and the exact command you ran. If it
involves a gate rejecting a draft, include the lint output.
