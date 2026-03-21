# Spring Boot + Java Demo

Java で書かれた Spring Boot REST API アプリケーションです。シンプルなタスク管理 API を提供します。

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tasks` | 全タスクを取得 |
| GET | `/api/tasks/{id}` | ID でタスクを取得 |
| POST | `/api/tasks` | 新しいタスクを作成 |
| PATCH | `/api/tasks/{id}/toggle` | 完了状態をトグル |
| DELETE | `/api/tasks/{id}` | タスクを削除 |

### POST リクエスト例

```json
{
  "title": "Buy milk",
  "description": "From the store near the station"
}
```

## Debugging Walkthrough

### 1. プロジェクトの検出と起動

```
detect_project({ projectDir: "/path/to/example/spring-boot-java" })
launch({ projectDir: "/path/to/example/spring-boot-java" })
connect({ host: "localhost", port: 5005 })
```

### 2. ブレークポイントの設定

タスク作成ロジックにブレークポイントを設定:

```
set_breakpoint({
  className: "com.example.demo.service.TaskService",
  line: 27
})
```

### 3. API リクエストの送信

```bash
curl -X POST http://localhost:8080/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "Buy milk", "description": "From the store"}'
```

### 4. デバッグ操作

```
get_stack_trace({})          # スタックトレースを確認
get_variables({})            # title, description の値を確認
step_into({})                # Task コンストラクタの中に入る
get_variables({})            # Task オブジェクトのフィールドを確認
step_out({})                 # コンストラクタから戻る
resume({})                   # 実行を再開
```
