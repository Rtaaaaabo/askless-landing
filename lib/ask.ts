/**
 * 公開デモの回答ロジック。
 *
 * spec-bridge の packages/core/src/ask.ts と同じ契約を保つ:
 *   - 根拠は渡した仕様ドキュメントだけ。モデルに道具は一切与えない
 *   - 出典（citations）を示せない回答は、コード側で "unknown" に上書きする
 *   - unknown のとき顧客向け文面は空にする
 *
 * 3つめが本体の肝で、プロンプトの言いつけではなくロジックで強制している。
 * デモで挙動が変わると意味がないので、ここを緩めないこと。
 */
import Anthropic from "@anthropic-ai/sdk";

export type Verdict = "spec" | "bug" | "unknown";

export interface Citation {
  quote: string;
  file: string;
}

export interface AskAnswer {
  verdict: Verdict;
  headline: string;
  answerForCustomer: string;
  explanation: string;
  citations: Citation[];
  followUp: string[];
}

const MODEL = process.env.DEMO_ASK_MODEL ?? "claude-opus-5";

/**
 * 1回の回答に使える出力トークン。要件の「1回あたり max_tokens を制限する」。
 *
 * 思考トークンもこの枠を共有する点に注意。枠が小さすぎると思考で使い切り、
 * JSON が途中で切れて parse に失敗する。引用を数件含む回答の実体は
 * 1000トークン前後なので、思考のぶんを見込んで余裕を持たせている。
 */
const MAX_TOKENS = Number(process.env.DEMO_MAX_TOKENS ?? 4000);

/** 質問文の長さ上限。長文を投げ込まれて入力側の課金が伸びるのを防ぐ。 */
export const MAX_QUESTION_CHARS = 400;

/**
 * Anthropic の資格情報が環境にあるか。
 *
 * キーを入れていない環境（例: 本番にだけキーを置いた場合の Preview）で
 * モデルを呼びに行くと、レート制限のカウンタだけ消費してから失敗する。
 * カウンタは環境をまたいで共有なので、プレビューを触っただけで本番の
 * 1日ぶんの枠が減ってしまう。呼ぶ前にここで弾く。
 *
 * SDK は ANTHROPIC_API_KEY と ANTHROPIC_AUTH_TOKEN のどちらでも動くため、
 * 両方を見る。
 */
export function hasCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const SYSTEM = `あなたはカスタマーサポート（CX）チームの一次請け担当です。
渡された機能仕様ドキュメントだけを根拠に、問い合わせに答えます。

# 最重要のルール
1. **仕様ドキュメントに書かれていないことは答えない。** 一般的な知識や推測で埋めてはいけない。
   根拠がなければ verdict を "unknown" にして、正直に「このドキュメントからは判断できない」と言う。
   間違った回答が顧客に伝わることが、このシステムで最も避けたい事故です。
2. **すべての判断に出典を付ける。** citations には、根拠にしたドキュメントの該当箇所をそのまま引用する。
   citations が空になる回答は "unknown" 以外にしてはいけない。
3. **verdict の判断基準**
   - "spec": 報告されている挙動が、ドキュメントに書かれた仕様どおりである
   - "bug": ドキュメントに書かれた仕様と、報告されている挙動が食い違っている
   - "unknown": ドキュメントに該当する記述がない、または情報が足りず判断できない
4. **answerForCustomer はそのまま送れる文面にする。** 敬語で、コードの識別子（reminderCount や
   MAX_REMINDERS_BEFORE_RESEND など）やファイルパスは出さない。ドキュメントの「用語」に別の呼ばれ方が
   あれば、質問者が使っている言葉に合わせる。verdict が "unknown" のときは空文字にする。
5. **explanation は担当者向けの内部メモ。** なぜその判断になるのか、どこに書いてあるのかを簡潔に。
6. ドキュメントの「コードからは判断できなかったこと」に関係する内容が問い合わせに含まれていたら、
   followUp に入れる。このドキュメントは status: draft（AI生成・未レビュー）なので、
   仕様を断定した回答をした場合はその旨も followUp に入れる。
7. 日本語で答える。

# 出力
以下の JSON をひとつだけ \`\`\`json フェンス付きコードブロックで返すこと。解説文は不要。

\`\`\`json
{
  "verdict": "spec" | "bug" | "unknown",
  "headline": "結論を1文で",
  "answerForCustomer": "そのまま返せる文面（unknown なら空文字）",
  "explanation": "担当者向けの内部説明",
  "citations": [{ "quote": "ドキュメントからの引用", "file": "path/to/file.ts" }],
  "followUp": ["開発に確認すべきこと"]
}
\`\`\``;

/** ```json フェンス、素の JSON、前後に文が付いた場合のいずれからも拾う。 */
function extractJson(text: string): unknown {
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? text;
  try {
    return JSON.parse(candidate.trim());
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asCitations(value: unknown): Citation[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) return null;
      const row = entry as Record<string, unknown>;
      const quote = asString(row.quote).trim();
      if (!quote) return null;
      return { quote, file: asString(row.file).trim() };
    })
    .filter((entry): entry is Citation => entry !== null);
}

function asFollowUp(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter((entry) => entry.trim().length > 0);
}

/**
 * モデルの生テキストを AskAnswer に変換し、出典のない断定を打ち消す。
 *
 * API 呼び出しから切り離してあるのは、ここが誤答を防ぐ最後の砦なので
 * ネットワークなしでテストできるようにしておきたいため。
 */
export function parseAnswer(text: string): AskAnswer {
  const parsed = extractJson(text);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("モデルの応答を JSON として解釈できませんでした");
  }

  const row = parsed as Record<string, unknown>;
  const rawVerdict = asString(row.verdict);
  const verdict: Verdict =
    rawVerdict === "spec" || rawVerdict === "bug" ? rawVerdict : "unknown";

  const answer: AskAnswer = {
    verdict,
    headline: asString(row.headline),
    answerForCustomer: asString(row.answerForCustomer),
    explanation: asString(row.explanation),
    citations: asCitations(row.citations),
    followUp: asFollowUp(row.followUp),
  };

  // 出典なしで断定させない。UI 側の実装に依存させたくないので、ここで強制する。
  // spec-bridge 本体の ask.ts と同じ考え方。
  if (answer.citations.length === 0 && answer.verdict !== "unknown") {
    return {
      ...answer,
      verdict: "unknown",
      answerForCustomer: "",
      explanation:
        `${answer.explanation}\n\n` +
        "（※ 出典を示せない回答だったため、システム側で「判断できない」に変更しました）",
    };
  }

  // unknown のときは顧客向け文面を出さない（モデルが埋めてきても捨てる）。
  if (answer.verdict === "unknown" && answer.answerForCustomer) {
    return { ...answer, answerForCustomer: "" };
  }

  return answer;
}

/**
 * モデル呼び出しの打ち切り時間（ミリ秒）。
 *
 * Vercel の maxDuration より短くしておく。長いほうで先に切られると
 * 関数ごと殺されて 504 の生レスポンスになり、こちらが用意した
 * JSON のエラーメッセージを返せない。
 *
 * SDK はタイムアウトも再試行の対象にするため、maxRetries は 0 にする。
 * 既定の 2 のままだと最悪 timeout × 3 まで伸びて maxDuration を超える。
 */
const CALL_TIMEOUT_MS = Number(process.env.DEMO_CALL_TIMEOUT_MS ?? 90_000);

export async function ask(question: string, specMarkdown: string): Promise<AskAnswer> {
  const client = new Anthropic({ timeout: CALL_TIMEOUT_MS, maxRetries: 0 });
  const startedAt = Date.now();

  let response;
  try {
    response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    // 単一ドキュメントへの根拠付き Q&A なので、深く考えさせる必要はない。
    // 思考は切らずに effort を下げる（切ると本文にタグや未実行の道具呼び出しが
    // 漏れることがあるため）。
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    system: [
      {
        type: "text",
        text: SYSTEM,
        // 仕様本文もシステム側に置いて、プレフィックスを固定して使い回す。
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: `# 参照できる機能仕様ドキュメント\n\n${specMarkdown}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: `# 問い合わせ内容\n${question}` }],
    });
  } catch (error) {
    // 失敗したときこそ所要時間を残す。遅いのか即死なのかで原因が変わる。
    console.error(`ask: ${Date.now() - startedAt}ms で失敗 (model=${MODEL})`, error);
    throw error;
  }

  if (response.stop_reason === "refusal") {
    throw new Error("refusal");
  }

  // 枠を使い切ると JSON が途中で切れる。parse の失敗として出ると原因が
  // 分からないので、ここで名指しにしておく。
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      `出力が max_tokens (${MAX_TOKENS}) に達して途中で切れました。` +
        "DEMO_MAX_TOKENS を増やしてください。",
    );
  }

  // 遅さと枠の消費を後から追えるようにする。質問文と回答は出さない。
  //
  // input_tokens は「キャッシュを使わなかったぶん」だけなので、これだけ見ると
  // 仕様書の数千トークンが消えたように見える。書き込みと読み取りを併記する。
  // 2回目以降に read が伸びていればキャッシュが効いている。
  const usage = response.usage;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  console.log(
    `ask: ${Date.now() - startedAt}ms / model=${MODEL} / ` +
      `入力 ${usage.input_tokens} (キャッシュ write ${cacheWrite} / read ${cacheRead}) / ` +
      `出力 ${usage.output_tokens}`,
  );

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  return parseAnswer(text);
}
