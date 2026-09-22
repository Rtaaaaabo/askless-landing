# askless-landing

Askless の LP と、公開デモの仕様ページ。

| パス | 中身 |
| --- | --- |
| `index.html` | LP（静的） |
| `specs/<spec-id>/index.html` | 公開デモの仕様ページ（静的） |
| `specs/<spec-id>/spec.md` | 同じ仕様の Markdown。チャットの回答根拠に使う |
| `api/ask.ts` | チャット API（Vercel Serverless Function） |
| `lib/ask.ts` | 回答ロジック。出典のない断定を打ち消す |
| `lib/limits.ts` | レート制限（Upstash Redis） |

仕様ページ本体は静的なので、チャットが止まっていても閲覧は常にできる。

## 開発

```bash
npm install
npm test        # 回答ロジックのテスト。LLM は呼ばない
npm run typecheck
```

`npm test` は「出典を示せない回答を unknown に落とす」ガードを検証する。
ここが壊れると根拠のない断定が公開ページから出てしまうので、緩めないこと。

## デプロイ前に必要な設定

### 1. Anthropic API キー

Vercel のプロジェクト設定 → Environment Variables に追加する。

| 変数 | 値 |
| --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic コンソールで発行したキー |

**あわせて、Anthropic コンソール側でそのキーに月間の spend limit を設定する。**
アプリ側のカウンタにバグがあっても課金が止まるようにするための二重化で、
要件の「上限到達で課金が伸び続けない」はこれで担保している。

### 2. Upstash Redis

Vercel の Marketplace から Upstash for Redis を追加すると、次の2つが
プロジェクトの環境変数に自動で入る。

| 変数 | 用途 |
| --- | --- |
| `KV_REST_API_URL` | レート制限のカウンタ |
| `KV_REST_API_TOKEN` | 同上 |

**連携が作る名前は `KV_REST_API_*` で、Upstash 自身のドキュメントに出てくる
`UPSTASH_REDIS_REST_*` ではない。** コードは両方を見るので、連携で入れても
手で設定してもよい。

`KV_REST_API_READ_ONLY_TOKEN` も一緒に作られるが、こちらは使わない。
カウンタの `INCR` に書き込み権限が要るため。

連携時の Custom Prefix は空のままにすること。プレフィックスを付けると
変数名が変わり、存在するのに読めない状態になる。

**この2つが未設定だとチャットは 503 を返して動かない。** 制限をかけられない
状態で LLM を呼ぶと青天井に課金され得るため、意図的にそうしている。

保存するのは呼び出し回数だけで、質問文も回答も保存しない。

### 環境ごとの設定について

`ANTHROPIC_API_KEY` を Production だけに置く構成でも動く。その場合、
Preview ではチャットが 503 を返すだけで、仕様ページの閲覧は普通にできる。

**レート制限のカウンタは環境をまたいで共有される**（同じ Upstash を見るため）。
キーの無い環境でモデルを呼びに行くとカウンタだけ消費して失敗するので、
呼ぶ前に資格情報の有無を確認して弾いている。プレビューを触っても本番の
1日ぶんの枠は減らない。

プレビューでもチャットを動かしたいなら、`ANTHROPIC_API_KEY` を Preview にも
追加する（枠は本番と共有になる点に注意）。

### 3. 任意の調整

| 変数 | 既定 | 用途 |
| --- | --- | --- |
| `DEMO_PER_IP_PER_DAY` | `10` | 同一 IP の1日あたり質問数 |
| `DEMO_PER_MONTH` | `2000` | サイト全体の月間質問数 |
| `DEMO_MAX_TOKENS` | `2000` | 1回の回答の出力トークン上限 |
| `DEMO_ASK_MODEL` | `claude-opus-5` | 使用モデル |

## 仕様を追加・差し替えるとき

1. spec-bridge で生成した Markdown を `specs/<spec-id>/spec.md` に置く
2. `api/ask.ts` の `SPECS` に `<spec-id>` を追加する（ここに無い id は受け付けない）
3. 表示用の `specs/<spec-id>/index.html` を用意する

生成物に手を入れないこと。表示上の都合は HTML 側で吸収する。

再生成の手順は spec-bridge 側の `regenerate.md` を参照。
