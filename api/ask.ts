/**
 * 公開デモのチャット API。
 *
 * 要件上の制約をここで全部受ける:
 *   - Anthropic の API キーはこの関数の中だけで使い、レスポンスには一切出さない
 *   - 同一 IP から1日10問 / サイト全体で月間上限
 *   - 1回あたりの max_tokens を制限（lib/ask.ts 側）
 *   - 上限に達してもページの閲覧は落ちない（このAPIが 429 を返すだけ）
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { ask, hasCredentials, MAX_QUESTION_CHARS } from "../lib/ask.js";
import { clientIp, consume, isConfigured, PER_IP_PER_DAY } from "../lib/limits.js";

export const config = { runtime: "nodejs" };

/** 公開するのは1件だけ。ここに無い id は受け付けない。 */
const SPECS: Record<string, string> = {
  "automated-signing-reminders": "specs/automated-signing-reminders/spec.md",
};

/** 起動時に一度だけ読む。関数インスタンスが使い回される間は再読み込みしない。 */
const cache = new Map<string, string>();

function loadSpec(id: string): string | null {
  const rel = SPECS[id];
  if (!rel) return null;
  const cached = cache.get(id);
  if (cached) return cached;
  const markdown = readFileSync(join(process.cwd(), rel), "utf8");
  cache.set(id, markdown);
  return markdown;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  // 動かせない設定なら、カウンタを消費する前にここで止める。
  // カウンタは環境をまたいで共有なので、キーの無い環境（Preview など）で
  // 消費してしまうと本番の枠が減る。
  const missing: string[] = [];
  // 制限をかけられない状態で動かすと、青天井で課金され得る。
  if (!isConfigured()) missing.push("Upstash");
  if (!hasCredentials()) missing.push("Anthropic の資格情報");

  if (missing.length > 0) {
    console.error(`${missing.join(" と ")} が未設定のためチャットを停止しています`);
    return json({ error: "unavailable", message: "チャットは現在ご利用いただけません。" }, 503);
  }

  let payload: { question?: unknown; specId?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ error: "bad_request", message: "リクエストを解釈できませんでした。" }, 400);
  }

  const question = typeof payload.question === "string" ? payload.question.trim() : "";
  const specId = typeof payload.specId === "string" ? payload.specId : "";

  if (!question) {
    return json({ error: "bad_request", message: "質問を入力してください。" }, 400);
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return json(
      {
        error: "question_too_long",
        message: `質問は${MAX_QUESTION_CHARS}文字以内で入力してください。`,
      },
      400,
    );
  }

  const spec = loadSpec(specId);
  if (!spec) {
    return json({ error: "not_found", message: "対象の仕様が見つかりません。" }, 404);
  }

  // 上限の判定はモデルを呼ぶ前に行う。呼んでから弾いても課金は発生してしまう。
  let limit;
  try {
    limit = await consume(clientIp(request.headers));
  } catch (error) {
    console.error("レート制限の判定に失敗しました", error);
    return json({ error: "unavailable", message: "チャットは現在ご利用いただけません。" }, 503);
  }

  if (!limit.allowed) {
    return json(
      {
        error: limit.reason === "site-monthly" ? "site_limit" : "ip_limit",
        message:
          limit.reason === "site-monthly"
            ? "デモの今月分の上限に達しました。仕様の閲覧は引き続きご利用いただけます。"
            : `1日にお試しいただける質問は${PER_IP_PER_DAY}問までです。明日またお試しください。`,
      },
      429,
    );
  }

  try {
    const answer = await ask(question, spec);
    return json({ ...answer, remainingToday: limit.remainingToday }, 200);
  } catch (error) {
    // 詳細はログに残し、クライアントには返さない（内部情報とキーの保護）。
    console.error("回答の生成に失敗しました", error);

    if (error instanceof Anthropic.RateLimitError) {
      return json({ error: "busy", message: "混み合っています。少し時間をおいてお試しください。" }, 503);
    }
    // spend limit 超過や請求の問題はここに来る。静的な文面に切り替える。
    if (error instanceof Anthropic.APIError && (error.status === 400 || error.status === 403)) {
      return json(
        { error: "unavailable", message: "デモの利用上限に達しました。仕様の閲覧は引き続きご利用いただけます。" },
        503,
      );
    }
    return json({ error: "internal", message: "回答の生成に失敗しました。" }, 500);
  }
}
