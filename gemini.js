// ============================================================
// Gemini API 単体関数 (gemini.js)
// ============================================================
// このファイルは、Google の Gemini API だけを使って
// AIに質問する「gemn」関数を提供します。
//
// 【他の関数との違い】
//  - gemn   : Gemini のみ（シンプル・高速だがフォールバックなし）
//  - askAI  : Gemini → OpenRouter の順に自動フォールバック（推奨）
//  - my_AI  : OpenRouter のみ
//
// 【使い方の例（スプレッドシートから）】
//  =gemn("こんにちは")                              ← 最小構成
//  =gemn("質問","役割を指定")                       ← システム指示付き
//  =gemn("質問","","gemini-2.0-flash-preview")     ← モデル指定
// ============================================================


// ============================================================
// テスト関数（スクリプトエディタから実行して動作確認用）
// ============================================================
function testgemini() {
  // テスト: 英単語の解説を依頼
  var result = gemn(
    "【post】【response】",
    "あなたは世界一優秀な日本語と英語の講師です。【】で区切られた英単語を使用した英文とその日本語訳と文法の解説をしてください"
  );
  // 結果をログに出力（スクリプトエディタの「実行ログ」で確認）
  Logger.log("FINAL OUTPUT: " + result);
}


// ============================================================
// メイン関数: gemn
// ============================================================
/**
 * Gemini API を呼び出してテキスト回答を取得する
 *
 * @param {string} promptText        ユーザーのプロンプト（必須）
 * @param {string} systemInstruction システム指示（任意）例: "英語教師として回答して"
 * @param {string} model             モデル名（初期値: gemini-3-flash-preview）
 * @return {string} AIの回答テキスト
 * @customfunction
 */
function gemn(promptText, systemInstruction = "", model = "gemini-3-flash-preview") {

  // APIキーを「プロジェクト設定 > スクリプトプロパティ」から取得
  const API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');

  // Gemini API の URL を構築（モデル名とAPIキーを埋め込む）
  const URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

  // ----------------------------------------------------------
  // APIリクエストのデータを組み立て
  // ----------------------------------------------------------
  const payload = {
    // 会話データ: 今回は質問だけ（履歴なし）
    contents: [{ role: "user", parts: [{ text: promptText }] }],

    // システム指示（AIの役割設定）がある場合のみ追加
    system_instruction: systemInstruction
      ? { role: "system", parts: [{ text: systemInstruction }] }
      : undefined
  };

  // HTTPリクエストの設定
  const options = {
    method: "post",                           // POST メソッド
    contentType: "application/json",          // JSON形式
    payload: JSON.stringify(payload),         // データをJSON文字列に変換
    muteHttpExceptions: true                  // エラー時もクラッシュせず結果を取得
  };

  try {
    // ----------------------------------------------------------
    // APIにリクエスト送信
    // ----------------------------------------------------------
    const response = UrlFetchApp.fetch(URL, options);
    const responseCode = response.getResponseCode();  // HTTPステータスコード
    const responseText = response.getContentText();    // レスポンス本体

    // 成功（200）の場合: 回答テキストを取り出して返す
    if (responseCode === 200) {
      const json = JSON.parse(responseText);
      if (json.candidates && json.candidates[0].content) {
        return json.candidates[0].content.parts[0].text;
      }
      // 200だが回答データが空の場合
      return "エラー：回答の構造が空です。";
    }

    // ----------------------------------------------------------
    // 失敗（429: レート制限、400: 不正リクエスト、など）の場合
    // ----------------------------------------------------------
    let errorMsg = "";
    try {
      // エラーの詳細メッセージを取得
      const errorJson = JSON.parse(responseText);
      errorMsg = errorJson.error.message;
    } catch (e) {
      // エラーレスポンスがJSON形式でなければそのまま表示
      errorMsg = responseText;
    }

    return `【APIエラー】コード: ${responseCode} / 内容: ${errorMsg}`;

  } catch (e) {
    // ネットワークエラーなど予期しないエラー
    return `【実行エラー】${e.message}`;
  }
}
