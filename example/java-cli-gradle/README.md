# Java CLI Demo

Gradle Application プラグインを使用したシンプルな Java CLI アプリケーションです。数値処理と FizzBuzz をバッチごとに実行します。

バッチ間で `Thread.sleep` による待機が入るため、ブレークポイントを設定してインタラクティブにデバッグできます。

## 処理内容

4バッチに分けて以下を繰り返します:

1. 数列を生成
2. 偶数をフィルタ
3. 二乗を計算
4. 合計を算出
5. FizzBuzz

## Debugging Walkthrough

### 1. プロジェクトの検出と起動

```
detect_project({ projectDir: "/path/to/example/java-cli-gradle" })
launch({ projectDir: "/path/to/example/java-cli-gradle" })
connect({ host: "localhost", port: 5005 })
```

### 2. ブレークポイントの設定

バッチ処理ループ内にブレークポイントを設定:

```
set_breakpoint({
  className: "com.example.cli.App",
  line: 26
})
```

### 3. デバッグ操作

```
resume({})                   # ブレークポイントまで実行
get_variables({})            # ローカル変数を確認 (from, to, batch, numbers)
step_over({})                # 次の行へ
get_variables({})            # evenNumbers の結果を確認
step_into({})                # filterEven メソッドの中に入る
get_stack_trace({})          # スタックフレームを確認
step_out({})                 # メソッドから戻る
resume({})                   # 次のバッチのブレークポイントまで実行
```

### 4. 出力の確認

```
process_output({})           # stdout の内容を確認
```
