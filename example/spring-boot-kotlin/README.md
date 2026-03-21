# Spring Boot + Kotlin Demo

Kotlin で書かれた Spring Boot REST API アプリケーションです。多言語対応の挨拶メッセージを管理する API を提供します。

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/greetings` | 全ての挨拶を取得 |
| GET | `/api/greetings/{id}` | ID で挨拶を取得 |
| POST | `/api/greetings` | 新しい挨拶を作成 |
| DELETE | `/api/greetings/{id}` | 挨拶を削除 |

### POST リクエスト例

```json
{
  "name": "Taro",
  "language": "ja"
}
```

対応言語: `en`, `ja`, `fr`, `de`, `es`, `zh`, `ko`

## Debugging Walkthrough

### 1. プロジェクトの検出と起動

```
detect_project({ projectDir: "/path/to/example/spring-boot-kotlin" })
launch({ projectDir: "/path/to/example/spring-boot-kotlin" })
connect({ host: "localhost", port: 5005 })
```

### 2. ブレークポイントの設定

挨拶メッセージ生成ロジックにブレークポイントを設定:

```
set_breakpoint({
  className: "com.example.demo.service.GreetingService",
  line: 22
})
```

### 3. API リクエストの送信

```bash
curl -X POST http://localhost:8080/api/greetings \
  -H "Content-Type: application/json" \
  -d '{"name": "Taro", "language": "ja"}'
```

### 4. デバッグ操作

ブレークポイントで停止後:

```
get_stack_trace({})          # スタックトレースを確認
get_variables({})            # ローカル変数を確認 (name, language の値)
step_over({})                # 次の行へ進む
get_variables({})            # template 変数の値を確認
resume({})                   # 実行を再開
```
