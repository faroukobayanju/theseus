# Gates: Theseus MVP Core Demo Flow

OWNS: src/**, examples/**, tests/**, package.json, tsconfig.json, tsup.config.ts, vitest.config.ts, scripts/**

Scope: Build minimal, working Theseus CLI with Kane CLI adapter, closed-loop convergence engine, signed HTML report, and bundled legacy-vs-modern shop demo.

- [x] G1: Typecheck, full unit test suite, and CLI bundle build pass cleanly
  CHECK: node scripts/gate-build-test.mjs
  EXPECT: GATE_G1_PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=445a9aeda1f07f1a92a3e764d13b964a3f8a3229883df7f8dcf35227d631e024; exit=0; EXPECT=matched; output-sha256=29189fcb8f920efa1b7bd5b122b0d3245b3428d3716bb9255d812e0442897b6c; output-bytes=1792; shell=/bin/sh; cwd=/Users/zorak/Downloads/kane cli; path=02dfe4d2a8e2/28 entries

- [x] G2: Bundled legacy-shop and modern-shop servers boot cleanly and exhibit the 3 distinct behavioral drifts before convergence
  CHECK: node scripts/gate-demo-drifts.mjs
  EXPECT: GATE_G2_PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=9d34d64d212b50ff1dc1ef262be4f10db9081de9934ac6c601564e02d9023ec2; exit=0; EXPECT=matched; output-sha256=102a8c16dc7f33e4ca472f2e5b7c8801aa33bc99a67ac1c2d27e1effbffcb6e7; output-bytes=13; shell=/bin/sh; cwd=/Users/zorak/Downloads/kane cli; path=02dfe4d2a8e2/28 entries

- [x] G3: Full closed-loop convergence demo (baseline -> drift detection -> patch -> targeted re-verify -> full regression pass -> signed HTML & JSON certificate) converges to EQUIVALENT with exit 0
  CHECK: node scripts/gate-converge-e2e.mjs
  EXPECT: GATE_G3_PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=e0a34a627cdc5b4a3a65503ea1c7be9e216d8e0f7fc3af7f8cbca07b2d9e2141; exit=0; EXPECT=matched; output-sha256=92ae3745b78b275a9128797a3b4d4b8f1efac7c06de90818fd67b6d50358103c; output-bytes=290; shell=/bin/sh; cwd=/Users/zorak/Downloads/kane cli; path=02dfe4d2a8e2/28 entries
