# Contributing

Thanks for looking. The whole tool is a few thousand lines of plain Node with no dependencies, so it is easy to read end to end: start at `src/runner.js`.

## Working on it

```
git clone https://github.com/raiyanyahya/loop
cd loop
npm test                 # 68 tests, no API key needed: a scripted fake agent plays every role
npm run test:torture     # edge cases against the real CLI
node bin/loop.js demo    # a real loop in a temporary git repo
npm link                 # puts `loop` on your PATH from this checkout
```

## Ground rules

- Zero dependencies stays zero. If a feature needs a package, it needs a different design.
- Every feature is a Loopfile key that can be deleted. Keep defaults conservative.
- Anything that verifies must be executable (a command, a file, a diff). An LLM can add a veto on top, never replace that.
- Add a test in `test/` that runs the real CLI with the fake agent (see `test/verifier.test.js` for the pattern). If the fake agent needs a new ability, extend `src/fake-agent.js`.
- New agent adapters go in `src/agents.js` with the vendor's documented non-interactive flags, and are marked unverified until someone has run them.

## Releasing

Bump `version` in `package.json`, add a `CHANGELOG.md` entry, tag `vX.Y.Z`, and push the tag. The Publish workflow runs the tests and publishes `theloop` to npm with provenance. The Website workflow deploys `docs/` on every push to `main` that touches it.
