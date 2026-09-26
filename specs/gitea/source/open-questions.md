# 開発者への確認事項

spec-bridge がコードから確定できず、推測で埋めずに残した点を種類ごとにまとめています（聞くべきこと 12 件・追加調査 7 件・範囲のメモ 3 件）。
前後の文脈は、見出しのリンク先の機能ドキュメントを参照してください。

## 聞くべきこと（12 件）

コードを探したうえで、意図・運用・外部システムの挙動など、人に確かめるしかない点です。各項目に、答えを探して開いたファイルを添えています。

### [Actions（CI/CDワークフロー）](features/actions-cicd.md)

📝 AI生成 · `go-gitea/gitea`

- [ ] リポジトリ単位の設定にスコープドワークフロー登録画面が無いのは意図的な仕様（組織/ユーザー/インスタンス単位でのみ運用する設計）か、それとも未実装か？（確認した箇所: `routers/web/web.go`, `routers/web/shared/actions/scoped_workflows.go`）
- [ ] サイト管理者向けのActions設定にSecrets管理画面が無いのは、インスタンス全体で共有される機密情報を意図的にサポート対象外としているためか？（確認した箇所: `routers/web/web.go`, `routers/web/repo/setting/secrets.go`）

### [認証(ログイン・2要素認証・OAuth/WebAuthn)](features/authentication-2fa-oauth.md)

📝 AI生成 · `go-gitea/gitea`

- [ ] 二要素認証を必須化(enforced)した場合の運用ルール(既存ユーザーの移行期間や猶予の有無)は仕様として定められているか、それとも管理者の裁量に委ねられているか。（確認した箇所: `modules/setting/security.go`, `services/context/context.go`）

### [Issue管理](features/issue-tracking.md)

📝 AI生成 · `go-gitea/gitea`

- [ ] 循環依存のチェックが直接の逆方向（1段階）しか見ていないのは意図的な仕様か、それとも間接的な循環（A→B→C→A）も本来検出すべき未実装のバグか？（確認した箇所: `models/issues/dependency.go`, `routers/web/repo/issue_dependency.go`）
- [ ] クロスリポジトリ依存関係の削除は `ALLOW_CROSS_REPOSITORY_DEPENDENCIES` が無効でも常に許可される非対称な仕様だが、これは「既存データを消せなくなる事故を防ぐ」意図での設計か？（確認した箇所: `routers/web/repo/issue_dependency.go`）
- [ ] MaxPinned（デフォルト3件）をリポジトリごとに変更できる管理画面や設定項目は現状存在しないが、将来リポジトリ単位で可変にする予定はあるか？（確認した箇所: `routers/web/repo/issue_pin.go`）

### [通知（Notifications）](features/notifications.md)

📝 AI生成 · `go-gitea/gitea`

- [ ] 通知のUpdatedByがコメントの投稿者やレビュアーではなく、実際にはシステム操作（自動マージ等）由来の場合、UI上の「誰からの通知か」の表示は何を根拠にしているか？（確認した箇所: `templates/user/notification/notification_div.tmpl`, `models/activities/notification.go`）
- [ ] メール通知（services/mailer側）は、アプリ内通知と同じイベントに対して同期的に送られるのか、それとも別経路・別条件で判定されるのか？（確認した箇所: `routers/web/user/setting/notifications.go`）

### [組織・チームと権限管理](features/organization-team-permission.md)

📝 AI生成 · `go-gitea/gitea`

- [ ] AnyRepoUnitMaxAccess のコード内コメントで指摘されている「あるリポジトリへのアクセス可否を別リポジトリのものと混同する」不正確さは、実際の権限判定（例えば組織トップページの閲覧可否表示など）にどの程度影響しているか、修正予定はあるか？（確認した箇所: `models/organization/team_list.go`）

### [プルリクエスト・コードレビュー](features/pull-request-review.md)

📝 AI生成 · `go-gitea/gitea`

- [ ] 承認ホワイトリストやマージホワイトリストにチームを登録した場合、そのチームが削除・改名されたときの既存ルールへの影響(自動的にクリーンアップされるか)はどう運用する想定か?（確認した箇所: `models/git/protected_branch.go`）
- [ ] 「手動マージ済みとしてマーク」機能や強制マージ(force merge)の利用状況を監査ログなどで追跡する運用は行っているか?（確認した箇所: `routers/web/repo/pull_merge_form.go`, `services/pull/check.go`）

### [リポジトリ作成・コード閲覧編集](features/repository-code.md)

📝 AI生成 · `go-gitea/gitea`

- [ ] 「フォークして編集」フローでの新規フォークのリポジトリ名は `getUniqueRepositoryName` で自動採番されるが、この自動生成された名前をユーザーが後から変更したい場合の想定動線はUI上どこにあるか(このドキュメントの範囲外の可能性)。（確認した箇所: `routers/web/repo/editor_util.go`, `routers/web/repo/editor_fork.go`）

## 追加で調べれば埋まる可能性があるもの（7 件）

コードを追えば分かるはずで、今回そこまで読めなかった点です。人に聞く前に、もう一度コードを当たってください。

### [Actions（CI/CDワークフロー）](features/actions-cicd.md)

📝 AI生成 · `go-gitea/gitea`

- [ ] Connect-RPCによるRunner登録エンドポイント（/api/actions配下）の正確なパス文字列と、Register以外にどのRPCメソッド（タスク取得・結果報告など）が公開されているか？

### [認証(ログイン・2要素認証・OAuth/WebAuthn)](features/authentication-2fa-oauth.md)

📝 AI生成 · `go-gitea/gitea`

- [ ] ユーザー設定の「アプリケーション」画面(OAuth2アプリの作成・編集ハンドラ、user_setting.OAuthApplicationsPost等)の詳細な承認フロー・スコープ制御はどうなっているか。ルーティングのみ確認し、ハンドラの実装ファイル(routers/web/user/setting配下)は未読のため。
- [ ] 管理画面の認証ソース管理(routers/web/web.goの/-/admin/auths、admin.Authentications等)でOAuth2/LDAP/SSPIそれぞれにどんな設定項目・バリデーションがあるか。ハンドラ実体(routers/web/admin配下)は未読のため詳細不明。
- [ ] SSPI(Windows統合認証)は具体的にどのような条件でIsSSPIEnabledがtrueになり、どのミドルウェアで自動ログインが行われるのか。auth.IsSSPIEnabledの呼び出しは確認したが、services/auth/source/sspi配下の実装までは読んでいない。
- [ ] TwoFactorAuthEnforced(2FA必須化)がAPI経由の全操作・全エンドポイントにどこまで及ぶのか(routers/api/v1/api.goのdoerNeedTwoFactorAuthの呼び出し箇所全体)は、api.go全体を読んでいないため未確認。

### [通知（Notifications）](features/notifications.md)

📝 AI生成 · `go-gitea/gitea`

- [ ] NotificationSourceCommit（コミット由来の通知）は現状どの操作から作られるか？ 今回追った services/uinotification/notify.go 内には該当する呼び出しが見つからなかった。

### [リポジトリ作成・コード閲覧編集](features/repository-code.md)

📝 AI生成 · `go-gitea/gitea`

- [ ] 移行(マイグレーション)対象として選べる外部サービスの一覧(GitHub/GitLab/Gitea/SVN/CodeCommitなど)は `structs.SupportedFullGitService` で決まっているが、各サービスごとに実際どの項目(Wiki/Issue/PR等)が取り込み可能かの詳細な対応表はコードから追い切れていない。サービスごとの対応項目の一覧はどこかにまとまっているか。

## ドキュメントの範囲についてのメモ（3 件）

機能ドキュメントの範囲についての相談です。ドキュメントを保守する人向けのメモです。

### [組織・チームと権限管理](features/organization-team-permission.md)

📝 AI生成 · `go-gitea/gitea`

- [ ] 組織設定の /org/{org}/worktime（Worktime）画面はこのドキュメントの対象範囲に含めるべきか、それとも別機能（工数管理）として扱うべきか？

### [プルリクエスト・コードレビュー](features/pull-request-review.md)

📝 AI生成 · `go-gitea/gitea`

- [ ] コードオーナー(CODEOWNERS)必須レビューのマッチングルールの詳細仕様(パターンの優先順位など)は、本ドキュメントとは別に独立したドキュメントとして扱うべきか?

### [リポジトリ作成・コード閲覧編集](features/repository-code.md)

📝 AI生成 · `go-gitea/gitea`

- [ ] リポジトリ設定画面(`/{username}/{reponame}/settings`)からの所有者移管の「開始」操作自体は今回読んだ範囲に含まれておらず、`repo_setting` パッケージ側にあると見られる。移管の開始をこのドキュメントに含めるべきか、別ドキュメント(リポジトリ設定)に任せるべきか。
