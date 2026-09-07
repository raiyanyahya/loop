#!/usr/bin/env bash
# Independent edge-case checks against the real CLI, outside the node:test suite: CRLF files,
# unicode paths, huge outputs and prompts, timeouts, concurrent commands, resume, every template.
# Run with `npm run test:torture`. Prints PASS/FAIL per check.
ROOT=$(cd "$(dirname "$0")/.." && pwd)
LOOP="node $ROOT/bin/loop.js"
FAKE=$ROOT/src/fake-agent.js
export NO_COLOR=1 GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
unset LOOP_FAKE_SCENARIO LOOP_FAKE_PROMPT_LOG
pass=0; fail=0
ok(){ echo "PASS  $1"; pass=$((pass+1)); }
bad(){ echo "FAIL  $1  -- $2"; fail=$((fail+1)); }
mk(){ d=$(mktemp -d /tmp/loop-torture-XXXXXX); cd "$d"; }

# 1. CRLF Loopfile with BOM-free Windows line endings
mk; printf -- '---\r\nagent: fake\r\nmax: 1\r\n---\r\nDo it.\r\n- [ ] one\r\n' > LOOP.md
out=$(LOOP_FAKE_SCENARIO='{"iterations":[{"say":["hi"],"check":1,"done":true}]}' $LOOP run 2>&1); code=$?
[ $code -eq 0 ] && grep -q "\[x\] one" LOOP.md && ok "CRLF Loopfile parses, ticks apply" || bad "CRLF Loopfile" "exit $code: $(echo "$out" | tail -2)"

# 2. Spaces and unicode in the project path and file names
mk; mkdir -p "my proj é/sub dir"; cd "my proj é/sub dir"; git init -q; git commit -q --allow-empty -m init
printf -- '---\nagent: fake\nprotect: ["tést dir/**"]\nmax: 2\ngit: true\n---\nx\n' > LOOP.md; mkdir -p "tést dir"; echo keep > "tést dir/spec é.txt"; git add -A; git commit -qm base
out=$(LOOP_FAKE_SCENARIO='{"iterations":[{"write":{"tést dir/spec é.txt":"hacked","new fïle.txt":"1"},"done":true},{"write":{"other.txt":"2"},"done":true}]}' $LOOP run 2>&1); code=$?
[ $code -eq 0 ] && [ "$(cat "tést dir/spec é.txt")" = keep ] && git log --oneline | grep -q "#2" && ok "spaces/unicode paths: protect restore + commit" || bad "unicode paths" "exit $code: $(echo "$out" | grep -E 'protected|Error|error' | head -3)"

# 3. 300 KB of agent output is captured and does not break the run
mk; printf -- '---\nagent: fake\nmax: 1\n---\nx\n' > LOOP.md
big=$(python3 -c "print(('line of output ' * 10 + '\\\\n') * 2000)")  # ~300KB
python3 - <<PY
import json; open('sc.json','w').write(json.dumps({"iterations":[{"say":[("line of output "*10)]*2000 + ["<loop:done/>"]}]}))
PY
out=$(LOOP_FAKE_SCENARIO=$PWD/sc.json $LOOP run --quiet 2>&1); code=$?
sz=$(stat -c %s .loop/runs/*/iter-001/output.txt 2>/dev/null || echo 0)
[ $code -eq 0 ] && [ "$sz" -gt 250000 ] && ok "300KB agent output captured (${sz} bytes), done detected at the end" || bad "big output" "exit $code size $sz"

# 4. 200 KB context file inlined into a stdin prompt
mk; python3 -c "open('SPEC.md','w').write('spec line\n'*20000)"; printf -- '---\nagent: fake\ncontext: [SPEC.md]\nmax: 1\n---\nx\n' > LOOP.md
out=$(LOOP_FAKE_SCENARIO='{"iterations":[{"say":["ok"],"done":true}]}' LOOP_FAKE_PROMPT_LOG=$PWD/.loop/p.log $LOOP run --quiet 2>&1); code=$?
psz=$(stat -c %s .loop/p.log 2>/dev/null || echo 0)
[ $code -eq 0 ] && [ "$psz" -gt 190000 ] && ok "200KB context file delivered via stdin (${psz} byte prompt)" || bad "big prompt" "exit $code prompt $psz"

# 5. hook/check timeout is enforced (check_timeout 1s, check sleeps 5s)
mk; printf -- '---\nagent: fake\nuntil: ["sleep 5"]\ncheck_timeout: 1s\nmax: 1\nstall: 0\n---\nx\n' > LOOP.md
start=$(date +%s); out=$(LOOP_FAKE_SCENARIO='{"iterations":[{"write":{"a":"1"}}]}' $LOOP run 2>&1); el=$(( $(date +%s) - start ))
echo "$out" | grep -q "timed out" && [ $el -lt 5 ] && ok "check_timeout kills a hung check (${el}s total)" || bad "check timeout" "took ${el}s: $(echo "$out" | grep -i 'check' | head -2)"

# 6. status/log from another process while a loop is running; stop from outside
mk; printf -- '---\nagent: fake\nmax: 5\nstall: 0\n---\nx\n' > LOOP.md
LOOP_FAKE_SCENARIO='{"iterations":[{"say":["slow"],"write":{"f":"1"},"append":{"f":"+"},"delay":1500}]}' $LOOP run --quiet > run.out 2>&1 & P=$!
sleep 1.2; st=$($LOOP status 2>&1); lg=$($LOOP log 2>&1); $LOOP stop >/dev/null 2>&1; wait $P; code=$?
echo "$st" | grep -q "status     running" && echo "$lg" | grep -q "still running" && grep -q "stop requested" .loop/state.json && ok "status/log while running; stop from another process" || bad "concurrent status/stop" "exit $code | $(echo "$st" | grep status) | $(grep -o '"reason": "[^"]*"' .loop/state.json)"

# 7. second loop in the same directory is refused while the first runs
LOOP_FAKE_SCENARIO='{"iterations":[{"say":["slow"],"write":{"g":"1"},"append":{"g":"+"},"delay":2000}]}' $LOOP run --quiet > run2.out 2>&1 & P=$!
sleep 0.8; out=$($LOOP run 2>&1); $LOOP stop --now >/dev/null 2>&1; wait $P
echo "$out" | grep -q "already running" && ok "second run refused while one is alive" || bad "double run" "$(echo "$out" | tail -1)"

# 8. resume after stuck keeps the letter; --fresh clears it
mk; printf -- '---\nagent: fake\nmax: 2\n---\nx\n' > LOOP.md
LOOP_FAKE_SCENARIO='{"iterations":[{"letter":"REMEMBER ME","stuck":"need a key"}]}' $LOOP run --quiet >/dev/null 2>&1; c1=$?
LOOP_FAKE_SCENARIO='{"iterations":[{"say":["back"],"done":true}]}' LOOP_FAKE_PROMPT_LOG=$PWD/.loop/p.log $LOOP run --quiet >/dev/null 2>&1; c2=$?
grep -q "REMEMBER ME" .loop/p.log && [ $c1 -eq 2 ] && [ $c2 -eq 0 ] && ok "resume after stuck carries the letter (exit 2 then 0)" || bad "resume" "exit $c1/$c2"
rm -f .loop/p.log; LOOP_FAKE_SCENARIO='{"iterations":[{"say":["fresh"],"done":true}]}' LOOP_FAKE_PROMPT_LOG=$PWD/.loop/p.log $LOOP run --quiet --fresh >/dev/null 2>&1
grep -q "REMEMBER ME" .loop/p.log && bad "--fresh" "letter still present" || ok "--fresh forgets the letter"

# 9. keep: improve without git only reports
mk; printf -- '---\nagent: fake\nmetric: "cat n.txt"\nmax: 2\nstall: 0\n---\nx\n' > LOOP.md; echo 5 > n.txt
out=$(LOOP_FAKE_SCENARIO='{"iterations":[{"write":{"n.txt":"3"}},{"write":{"n.txt":"2"}}]}' $LOOP run 2>&1)
echo "$out" | grep -q "would have reverted" && [ "$(cat n.txt)" = 2 ] && ok "keep without git: warns, never reverts" || bad "keep no git" "$(echo "$out" | grep -iE 'revert|metric' | head -3)"

# 10. nested checklist items and numbered items count; rituals + relay + handoff in one file
mk; printf -- '---\nagent: [fake, custom]\ncommand: "node %s"\nuntil: checklist\nmax: 3\nrituals: [{at: 1, prompt: PLAN}]\n---\n1. [ ] a\n   - [ ] b\n' "$FAKE" > LOOP.md
out=$(LOOP_FAKE_SCENARIO='{"iterations":[{"say":["plan"]},{"check":2,"handoff":"custom"}]}' LOOP_FAKE_PROMPT_LOG=$PWD/.loop/p.log $LOOP run --quiet 2>&1); code=$?
[ $code -eq 0 ] && grep -q "PLAN" .loop/p.log && grep -q "\[x\] b" LOOP.md && ok "numbered + nested checklist, ritual at 1, relay, handoff" || bad "mixed" "exit $code $(echo "$out" | tail -2)"

# 11. error paths: bad YAML, missing file, unknown agent, bad duration, invalid keep
mk; printf -- '---\nmax: [unclosed\n---\nx\n' > LOOP.md; out=$($LOOP run 2>&1); e1=$?
out2=$($LOOP run nope.md 2>&1); e2=$?
printf -- '---\nmax_time: soon\n---\nx\n' > LOOP.md; out3=$($LOOP run 2>&1); e3=$?
printf -- '---\nagent: fake\nkeep: maybe\n---\nx\n' > LOOP.md; out4=$($LOOP run 2>&1); e4=$?
[ $e1 -ne 0 ] && [ $e2 -ne 0 ] && echo "$out2" | grep -q "no Loopfile found" && echo "$out3" | grep -q "invalid duration" && echo "$out4" | grep -q "keep must be" && ok "error paths exit non-zero with clear messages" || bad "errors" "$e1/$e2/$e3/$e4"

# 12. report --out, log --runs, status --json, letter, answer, init --list, templates render for every template
mk; printf -- '---\nagent: fake\nmax: 1\n---\nx\n' > LOOP.md
LOOP_FAKE_SCENARIO='{"iterations":[{"letter":"L1","done":true}]}' $LOOP run --quiet >/dev/null 2>&1
$LOOP report --out out/r.html >/dev/null 2>&1 && [ -s out/r.html ] && $LOOP log --runs | grep -qE "^  20" && $LOOP status --json | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['status']=='done'" && [ "$($LOOP letter | tr -d '\n ')" = "L1" ] && ok "report --out, log --runs, status --json, letter" || bad "commands" "see above"
allok=1; for t in default plan-build tdd fix-ci checklist optimize overnight relay research ralph; do d2=$(mktemp -d); (cd "$d2" && $LOOP init $t --yes --agent fake --goal G --test "npm test" --metric "m" --direction min >/dev/null 2>&1 && $LOOP run --dry --agent fake --critic same >/dev/null 2>&1) || { allok=0; echo "   template $t failed"; }; done
[ $allok -eq 1 ] && ok "all 10 templates init + dry-run cleanly" || bad "templates" "see above"

# 13. metric loop with target, in git, using real shell tools as the metric (wc)
mk; git init -q; git commit -q --allow-empty -m init; printf -- '---\nagent: fake\nuntil: never\nmetric: "wc -w < words.txt"\ntarget: 6\nmax: 6\nstall: 0\n---\nx\n' > LOOP.md; echo "one two" > words.txt; git add -A; git commit -qm base
out=$(LOOP_FAKE_SCENARIO='{"iterations":[{"write":{"words.txt":"one two three"}},{"write":{"words.txt":"one"}},{"write":{"words.txt":"a b c d e f"}}]}' $LOOP run 2>&1); code=$?
[ $code -eq 0 ] && echo "$out" | grep -q "target 6 reached" && [ "$(git log --oneline | grep -c 'loop(')" = 2 ] && ok "metric via wc: 2 kept, 1 reverted, target reached" || bad "metric wc" "exit $code $(echo "$out" | grep -E 'metric|target' | head -3)"

echo; echo "torture: $pass passed, $fail failed"; [ $fail -eq 0 ]
