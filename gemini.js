// ============================================================
// Gemini API 単体関数 (gemini.js)
// ============================================================
// このファイルは、Google の Gemini API だけを使って
// AIに質問する「gemn」関数を提供します。
//
// 【エラー時の戻り値プレフィックス】
//  🔑APIキー未設定  → スクリプトプロパティにキーがない
//  🔑認証エラー     → APIキーが無効・期限切れ (401/403)
//  ⏳レート制限     → API呼び出し回数の上限超過 (429)
//  ❌モデル不明     → 指定モデルが存在しない (404)
//  ⚠️リクエスト不正 → パラメータに問題 (400)
//  💔サーバーエラー → API側の障害 (500/502/503)
//  🔌接続エラー     → ネットワーク障害
//  📭空回答         → APIは成功だが回答が空
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
  var result = gemn(
    "【post】【response】",
    "あなたは世界一優秀な日本語と英語の講師です。【】で区切られた英単語を使用した英文とその日本語訳と文法の解説をしてください"
  );
  Logger.log("FINAL OUTPUT: " + result);
}


// ============================================================
// エラー分類ヘルパー（Gemini用）
// ============================================================
function _classifyHttpError_Gemini(statusCode) {
  switch (statusCode) {
    case 400: return "【⚠️リクエスト不正】";
    case 401: return "【🔑認証エラー】";
    case 403: return "【🔑認証エラー】";
    case 404: return "【❌モデル不明】";
    case 429: return "【⏳レート制限】";
    case 500: return "【💔サーバーエラー】";
    case 502: return "【💔サーバーエラー】";
    case 503: return "【💔サーバーエラー】";
    default: return "【⚠️HTTPエラー(" + statusCode + ")】";
  }
}


// ============================================================
// メイン関数: gemn
// ============================================================
/**
 * Gemini API を呼び出してテキスト回答を取得する
 *
 * @param {string} promptText        ユーザーのプロンプト（必須）
 * @param {string} systemInstruction システム指示（任意）
 * @param {string} model             モデル名（初期値: gemini-3-flash-preview）
 * @return {string} AIの回答テキスト
 * @customfunction
 */
function gemn(promptText, systemInstruction = "", model = "gemini-3-flash-preview") {

  // -- APIキー未設定チェック --
  const API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!API_KEY) return "【🔑APIキー未設定】GEMINI_API_KEY をプロジェクト設定 > スクリプトプロパティで登録してください。";

  const URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

  const payload = {
    contents: [{ role: "user", parts: [{ text: promptText }] }],
    system_instruction: systemInstruction
      ? { role: "system", parts: [{ text: systemInstruction }] }
      : undefined
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(URL, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    // -- 成功 (200) --
    if (responseCode === 200) {
      const json = JSON.parse(responseText);
      if (json.candidates && json.candidates[0] && json.candidates[0].content) {
        const answer = json.candidates[0].content.parts[0].text;
        if (answer && answer.trim() !== "") return answer;
        return "【📭空回答】モデルが空の回答を返しました。質問を変えて再試行してください。";
      }
      return "【📭空回答】回答データの構造が不正です。";
    }

    // -- エラー応答 → コード別に分類 --
    const prefix = _classifyHttpError_Gemini(responseCode);
    let apiMsg = "";
    try {
      const errorJson = JSON.parse(responseText);
      apiMsg = errorJson.error ? errorJson.error.message : responseText.substring(0, 150);
    } catch (e) {
      apiMsg = responseText.substring(0, 150);
    }

    return prefix + apiMsg;

  } catch (e) {
    return "【🔌接続エラー】" + e.message;
  }
}
