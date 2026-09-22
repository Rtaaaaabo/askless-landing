/**
 * 公開デモのレート制限。
 *
 * Vercel の関数はステートレスなので、カウンタは Upstash Redis（REST）に置く。
 * ここで数えるのは「何回呼ばれたか」だけで、質問文も回答も保存しない。
 *
 * 課金の最終的な歯止めは Anthropic 側の spend limit に持たせている。
 * こちらのカウンタは「あと何問か」を利用者に見せるためのもので、
 * ここにバグがあっても課金が伸び続けないようにするのが二重化の狙い。
 */

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

/** 同一 IP が1日に投げられる質問数 */
export const PER_IP_PER_DAY = Number(process.env.DEMO_PER_IP_PER_DAY ?? 10);

/** サイト全体で1か月に許す質問数 */
export const PER_MONTH = Number(process.env.DEMO_PER_MONTH ?? 2000);

export interface LimitState {
  allowed: boolean;
  /** その IP の本日の残り回数 */
  remainingToday: number;
  /** 拒否された理由。allowed が true なら null */
  reason: "ip-daily" | "site-monthly" | null;
}

/** Upstash が未設定なら制限をかけられない。事故防止のため、その場合は止める。 */
export function isConfigured(): boolean {
  return Boolean(URL && TOKEN);
}

/**
 * Upstash の REST API をパイプラインで一度に叩く。
 * コマンドは [["INCR","k"],["EXPIRE","k","60"]] の形。
 */
async function pipeline(commands: string[][]): Promise<unknown[]> {
  const res = await fetch(`${URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    throw new Error(`Upstash ${res.status}: ${await res.text()}`);
  }

  const body = (await res.json()) as Array<{ result?: unknown; error?: string }>;
  const failed = body.find((entry) => entry.error);
  if (failed) throw new Error(`Upstash command failed: ${failed.error}`);
  return body.map((entry) => entry.result);
}

/** UTC 基準の日付キー。デモなので厳密なタイムゾーン合わせはしない。 */
function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function monthKey(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/**
 * 1問ぶん消費する。上限に達していれば allowed:false を返す。
 *
 * INCR してから判定するので、同時アクセスでも上限を超えて通ることはない。
 * 超過時に DECR して戻すことはしない（戻すと連打で上限を回避できてしまう）。
 */
export async function consume(ip: string): Promise<LimitState> {
  const now = new Date();
  const ipKey = `demo:ip:${dayKey(now)}:${ip}`;
  const siteKey = `demo:site:${monthKey(now)}`;

  const [ipCount, , siteCount] = (await pipeline([
    ["INCR", ipKey],
    // 48時間で落とす。日付キーなので余裕を持たせておけば足りる。
    ["EXPIRE", ipKey, "172800"],
    ["INCR", siteKey],
    ["EXPIRE", siteKey, "5356800"], // 62日
  ])) as [number, unknown, number, unknown];

  if (siteCount > PER_MONTH) {
    return { allowed: false, remainingToday: 0, reason: "site-monthly" };
  }

  if (ipCount > PER_IP_PER_DAY) {
    return { allowed: false, remainingToday: 0, reason: "ip-daily" };
  }

  return {
    allowed: true,
    remainingToday: Math.max(0, PER_IP_PER_DAY - ipCount),
    reason: null,
  };
}

/**
 * リクエスト元の IP を取る。
 *
 * Vercel は x-forwarded-for の「左端」にクライアント IP を入れる。
 * 左端はクライアントが詐称できるが、Vercel がエッジで付け直すため
 * このプラットフォーム上では信頼してよい。自前のプロキシを挟む構成に
 * 変える場合はここを見直すこと。
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
