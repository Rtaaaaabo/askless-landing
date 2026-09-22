/**
 * 接続情報の解決のテスト。
 *
 * ここを間違えると「変数は存在するのに読めない」状態になり、チャットが
 * 静かに 503 を返し続ける。原因が分かりにくいので固定しておく。
 *
 *   node --test --experimental-strip-types lib/limits.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isConfigured } from "./limits.ts";

const KEYS = [
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
] as const;

/** 関係する環境変数だけを差し替えて実行する */
function withEnv(env: Partial<Record<(typeof KEYS)[number], string>>, run: () => void): void {
  const saved = KEYS.map((key) => [key, process.env[key]] as const);
  for (const key of KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  try {
    run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("Vercel の Upstash 連携が作る KV_REST_API_* を読める", () => {
  withEnv({ KV_REST_API_URL: "https://x.upstash.io", KV_REST_API_TOKEN: "t" }, () => {
    assert.equal(isConfigured(), true);
  });
});

test("手で設定する UPSTASH_REDIS_REST_* でも読める", () => {
  withEnv({ UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" }, () => {
    assert.equal(isConfigured(), true);
  });
});

test("何も設定されていなければ false", () => {
  withEnv({}, () => {
    assert.equal(isConfigured(), false);
  });
});

test("URL だけ、トークンだけでは false", () => {
  withEnv({ KV_REST_API_URL: "https://x.upstash.io" }, () => {
    assert.equal(isConfigured(), false, "トークンが無い");
  });
  withEnv({ KV_REST_API_TOKEN: "t" }, () => {
    assert.equal(isConfigured(), false, "URL が無い");
  });
});

test("空文字は未設定として扱う", () => {
  withEnv({ KV_REST_API_URL: "", KV_REST_API_TOKEN: "" }, () => {
    assert.equal(isConfigured(), false);
  });
});

test("read-only トークンしか無い状態を設定済みと誤認しない", () => {
  // KV_REST_API_READ_ONLY_TOKEN は INCR できないので使わない。
  // 名前が似ているため、誤って拾っていないことを確かめる。
  const saved = process.env.KV_REST_API_READ_ONLY_TOKEN;
  process.env.KV_REST_API_READ_ONLY_TOKEN = "readonly";
  try {
    withEnv({ KV_REST_API_URL: "https://x.upstash.io" }, () => {
      assert.equal(isConfigured(), false);
    });
  } finally {
    if (saved === undefined) delete process.env.KV_REST_API_READ_ONLY_TOKEN;
    else process.env.KV_REST_API_READ_ONLY_TOKEN = saved;
  }
});
