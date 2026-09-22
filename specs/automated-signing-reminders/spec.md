---
id: automated-signing-reminders
status: draft
owners: []
repos:
  - documenso/documenso
issueKeys: []
updatedAt: 2026-09-22
updatedByPRs:
  - documenso/documenso#3016
confidence: 0.88
---

# 署名依頼の自動リマインダー

未署名の受信者に対し、一定期間ごとに自動でリマインダーメールを送る機能。1人の受信者に送れる自動リマインダーの回数には上限があり、上限に達すると自動送信は止まるが、送信者が手動で「再送信」すると回数はリセットされ再び自動送信されるようになる。

## 概要

書類の署名を依頼したのに相手がなかなか署名してくれない場合、Documenso は自動的に「リマインダー（催促）メール」を送ることができます。いつ最初のリマインダーを送るか、その後どのくらいの間隔で繰り返すかは、書類ごと・チームごと・組織ごとに設定できます。

今回の変更で追加されたのは「送りすぎ防止」の仕組みです。同じ受信者に対して自動リマインダーを送れる回数には上限（既定で5回）があり、これに達すると、たとえ書類がまだ有効期限内で未署名であっても、それ以上自動ではリマインダーが送られなくなります。

ただし、送信者（書類のオーナーやチームメンバー）が管理画面から手動で「リマインダーを送る（再送信）」を行うと、そのときにリマインダーの送信回数はゼロに戻り、そこからまた自動リマインダーのカウントが始まります。つまり、自動送信が止まってしまった相手でも、担当者が一度手動で背中を押せば、また自動リマインダーの対象に戻ります。

## ユーザーから見た振る舞い

- 書類を送付すると、受信者が署名するまで、設定した間隔で自動的にリマインダーメールが送られる。
- 同じ受信者への自動リマインダーは、最大5回送られるとそれ以降は自動では送られなくなる（書類の有効期限が残っていても)。
- 送信者が書類の管理画面から『再送信（リマインダーを送る）』を手動で行うと、その受信者宛てのメールがすぐに送られ、以降の自動リマインダーのカウントは0から数え直される。つまり手動再送信をすれば、上限に達していた受信者にも自動リマインダーが再び送られるようになる。
- この上限や自動リマインダーの間隔設定は画面上には表示されない。CS/サポート側が『5回目のリマインダー以降届いていない』という問い合わせを受けた場合、まずは上限（既定5回）に達していないか、直近で手動再送信が行われたかを確認する。
- CCとして追加された人や、既に署名済みの人にはリマインダー（自動・手動とも）は送られない。
- 受信者が期限切れ（有効期限を過ぎている）の場合、自動リマインダーは送られない。

## 画面

| 画面 | パス | リポジトリ | 説明 |
| --- | --- | --- | --- |
| 書類の再送信ダイアログ（Resend Document） | `/t/:teamUrl (書類詳細画面のアクションメニューから開くダイアログ)` | `documenso/documenso` | 未署名の受信者を選んで手動でリマインダーメールを再送信するダイアログ。送信すると対象受信者の自動リマインダー回数がリセットされる。 |
| リマインダー設定（書類/テンプレート編集画面、チーム設定、組織設定） | `/t/:teamUrl/settings/document, /o/:orgUrl/settings/document など` | `documenso/documenso` | 最初のリマインダーを送るまでの日数（sendAfter）と、その後の繰り返し間隔（repeatEvery）を設定するUI。今回の上限回数（5回）はこの画面には表示されず、コード上の固定値。 |

## エンドポイント

| メソッド | パス | リポジトリ | 説明 |
| --- | --- | --- | --- |
| POST | `envelope.redistribute (tRPC)` | `documenso/documenso` | 受信者を指定して書類を手動で再送信するtRPCミューテーション。内部で resendDocument を呼び出し、対象受信者の自動リマインダー回数をリセットする。 |
| POST | `document.redistribute (tRPC)` | `documenso/documenso` | 書類の手動再送信用tRPCミューテーション（envelope版のラッパー）。resendDocument を呼び出す。 |
| POST | `/api/v1/documents/:id/resend` | `documenso/documenso` | 公開API v1の書類再送信エンドポイント（非推奨扱い）。同じく resendDocument を呼び出すため、手動再送信によるリマインダー回数リセットが適用される。 |
| INTERNAL JOB | `process-signing-reminder` | `documenso/documenso` | 自動リマインダーを実際に送信する内部ジョブ。送信対象になった受信者の reminderCount を1つ増やしてから送信する。 |

## 権限・ロール

| ロール | できること | 出典 |
| --- | --- | --- |
| 書類のオーナー / 所属チームメンバー（アカウントが無効化されていないこと） | 書類の再送信（手動リマインダー送信、自動リマインダー回数のリセットを含む）ができる。アカウントが無効化されている場合は再送信も自動リマインダーもできない。 | [^1][^2] |
| CCとして追加された受信者 | 署名アクションが不要なため、自動リマインダーも手動再送信の対象にもならない。 | [^3][^4] |

## 仕様の詳細

- 1人の受信者に対して自動送信できるリマインダーの最大回数は5回（MAX_REMINDERS_BEFORE_RESEND）。この回数に達すると、resolveNextReminderAt は null を返し、それ以上自動リマインダーの予定は組まれない。[^5][^6]
- 自動リマインダー送信ジョブは、受信者を『claim』する際（対象条件に一致するレコードを原子的に更新する際）に reminderCount を1つ増やす。この増加後の値をもとに次回リマインダーの要否を判定するため、5回目のリマインダー送信時点で次回のスケジュールは組まれなくなる。[^7][^8]
- 自動リマインダーが停止する条件は2つあり、どちらか一方でも満たせば停止する：(1) 最初の送付（sentAt）から MAX_REMINDER_WINDOW_DAYS（30日）を超えた場合、(2) 送信済みリマインダー回数が MAX_REMINDERS_BEFORE_RESEND（5回）に達した場合。[^9]
- 送信者が『再送信（redistribute/resend）』を手動で行うと、対象受信者の nextReminderAt を再計算する際に reminderCount を明示的に0へリセットし（resetReminderCount: true）、DBの reminderCount 列も0に更新する。これにより自動リマインダー上限に達していた受信者も再び自動送信の対象になる。[^10][^11]
- 手動再送信は、対象受信者の sentAt（自動リマインダーの起算日）を再送信時刻に置き換え、lastReminderSentAt を null に戻す。つまり自動リマインダーの30日ウィンドウや『最初のリマインダーまでの日数』の計算も、再送信時点から改めてやり直される。[^12]
- reminderCount は Recipient テーブルの新しいカラムで、既定値は0。マイグレーション追加によりDBスキーマが変更されている。[^13][^14]
- 書類レベルのリマインダー設定（sendAfter / repeatEvery、または組織・チームからの継承）が変更された場合は recomputeNextReminderForEnvelope が全受信者の nextReminderAt を再計算するが、この際も既存の reminderCount（受信者ごとに保持されている送信済み回数）を考慮したうえで上限判定を行う（設定変更だけでは回数はリセットされない）。[^15][^16]
- 自動リマインダーは、書類の配布方法が手動（メールを送らないリンク共有方式）の場合や、書類のメール送信設定でリクエストメールが無効の場合、送信者アカウントが無効化されている場合、組織のメール送信数上限に達している場合は送られない（この挙動自体は今回のPRの変更ではなく既存仕様）。[^17][^18][^2][^19]

## 制約・既知の制限

- 自動リマインダーの上限回数（5回）と最大送信期間（30日）は、コード上の固定値（MAX_REMINDERS_BEFORE_RESEND, MAX_REMINDER_WINDOW_DAYS）であり、管理画面から変更することはできない。
- 手動再送信によるリマインダー回数リセットは、受信者ごとの reminderCount のみを対象とする。書類の有効期限（expiresAt）は別ロジックで再送信時に延長されるが、これは本PRの変更範囲外の既存挙動。
- 上限に達して自動リマインダーが止まっていることを示すUI表示は現状存在しない（コード上のみで判定される）。

## テスト観点

### 正常系

- 受信者に4回まで自動リマインダーが送られたあと、5回目が送られると reminderCount が5になり、以降は自動リマインダーが送られないことを確認する。
- 自動リマインダー上限に達した受信者に対し、送信者が手動で『再送信』を行うと即座にメールが届き、以降また自動リマインダーの間隔設定に従って送信が再開されることを確認する。
- 手動再送信を行った受信者の reminderCount がDB上で0にリセットされていることを確認する。

### 異常系

- 署名済みの受信者やCC受信者に対しては、手動再送信・自動リマインダーどちらも送られないことを確認する。
- 書類の有効期限が切れている受信者には自動リマインダーが送られないことを確認する（reminderCountの上限とは独立した既存ガード）。
- 組織のメール送信数上限に達している状態で自動リマインダーが送信対象になった場合、reminderCount が増えずにスキップされる（レート制限の判定順序）ことを確認する。

### 回帰テスト対象

- リマインダー設定（sendAfter / repeatEvery）を変更したときの nextReminderAt 再計算（recomputeNextReminderForEnvelope）が、既存の reminderCount を壊さず正しく反映されるか。
- 手動再送信時に、これまで通り受信者の有効期限（expiresAt）延長が正しく行われるか（本PRでコメント整理のみで挙動は変更していないはずだが、reminderCountリセット処理の追加と合わせてデグレしていないか）。
- 自動リマインダーが一度も送られていない（sentAtのみでlastReminderSentAtがnull）受信者について、sendAfter の初回リマインダー計算が従来通り機能するか（reminderCount=0が前提として渡っているか）。
- Webhook（DOCUMENT_REMINDER_SENT）が自動送信・手動再送信それぞれで従来通り発火するか。
- 監査ログ（DocumentAuditLog, EMAIL_SENT/isResending）が自動リマインダーと手動再送信で従来通り正しく記録されるか。

### E2E シナリオ

#### 自動リマインダーが上限回数で停止し、手動再送信で再開する

1. リマインダー間隔を短く設定した書類を作成し、未署名の受信者に送付する。
2. 自動リマインダージョブを5回分実行させる（または reminderCount を5に到達させる）。
3. 6回目のリマインダーが自動送信されないことを確認する。
4. 書類詳細画面から対象受信者を選んで『再送信』を手動実行する。
5. 手動再送信メールが届き、reminderCount が0にリセットされていることを確認する。
6. その後、再び自動リマインダージョブを実行し、送信が再開されることを確認する。

**期待結果**: 5回の自動リマインダー後は自動送信が止まるが、手動再送信を行うとカウントがリセットされ、自動リマインダーが再開される。

## 用語

| 用語 | 別の呼ばれ方 | コード上の名前 |
| --- | --- | --- |
| 自動リマインダー | リマインダーメール / 催促メール / 自動催促 | `process-signing-reminder / resolveNextReminderAt` |
| 手動再送信 | 再送信 / リマインダーを送る / Resend | `resendDocument / envelope.redistribute` |
| リマインダー送信回数上限 | 5回制限 / リマインダー上限 | `MAX_REMINDERS_BEFORE_RESEND` |
| リマインダー送信可能期間 | 30日ウィンドウ | `MAX_REMINDER_WINDOW_DAYS` |

## 開発者への確認事項

- [ ] MAX_REMINDERS_BEFORE_RESEND（既定5回）は現状コード上の固定値だが、将来的に組織/チーム/書類単位で変更可能にする予定があるか開発に確認が必要。
- [ ] 上限到達により自動リマインダーが停止していることを、CSやユーザーが管理画面上で識別する手段（表示・通知）が今後追加される予定か不明。
- [ ] reminderCount が5に達した状態で書類のリマインダー設定（sendAfter/repeatEvery）だけを変更した場合、自動送信は再開されない（reminderCountのリセットは手動再送信でのみ発生）という理解で正しいか、意図した仕様か開発に確認したい。

## 変更履歴

| 日付 | 変更内容 | PR |
| --- | --- | --- |
| 2026-06-23 | 「署名依頼の自動リマインダー」機能のドキュメントを新規作成。PR #3016 により、自動リマインダーは受信者ごとに最大5回で送信を停止し、送信者が手動で「再送信（リマインダーを送る）」を行うと回数がリセットされて自動リマインダーが再び送られるようになる仕様を反映した。 | `documenso/documenso#3016` |

## 出典

[^1]: `documenso/documenso` `packages/lib/server-only/document/resend-document.ts:61` (documenso/documenso#3016)
[^2]: `documenso/documenso` `packages/lib/jobs/definitions/internal/process-signing-reminder.handler.ts:126` (documenso/documenso#3016)
[^3]: `documenso/documenso` `packages/lib/jobs/definitions/internal/process-signing-reminder.handler.ts:45` (documenso/documenso#3016)
[^4]: `documenso/documenso` `packages/lib/server-only/document/resend-document.ts:128` (documenso/documenso#3016)
[^5]: `documenso/documenso` `packages/lib/constants/envelope-reminder.ts:43` (documenso/documenso#3016)
[^6]: `documenso/documenso` `packages/lib/constants/envelope-reminder.ts:81` (documenso/documenso#3016)
[^7]: `documenso/documenso` `packages/lib/jobs/definitions/internal/process-signing-reminder.handler.ts:55` (documenso/documenso#3016)
[^8]: `documenso/documenso` `packages/lib/jobs/definitions/internal/process-signing-reminder.handler.ts:247` (documenso/documenso#3016)
[^9]: `documenso/documenso` `packages/lib/constants/envelope-reminder.ts:62` (documenso/documenso#3016)
[^10]: `documenso/documenso` `packages/lib/server-only/document/resend-document.ts:145` (documenso/documenso#3016)
[^11]: `documenso/documenso` `packages/lib/server-only/recipient/update-recipient-next-reminder.ts:41` (documenso/documenso#3016)
[^12]: `documenso/documenso` `packages/lib/server-only/document/resend-document.ts:147` (documenso/documenso#3016)
[^13]: `documenso/documenso` `packages/prisma/schema.prisma:645` (documenso/documenso#3016)
[^14]: `documenso/documenso` `packages/prisma/migrations/20260622120000_add_recipient_reminder_count/migration.sql` (documenso/documenso#3016)
[^15]: `documenso/documenso` `packages/lib/server-only/recipient/update-recipient-next-reminder.ts:87` (documenso/documenso#3016)
[^16]: `documenso/documenso` `packages/lib/server-only/recipient/update-recipient-next-reminder.ts:100` (documenso/documenso#3016)
[^17]: `documenso/documenso` `packages/lib/jobs/definitions/internal/process-signing-reminder.handler.ts:95` (documenso/documenso#3016)
[^18]: `documenso/documenso` `packages/lib/jobs/definitions/internal/process-signing-reminder.handler.ts:100` (documenso/documenso#3016)
[^19]: `documenso/documenso` `packages/lib/jobs/definitions/internal/process-signing-reminder.handler.ts:165` (documenso/documenso#3016)
