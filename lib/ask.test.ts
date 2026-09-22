/**
 * 誤答を防ぐ最後の砦のテスト。
 * ここが緩むと、根拠のない断定が公開ページから利用者に出てしまう。
 *
 *   node --test lib/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasCredentials, parseAnswer } from "./ask.ts";

const withCitation = JSON.stringify({
  verdict: "spec",
  headline: "仕様どおりです",
  answerForCustomer: "リマインダーは5回で停止します。",
  explanation: "上限に関する記述があります",
  citations: [{ quote: "最大5回送られるとそれ以降は自動では送られなくなる", file: "envelope-reminder.ts" }],
  followUp: [],
});

test("出典があれば verdict はそのまま通る", () => {
  const answer = parseAnswer(withCitation);
  assert.equal(answer.verdict, "spec");
  assert.equal(answer.citations.length, 1);
  assert.match(answer.answerForCustomer, /5回/);
});

test("```json フェンス付きでも読める", () => {
  const answer = parseAnswer("解説文\n```json\n" + withCitation + "\n```\n余計な後書き");
  assert.equal(answer.verdict, "spec");
});

test("出典ゼロで spec と断定したら unknown に落とす", () => {
  const answer = parseAnswer(
    JSON.stringify({
      verdict: "spec",
      headline: "仕様どおりです",
      answerForCustomer: "問題ありません。",
      explanation: "たぶんそうです",
      citations: [],
      followUp: [],
    }),
  );
  assert.equal(answer.verdict, "unknown");
  assert.equal(answer.answerForCustomer, "", "顧客向け文面は消されること");
  assert.match(answer.explanation, /システム側で/);
});

test("出典ゼロで bug と断定した場合も unknown に落とす", () => {
  const answer = parseAnswer(
    JSON.stringify({ verdict: "bug", headline: "不具合です", answerForCustomer: "不具合です", citations: [] }),
  );
  assert.equal(answer.verdict, "unknown");
  assert.equal(answer.answerForCustomer, "");
});

test("引用が空文字だけの citation は出典として数えない", () => {
  const answer = parseAnswer(
    JSON.stringify({
      verdict: "spec",
      headline: "仕様どおりです",
      answerForCustomer: "問題ありません。",
      citations: [{ quote: "   ", file: "a.ts" }],
      followUp: [],
    }),
  );
  assert.equal(answer.verdict, "unknown", "空の引用で断定を通さないこと");
});

test("unknown なのに顧客向け文面が入っていたら捨てる", () => {
  const answer = parseAnswer(
    JSON.stringify({
      verdict: "unknown",
      headline: "判断できません",
      answerForCustomer: "たぶん大丈夫です",
      citations: [],
      followUp: [],
    }),
  );
  assert.equal(answer.answerForCustomer, "");
});

test("未知の verdict 文字列は unknown として扱う", () => {
  const answer = parseAnswer(
    JSON.stringify({ verdict: "probably-fine", headline: "", citations: [] }),
  );
  assert.equal(answer.verdict, "unknown");
});

test("JSON として読めない応答は例外にする", () => {
  assert.throws(() => parseAnswer("申し訳ありませんが回答できません"), /JSON/);
});

test("citations が配列でなくても落ちず、断定は通さない", () => {
  const answer = parseAnswer(
    JSON.stringify({ verdict: "spec", headline: "x", answerForCustomer: "y", citations: "なし" }),
  );
  assert.equal(answer.verdict, "unknown");
  assert.deepEqual(answer.citations, []);
});

test("資格情報が無ければ hasCredentials は false", () => {
  const saved = [process.env.ANTHROPIC_API_KEY, process.env.ANTHROPIC_AUTH_TOKEN];
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  try {
    assert.equal(hasCredentials(), false);

    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    assert.equal(hasCredentials(), true, "API キーがあれば true");

    delete process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_AUTH_TOKEN = "token";
    assert.equal(hasCredentials(), true, "AUTH_TOKEN でも true");

    process.env.ANTHROPIC_AUTH_TOKEN = "";
    assert.equal(hasCredentials(), false, "空文字は未設定として扱う");
  } finally {
    if (saved[0] === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved[0];
    if (saved[1] === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
    else process.env.ANTHROPIC_AUTH_TOKEN = saved[1];
  }
});
